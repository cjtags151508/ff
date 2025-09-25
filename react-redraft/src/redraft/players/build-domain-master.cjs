/* build-domain-master.cjs
 * Single-run builder for players-by-id.json using local CSVs in this folder.
 * INPUTS next to this file:
 *   players.json              [required]  Sleeper dump (id -> player)
 *   ranks.9.25.csv            [required]  name,team,position,rank  (or legacy: Player_Id,Name,Position,Rank)
 *   players-4-factors.csv     [optional]  Player,Team,Position,Upside Score,Floor Score,Risk Profile,Overall Grade
 *   rankings-qb.csv           [optional]  headerless or Player,Score
 *   rankings-te.csv           [optional]  Player,Value
 *   superflex-rankings.csv    [optional]  Rank,Player,Team
 *
 * Run:  node src/redraft/players/build-domain-master.cjs
 * Out:  players-by-id.json  (id -> merged object)
 */

const fs  = require('fs');
const path = require('path');
const csv = require('csv-parser');

const DIR = __dirname;
const FILES = {
  players:   path.join(DIR, 'players.json'),
  out:       path.join(DIR, 'players-by-id.json'),
  domain:    path.join(DIR, 'ranks-9-25.csv'),            // <-- NEW lowercase CSV
  factors:   path.join(DIR, 'players-4-factors.csv'),
  qbScores:  path.join(DIR, 'rankings-qb.csv'),
  teValues:  path.join(DIR, 'rankings-te.csv'),
  superflex: path.join(DIR, 'superflex-rankings.csv'),
};

let overrides = {};
try { overrides = require('./overrides.js'); } catch { overrides = {}; }

function normalize(name = '') {
  return String(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}
const TEAM_ALIAS = { JAC:'JAX', LA:'LAR', OAK:'LV', SD:'LAC', STL:'LAR', WAS:'WSH', WASH:'WSH' };
const normTeam = (t) => (TEAM_ALIAS[(t || '').toUpperCase()] || (t || '').toUpperCase());

function ensure(file, label) {
  if (!fs.existsSync(file)) {
    console.error(`❌ Missing ${label}: ${file}`);
    process.exit(1);
  }
}
function optional(file) { return fs.existsSync(file) ? file : null; }

// Robust CSV reader (strip BOM on headers)
function readCSV(file, opts = {}) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv({
        mapHeaders: ({ header }) => String(header).replace(/^\uFEFF/, '').trim(),
        ...opts
      }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}
// Headerless QB CSV → {Player,Score}
function readQBCSV(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv({ headers: ['Player','Score'], skipLines: 0 }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}
// Force Superflex headers to avoid BOM / weird header names
function readSFCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv({ headers: ['Rank','Player','Team'], skipLines: 1 }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

ensure(FILES.players, 'players.json');
ensure(FILES.domain,  'ranks.9.25.csv');

const sleeper = JSON.parse(fs.readFileSync(FILES.players, 'utf8'));

// Build lookup indexes from Sleeper
const nameToIds = new Map();
const idToTeam = {};
const idToPos  = {};
for (const [id, p] of Object.entries(sleeper)) {
  const nm = p?.search_full_name || p?.full_name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
  const key = normalize(nm);
  if (key) {
    const arr = nameToIds.get(key) || [];
    arr.push(id);
    nameToIds.set(key, arr);
  }
  if (p?.team) idToTeam[id] = String(p.team).toUpperCase();
  const pos = Array.isArray(p?.fantasy_positions) ? p.fantasy_positions[0] : p?.position;
  if (pos) idToPos[id] = String(pos).toUpperCase();
}

function resolveId(rawId, name, preferPos, teamCsv) {
  if (rawId) return String(rawId);
  if (!name) return null;
  if (overrides[name]) return String(overrides[name]);

  const key = normalize(name);
  const ids = nameToIds.get(key) || [];
  if (!ids.length) return null;

  const wantedPos = preferPos ? String(preferPos).toUpperCase() : null;
  const wantedTeam = teamCsv ? normTeam(teamCsv) : null;

  // Try pos+team match first
  if (wantedPos || wantedTeam) {
    const hit = ids.find((x) => {
      const posOK  = wantedPos  ? (idToPos[x]   === wantedPos) : true;
      const teamOK = wantedTeam ? (normTeam(idToTeam[x]) === wantedTeam) : true;
      return posOK && teamOK;
    });
    if (hit) return hit;
  }
  // Then try team-only
  if (wantedTeam) {
    const hitTeam = ids.find((x) => normTeam(idToTeam[x]) === wantedTeam);
    if (hitTeam) return hitTeam;
  }
  // Then pos-only
  if (wantedPos) {
    const hitPos = ids.find((x) => idToPos[x] === wantedPos);
    if (hitPos) return hitPos;
  }
  // Fallback to first
  return ids[0];
}

(async () => {
  const out = {};
  const posBuckets = {};
  const misses = { domain: [], factors: [], qb: [], te: [], sf: [] };

  // 1) Domain base (now supports both legacy + new lowercase headers)
  const domainRows = await readCSV(FILES.domain);
  for (const row of domainRows) {
    const rawId = String(row['Player_Id'] ?? row['PlayerID'] ?? row['player_id'] ?? row['id'] ?? '').trim();
    const name  = String(row['Name'] ?? row['Player'] ?? row['name'] ?? '').trim();
    const pos   = String(row['Position'] ?? row['Pos'] ?? row['position'] ?? '').trim().toUpperCase();
    const team  = String(row['Team'] ?? row['team'] ?? '').trim();
    const rank  = Number(row['Rank'] ?? row['rank']);

    // skip bad rows and rank==0
    if (!name || !Number.isFinite(rank) || rank === 0) continue;

    let id = resolveId(rawId || null, name, pos, team);
    if (!id) { misses.domain.push(name); continue; }

    const teamFinal = idToTeam[id] || (team ? normTeam(team) : null);
    out[id] = {
      ...(out[id] || {}),
      name,
      position: pos || out[id]?.position || idToPos[id] || null,
      rank,
      positionRank: out[id]?.positionRank ?? null,
      value: out[id]?.value ?? null,
      team: teamFinal,
    };

    if (pos) (posBuckets[pos] ||= []).push({ id, rank });
  }

  // 2) 4-Factors (optional)
  if (optional(FILES.factors)) {
    const rows = await readCSV(FILES.factors);
    for (const r of rows) {
      const name = String(r['Player'] ?? '').trim();
      const team = normTeam(r['Team']);
      if (!name) continue;

      let id = resolveId(null, name, null, team);
      if (!id) { misses.factors.push(`${name}${team ? ' ('+team+')' : ''}`); continue; }

      const tgt = (out[id] = out[id] || {
        name, position: idToPos[id] || null, rank: null, positionRank: null, value: null, team: idToTeam[id] || null,
      });

      const num = (v) => (v === '' || v == null ? null : Number(v));
      const clip10 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : null);

      tgt['four-factor-upside']  = clip10(num(r['Upside Score']));
      tgt['four-factor-floor']   = clip10(num(r['Floor Score']));
      tgt['four-factor-risk']    = clip10(num(r['Risk Profile']));
      tgt['four-factor-overall'] = clip10(num(r['Overall Grade']));
    }
  }

  // 3) QB scores (optional; headerless supported)
  if (optional(FILES.qbScores)) {
    const rows = await readQBCSV(FILES.qbScores); // -> { Player, Score }
    for (const { Player, Score } of rows) {
      const name = String(Player || '').trim();
      const score = Number(Score);
      if (!name || !Number.isFinite(score)) continue;

      const id = resolveId(null, name, 'QB');
      if (!id) { misses.qb.push(name); continue; }

      const tgt = (out[id] = out[id] || {
        name, position: 'QB', rank: null, positionRank: null, value: null, team: idToTeam[id] || null,
      });
      tgt['qb-score'] = score;
      if (!tgt.position) tgt.position = 'QB';
    }
  }

  // 4) TE values (optional)
  if (optional(FILES.teValues)) {
    const rows = await readCSV(FILES.teValues);
    for (const r of rows) {
      const name = String(r['Player'] ?? r['Name'] ?? '').trim();
      const value = Number(r['Value'] ?? r['Score'] ?? r['val']);
      if (!name || !Number.isFinite(value)) continue;

      const id = resolveId(null, name, 'TE');
      if (!id) { misses.te.push(name); continue; }

      const tgt = (out[id] = out[id] || {
        name, position: 'TE', rank: null, positionRank: null, value: null, team: idToTeam[id] || null,
      });
      tgt['te_value'] = value;
      if (!tgt.position) tgt.position = 'TE';
    }
  }

  // 5) Superflex ranks (optional; force headers to avoid BOM/header mismatch)
  let sfApplied = 0, sfRows = 0, sfSkippedNoRank = 0;
  if (optional(FILES.superflex)) {
    const rows = await readSFCsv(FILES.superflex); // -> { Rank, Player, Team }
    sfRows = rows.length;
    for (const r of rows) {
      const name = String(r['Player'] || '').trim();
      const rank = Number(r['Rank']);
      const team = normTeam(r['Team']);
      if (!name || !Number.isFinite(rank)) { sfSkippedNoRank++; continue; }

      let id = resolveId(null, name, null, team);
      if (!id) { misses.sf.push(name); continue; }

      const tgt = (out[id] = out[id] || {
        name, position: idToPos[id] || null, rank: null, positionRank: null, value: null, team: idToTeam[id] || null,
      });
      tgt['superflex-rank'] = rank;
      if (!tgt.position) tgt.position = idToPos[id] || null;
      sfApplied++;
    }
    console.log(`ℹ️  Superflex CSV rows: ${sfRows}, applied: ${sfApplied}, skipped(no rank): ${sfSkippedNoRank}, unmatched: ${misses.sf.length}`);
  }

  // 6) positionRank from Domain rank
  const groups = {};
  for (const [id, p] of Object.entries(out)) {
    const pos = String(p.position || '').toUpperCase();
    if (!pos) continue;
    (groups[pos] ||= []).push({ id, r: Number.isFinite(p.rank) ? p.rank : Infinity });
  }
  for (const pos of Object.keys(groups)) {
    groups[pos].sort((a, b) => a.r - b.r);
    let idx = 0;
    for (const { id, r } of groups[pos]) {
      out[id].positionRank = Number.isFinite(r) ? ++idx : (out[id].positionRank ?? null);
    }
  }

  // 7) finalize & write
  for (const [id, p] of Object.entries(out)) {
    p.name = p.name ?? '';
    p.position = p.position ?? null;
    p.rank = Number.isFinite(p.rank) ? p.rank : (p.rank == null ? null : Number(p.rank));
    p.positionRank = Number.isFinite(p.positionRank) ? p.positionRank : null;
    p.value = p.value ?? null;
    p.team = p.team ? normTeam(p.team) : (idToTeam[id] || null);
  }

  let backup = null;
  if (fs.existsSync(FILES.out)) {
    backup = `${FILES.out}.backup.${Date.now()}.json`;
    fs.copyFileSync(FILES.out, backup);
  }
  fs.writeFileSync(FILES.out, JSON.stringify(out, null, 2));
  console.log(`✅ Wrote ${path.relative(process.cwd(), FILES.out)} (players: ${Object.keys(out).length})`);
  if (backup) console.log(`🗃️  Backup: ${path.relative(process.cwd(), backup)}`);

  const show = (label, arr) => arr.length && console.warn(`⚠️  ${label} unmatched: ${arr.length}`);
  show('Domain',   misses.domain);
  show('4-Factors',misses.factors);
  show('QB',       misses.qb);
  show('TE',       misses.te);
  show('Superflex',misses.sf);
})().catch((e) => {
  console.error('❌ Build error:', e);
  process.exit(1);
});

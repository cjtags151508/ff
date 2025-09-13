// /src/whiteboard-site/SitePage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import LZString from 'lz-string';
import './site.css';
import './print.css';

import {
  getLeagueSettings, fetchLeagueUsers, fetchLeagueRosters,
  fetchPlayersMap, findOwnerUserId, buildStartingLineup,
} from '../redraft/sleeper-league/sleeperAPI.js';

import playersByIdJson from '../redraft/players/players-by-id.json';
import PreviewBoard from './components/PreviewBoard.jsx';
import SleeperForm from './components/SleeperForm.jsx';
import ManualBuilder from './components/ManualBuilder.jsx';
import TweaksPanel from './components/TweaksPanel.jsx';
import { exportNodeAsPng } from './utils/exportPng.js';
import { printBoard } from './utils/printBoard.js';
import Whiteboard from '../redraft/whiteboard/Whiteboard.jsx';

// ------------------------------------------------------------------
// smart defaults (no moves default here)
function makeSmartDefaults(settings, rosterIds, playersById, lineup) {
  const starters = (lineup || []).map(it => it?.player).filter(Boolean);
  const posCount = sym =>
    starters.filter(p => (Array.isArray(p?.fantasy_positions) ? p.fantasy_positions[0] : p?.position || '').toUpperCase() === sym).length;
  const rb = posCount('RB'), wr = posCount('WR'), te = posCount('TE'), qb = posCount('QB');

  const strengths = [], weaknesses = [];
  if (rb >= (settings.positions?.rb || 2)) strengths.push('RB room has weekly floor.');
  else weaknesses.push('Thin at RB — add depth.');
  if (wr >= (settings.positions?.wr || 2)) strengths.push('Multiple startable WRs.');
  else weaknesses.push('WR depth is a concern.');
  if (qb >= (settings.positions?.qb || 1)) strengths.push('Stable QB production.');
  if (te < (settings.positions?.te || 1)) weaknesses.push('TE is streamable at best.');

  const verdict = strengths.length >= 2 && weaknesses.length <= 1 ? 'CONTEND' : weaknesses.length >= 2 ? 'RELOAD' : 'COMPETE';
  return { strengths, weaknesses, verdict };
}

// ------------------------------------------------------------------
// helpers (stripHints, sanitizeOverridesForBoard, resolveIdByName, parsePick)
const normTxt = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s'.-]/g, ' ').replace(/\s+/g, ' ').trim();
const TEAM_RE = /^(ari|atl|bal|buf|car|chi|cin|cle|dal|den|det|gb|hou|ind|jax|kc|lv|lac|lar|mia|min|ne|no|nyg|nyj|phi|pit|sf|sea|tb|ten|wsh)$/;
const POS_RE  = /^(qb|rb|wr|te|k|def|dst|ol|dl|lb|db|edge)$/;
const OFF_POS = new Set(['QB','RB','WR','TE']);
function stripHints(name){ if(!name)return name; const t=normTxt(name).split(' '); const o=String(name).split(/\s+/); let n=t.length; while(n>1){const L=t[n-1]; if(TEAM_RE.test(L)||POS_RE.test(L)) n--; else break;} return o.slice(0,n).join(' ');}

// Team alias normalization for inputs like "pitt", "wash", "jax", etc.
const TEAM_ALIAS_IN = {
  was: 'wsh', wash: 'wsh',
  pitt: 'pit',
  jac: 'jax', jax: 'jax',
  oak: 'lv', stl: 'lar', sd: 'lac', sdc: 'lac',
  buffalo: 'buf', bills: 'buf',
  steelers: 'pit', pittsburgh: 'pit',
  washington: 'wsh', commanders: 'wsh'
};
const aliasTeam = (t) => TEAM_ALIAS_IN[t] || t;

// STRICT-FIRST resolver: exact name + (team/pos) → exact name → fallback scoring.
function resolveIdByName(playersById, input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (playersById[raw]) return raw; // already an ID

  const toks = normTxt(raw).split(' ');
  const hints = { team: null, pos: null };
  // peel team/pos from end; honor aliases
  while (toks.length > 0) {
    let last = toks[toks.length - 1];
    const maybeTeam = aliasTeam(last);
    if (TEAM_RE.test(maybeTeam)) { hints.team = maybeTeam.toUpperCase(); toks.pop(); continue; }
    if (POS_RE.test(last))       { hints.pos  = last.toUpperCase();     toks.pop(); continue; }
    break;
  }
  const baseName = toks.join(' ');
  if (!baseName) return null;

  const getFull = (p) => (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).toLowerCase();
  const getPos  = (p) => (Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : p.position || '').toUpperCase();
  const getTeam = (p) => (p.team || p.pro_team || p.team_abbr || '').toUpperCase();

  // Phase 1: exact name + optional hints (team/pos)
  const exactMatches = [];
  for (const [id, p] of Object.entries(playersById || {})) {
    const full = getFull(p);
    if (!full || full !== baseName) continue;
    if (hints.team && getTeam(p) !== hints.team) continue;
    if (hints.pos  && getPos(p)  !== hints.pos)  continue;
    exactMatches.push(id);
  }
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    const pick = exactMatches.find(id => OFF_POS.has(getPos(playersById[id]))) || exactMatches[0];
    return pick;
  }

  // Phase 2: same exact name; refine with hints; prefer offense
  const sameName = Object.entries(playersById || {})
    .filter(([_, p]) => getFull(p) === baseName);
  if (sameName.length) {
    if (hints.team) {
      const withTeam = sameName.find(([_, p]) => getTeam(p) === hints.team);
      if (withTeam) return withTeam[0];
    }
    if (hints.pos) {
      const withPos = sameName.find(([_, p]) => getPos(p) === hints.pos);
      if (withPos) return withPos[0];
    }
    const offense = sameName.find(([_, p]) => OFF_POS.has(getPos(p)));
    if (offense) return offense[0];
    return sameName[0][0];
  }

  // Phase 3: fallback — prior scoring, but with alias'ed team hint
  let bestId = null, bestScore = -1e9;
  for (const [id, p] of Object.entries(playersById || {})) {
    const full = getFull(p);
    if (!full) continue;
    let score = 0;
    if (full === baseName) score += 2000;
    else if (full.startsWith(baseName)) score += 1200;
    else if (full.includes(baseName)) score += 800;
    const pos = getPos(p);
    const team = getTeam(p);
    if (hints.pos && pos === hints.pos) score += 900;
    if (hints.team && team === hints.team) score += 900;
    if (OFF_POS.has(pos)) score += 250; else score -= 150;
    const adp = Number(p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std);
    if (isFinite(adp)) score += (10000 - adp * 100);
    if (score > bestScore) { bestScore = score; bestId = id; }
  }
  return bestId;
}

// Keep strings for display, but compute IDs alongside so renderers can key on IDs.
function sanitizeOverridesForBoard(o, playersById){
  if(!o||typeof o!=='object') return o;
  const next=JSON.parse(JSON.stringify(o));

  const fix=(x)=>{
    if(!x||typeof x!=='object') return;
    if(typeof x.primary==='string') {
      x.primaryId = resolveIdByName(playersById, x.primary);
    }
    if(Array.isArray(x.recs)) {
      x.recs = x.recs.filter(v=>v!==undefined && v!=='');
      x.recsIds = x.recs.map(v => typeof v === 'string' ? resolveIdByName(playersById, v) : undefined);
    }
  };

  if(next.moves&&typeof next.moves==='object'){
    fix(next.moves.trade);
    fix(next.moves.uptier);
    fix(next.moves.pivot);
  }
  return next;
}

function parsePick(pickStr, teams){
  if(!pickStr) return null; const s=String(pickStr).trim();
  if(s.startsWith('#')){const ov=parseInt(s.slice(1),10); if(!isFinite(ov)) return null; const round=Math.max(1,Math.ceil(ov/Math.max(1,teams||12))); return {overall:ov,round};}
  const sep=s.includes('.')?'.':(s.includes('-')?'-':null); if(sep){const [r,p]=s.split(sep); const rr=parseInt(r,10); const pp=parseInt(p,10); if(!isFinite(rr)||!isFinite(pp)) return null; const ov=(rr-1)* (teams||12)+pp; return {overall:ov,round:rr};}
  const ov=parseInt(s,10); if(!isFinite(ov)) return null; const round=Math.max(1,Math.ceil(ov/Math.max(1,teams||12))); return {overall:ov,round};
}

// NEW: pick user by team name OR username (display_name)
const normSimple = (s) => String(s || '').trim().toLowerCase();
function findUserByTeamOrUsername(users, input) {
  const q = normSimple(input);
  if (!q) return null;

  let hit = users.find(u => normSimple(u?.metadata?.team_name) === q);
  if (hit) return hit;

  hit = users.find(u => normSimple(u?.display_name) === q);
  if (hit) return hit;

  hit = users.find(u => normSimple(u?.metadata?.team_name || '').includes(q));
  if (hit) return hit;

  hit = users.find(u => normSimple(u?.display_name || '').includes(q));
  if (hit) return hit;

  return null;
}

// ------------------------------------------------------------------
export default function WhiteboardSite() {
  const [settings, setSettings] = useState({
    teams: 12, ppr: 1, tepValue: 0,
    positions: { qb:1, rb:2, wr:2, te:1, flex:2, def:0, k:0, bench:6, superflex:0 },
  });
  const [playersById, setPlayersById] = useState(playersByIdJson);
  const [rosterIds, setRosterIds] = useState([]);
  const [lineup, setLineup] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [overrides, setOverrides] = useState({});
  const [ovKey, setOvKey] = useState(0);

  useEffect(() => {
    if (!leagueId || !ownerId) return;
    const popTeamNameFromOwnerId = async () => {
      const users = await fetchLeagueUsers(leagueId);
      let selUser =
        (ownerId && users.find(u => String(u.user_id) === String(ownerId))) ||
        users[0];
      const displayLabel =
        (selUser?.metadata?.team_name && selUser.metadata.team_name.trim()) ||
        selUser?.display_name ||
        '';
      console.log('👥 Team Name:', displayLabel);
      setTeamName(displayLabel);
    }
    popTeamNameFromOwnerId();
  }, [leagueId, ownerId])

  useEffect(() => {
    if (!rosterIds.length) { setLineup([]); return; }
    try { setLineup(buildStartingLineup(settings.positions, rosterIds, playersById)); }
    catch (e) { console.error(e); }
  }, [settings, rosterIds, playersById]);

  // defaults
  useEffect(() => {
    const hasAny =
      !!overrides.verdict ||
      !!(overrides.strengths && overrides.strengths.length) ||
      !!(overrides.weaknesses && overrides.weaknesses.length);
    if (leagueId || hasAny) return;
    setOverrides(prev => ({ ...prev, ...makeSmartDefaults(settings, rosterIds, playersById, lineup) }));
    // eslint-disable-next-line
  }, [settings, rosterIds, playersById, lineup, leagueId]);

  const overridesForBoard = useMemo(
    () => sanitizeOverridesForBoard(overrides, playersById),
    [overrides, playersById]
  );

  // PNG export
  const exportRef = useRef(null);
  const onExportPng = async () => {
    if (!exportRef.current) return;
    await exportNodeAsPng(exportRef.current, `whiteboard_${teamName || 'team'}.png`);
  };

  // PDF export — temp window with ONLY the board, headshots inlined
  const onExportPdf = () => {
    if (!exportRef.current) return;
    printBoard(exportRef.current, { page: 'letter-landscape', marginPx: 0 });
  };

  // UPDATED: allow selecting team by username when team_name is missing, and display team_name or username
  const onSleeperLoad = async ({ leagueId: id, teamNameInput, ownerId: selectedOwnerId }) => {
    try {
      setLoading(true); setErr('');
      const lid = id.trim();
      const s = await getLeagueSettings(lid);
      const [users, rosters, map] = await Promise.all([
        fetchLeagueUsers(lid),
        fetchLeagueRosters(lid),
        fetchPlayersMap(),
      ]);

      const typed = (teamNameInput || '').trim();

      // Owner selection priority:
      // 1) explicit ownerId (from dropdown)
      // 2) typed matches team_name OR username (exact/partial)
      // 3) legacy team-name matcher (findOwnerUserId)
      // 4) first user fallback
      let selUser =
        (selectedOwnerId && users.find(u => String(u.user_id) === String(selectedOwnerId))) ||
        (typed && findUserByTeamOrUsername(users, typed)) ||
        (typed && (() => { const id = findOwnerUserId(users, typed); return users.find(u => String(u.user_id) === String(id)); })()) ||
        users[0];

      const oid = selUser?.user_id || users[0]?.user_id;
      const myRoster = rosters.find(r => String(r.owner_id) === String(oid));

      // Display label: prefer Sleeper team_name, else username
      const displayLabel =
        (selUser?.metadata?.team_name && selUser.metadata.team_name.trim()) ||
        selUser?.display_name ||
        '';

      setTeamName(displayLabel);
      setOwnerId(oid);
      setLeagueId(lid);

      setSettings(s);
      setRosterIds(myRoster?.players || []);
      setPlayersById(map);
      setLineup(buildStartingLineup(s.positions, myRoster?.players || [], map));
    } catch (e) {
      console.error(e);
      setErr(e.message || 'Failed to load Sleeper data');
    } finally { setLoading(false); }
  };

  const onAddPlayer = id => setRosterIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  const onRemovePlayer = id => setRosterIds(prev => prev.filter(p => String(p)!==String(id)));
  const onUpdatePositions = p => setSettings(prev => ({ ...prev, positions: { ...prev.positions, ...p }}));

  // ---------- Manual roster & picks from overrides.manual.roster ----------
  const manualRows = Array.isArray(overrides?.manual?.roster) ? overrides.manual.roster : [];

  const manualResolved = useMemo(() => {
    if (!manualRows.length) return { ids: [], points: [] };
    const ids = [];
    const points = [];
    const seen = new Set();
    const teamsCount = Number(settings.teams || 12);

    for (const row of manualRows) {
      const nm = row?.name?.trim();
      if (!nm) continue;
      const id = resolveIdByName(playersById, nm);
      if (!id) continue;
      if (!ids.includes(id)) ids.push(id);

      const pick = parsePick(row?.pick, teamsCount);
      if (!pick) continue;

      const p = playersById[id] || {};
      const full = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).toUpperCase();
      const [first, ...rest] = full.split(/\s+/);

      const v = p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std;
      const adp = Number(v);
      if (!isFinite(adp)) continue;

      const key = `${id}-${pick.overall}`;
      if (seen.has(key)) continue;
      seen.add(key);

      points.push({ id, first, last: rest.join(' '), overall: pick.overall, round: pick.round, adp });
    }
    return { ids, points };
  }, [manualRows, playersById, settings.teams]);

  const effectiveManualIds = manualResolved.ids.length ? manualResolved.ids : rosterIds;
  const effectiveManualLineup = useMemo(() => {
    try { return buildStartingLineup(settings.positions, effectiveManualIds, playersById); }
    catch { return []; }
  }, [settings.positions, effectiveManualIds, playersById]);

  const hud = useMemo(() => ({
    ownerId, rosterCount: effectiveManualIds.length, startersCount: effectiveManualLineup.length, loading, err,
  }), [ownerId, effectiveManualIds, effectiveManualLineup, loading, err]);

  const isSleeperMode = !!leagueId;

  // keep URL in sync and remount board when overrides/params change
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.set('site','1');
    if (leagueId) sp.set('leagueId', leagueId);
    if (teamName) sp.set('teamName', teamName);
    const enc = LZString.compressToEncodedURIComponent(JSON.stringify(overridesForBoard || {}));
    if (enc && enc !== 'eNortjI0MDCwMjQwAAADAA==') sp.set('o', enc); else sp.delete('o');
    window.history.replaceState({}, '', `${window.location.pathname}?${sp.toString()}`);
    setOvKey(k => k + 1);
  }, [overridesForBoard, leagueId, teamName]);

  return (
    <div className="wb-site">
      <header className="wb-site__header">
        <div className="wb-title">Whiteboard — Website</div>
        <div className="wb-actions">
          <button onClick={onExportPdf} disabled={loading}>Download PDF</button>
          <button onClick={onExportPng} disabled={loading}>Download PNG</button>
        </div>
      </header>

      <main className="wb-layout">
        <aside className="wb-left">
          <section className="wb-card">
            <div className="wb-card__title">Load from Sleeper</div>
            <SleeperForm onLoad={onSleeperLoad} loading={loading} />
            {err && <div className="wb-err">{err}</div>}
          </section>

          {!isSleeperMode && (
            <section className="wb-card">
              <div className="wb-card__title">Manual Builder</div>
              <ManualBuilder
                playersById={playersById}
                rosterIds={rosterIds}
                onAdd={onAddPlayer}
                onRemove={onRemovePlayer}
                positions={settings.positions}
                onPositions={onUpdatePositions}
                teamName={teamName}
                onTeamName={setTeamName}
              />
            </section>
          )}

          {/* Sections & Overrides */}
          <section className="wb-card">
            <div className="wb-card__title">Sections & Overrides</div>
            <TweaksPanel
              hud={hud}
              overrides={overrides}
              onOverrides={setOverrides}
              onExport={onExportPng}
              exportLabel="Download PNG"
              onPrint={onExportPdf}
              printLabel="Download PDF"
              playersById={playersById}
              rosterIds={effectiveManualIds}
            />
          </section>
        </aside>

        <section className="wb-right">
          {/* This is the element we clone/print; nothing else is in the print window */}
          <div ref={exportRef} data-export-root>
            {isSleeperMode ? (
              <Whiteboard
                key={`${leagueId}:${teamName}:${ovKey}`}
                overrides={overridesForBoard}
                playersById={playersById}
                teamName={teamName}
              />
            ) : (
              <PreviewBoard
                leagueId=""
                teamName={teamName}
                settings={settings}
                rosterIds={effectiveManualIds}
                playersById={playersById}
                lineup={effectiveManualLineup}
                ownerId={ownerId}
                draftPoints={manualResolved.points}
                overrides={overridesForBoard}
                show={{
                  settings:true, fourFactors:true, starters:true, grades:true,
                  draftChart:true, moves:true, strengths:true, powerRank:true
                }}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

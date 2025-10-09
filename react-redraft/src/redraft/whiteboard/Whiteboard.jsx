// /src/redraft/whiteboard/Whiteboard.jsx
import React, { useState, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import LZString from 'lz-string';

import LeagueSettings from '../league-settings/LeagueSettings';
import PositionalGrades from '../positional-grade/PositionalGrades';
import Starters from '../starting-lineup/Starters';
import FourFactors from '../four-factors/FourFactors';
import DraftValueChart from '../draft-value/DraftValueChart';
import RosterStrengths from '../strengths-weakness/RosterStrengths';
import Stars from '../stars/Stars';
import MovesToMake from '../moves-to-make/MovesToMake';
import PowerRanking from '../power-ranking/PowerRanking';
import RosterTag from '../roster-tag/RosterTag';
import TeamName from '../team-name/TeamName';
import FinalVerdict from '../final-verdict/FinalVerdict';
import DraftValueManual from '../draft-value-chart/DraftValueManual.jsx';
import WhiteBox from '../whitebox/WhiteBox.jsx';

// ⬇️ Auto Waiver block (existing)
import TopWaiverPriorities from '../top-waiver-priorities/TopWaiverPriorities.jsx';
// ⬇️ NEW: Manual Top Waivers single-tile overlay
import ManualTopWaivers from '../top-waiver-priorities/ManualTopWaivers.jsx';

import {
  getLeagueSettings,
  fetchLeagueUsers,
  fetchLeagueRosters,
  fetchPlayersMap,
  findOwnerUserId,
  buildStartingLineup,
  fetchLeagueDrafts,
  fetchDraftPicks
} from '../sleeper-league/sleeperAPI.js';

import gradeData from '../players/players-by-id.json';
import whiteboardBg from './WB-Base.png';
import whiteboardBg2 from './WB2-base.png';

// ---------- URL overrides helpers ----------
function readOverridesFromUrl() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get('o');
    if (!e) return {};
    const json = LZString.decompressFromEncodedURIComponent(e);
    return JSON.parse(json || '{}') || {};
  } catch (e) {
    console.warn('bad overrides', e);
    return {};
  }
}
const oget = (obj, path, fallback) => {
  try {
    return path.split('.').reduce((a, k) => (a && (k in a) ? a[k] : undefined), obj) ?? fallback;
  } catch {
    return fallback;
  }
};

// ---------- Manual roster helpers ----------
const normTxt = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\s'.-]/g, ' ').replace(/\s+/g, ' ').trim();
const TEAM_RE = /^(ari|atl|bal|buf|car|chi|cin|cle|dal|den|det|gb|hou|ind|jax|kc|lv|lac|lar|mia|min|ne|no|nyg|nyj|phi|pit|sf|sea|tb|ten|wsh)$/;
const POS_RE  = /^(qb|rb|wr|te)$/;

function resolveIdByName(playersById, name) {
  if (!name) return null;
  const raw = String(name);
  if (playersById[raw]) return raw;
  const q = normTxt(raw);
  if (!q) return null;

  const tokens = q.split(' ');
  const hints = { team: null, pos: null };
  const lastTok = tokens[tokens.length - 1] || '';
  if (TEAM_RE.test(lastTok)) hints.team = lastTok.toUpperCase();
  if (POS_RE.test(lastTok))  hints.pos  = lastTok.toUpperCase();
  const baseName = (hints.team || hints.pos) ? tokens.slice(0, -1).join(' ') : q;

  let bestId = null;
  let bestScore = -1e9;
  for (const [id, p] of Object.entries(playersById || {})) {
    const full = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).toLowerCase();
    if (!full) continue;

    let score = 0;
    if (full === baseName) score += 2000;
    else if (full.startsWith(baseName)) score += 1200;
    else if (full.includes(baseName)) score += 800;

    const pos  = (Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : p.position || '').toUpperCase();
    const team = (p.team || p.pro_team || p.team_abbr || '').toUpperCase();

    if (hints.pos && pos === hints.pos)   score += 500;
    if (hints.team && team === hints.team) score += 500;

    const adp = Number(p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std);
    if (isFinite(adp)) score += (10000 - adp * 100);

    if (score > bestScore) { bestScore = score; bestId = id; }
  }
  return bestId;
}

function parsePick(pickStr, teams) {
  if (!pickStr) return null;
  const s = String(pickStr).trim();
  if (s.startsWith('#')) {
    const ov = parseInt(s.slice(1), 10);
    if (!isFinite(ov)) return null;
    const round = Math.max(1, Math.ceil(ov / Math.max(1, teams || 12)));
    return { overall: ov, round };
  }
  const sep = s.includes('.') ? '.' : (s.includes('-') ? '-' : null);
  if (sep) {
    const [r, p] = s.split(sep);
    const rr = parseInt(r, 10);
    const pp = parseInt(p, 10);
    if (!isFinite(rr) || !isFinite(pp)) return null;
    const ov = (rr - 1) * (teams || 12) + pp;
    return { overall: ov, round: rr };
  }
  const ov = parseInt(s, 10);
  if (!isFinite(ov)) return null;
  const round = Math.max(1, Math.ceil(ov / Math.max(1, teams || 12)));
  return { overall: ov, round };
}

// -----------------------------------------------------------------
// Fit-to-right-limit hook (shrinks content to fit a width budget)
// -----------------------------------------------------------------
function useScaleToRightLimit(ref, {
  baseScale = 0.70,
  minScale  = 0.50,
  maxScale  = 0.70,
  widthBudgetPx = 1120,
  deps = [],
} = {}) {
  const [scale, setScale] = React.useState(baseScale);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const w = el.scrollWidth || el.getBoundingClientRect().width || 1;
      const extra = Math.min(1, Math.max(0.0001, widthBudgetPx / w));
      const next = Math.min(maxScale, Math.max(minScale, baseScale * extra));
      setScale(next);
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    window.addEventListener('resize', compute);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, baseScale, minScale, maxScale, widthBudgetPx, ...deps]);

  return scale;
}

// -----------------------------------------------------------------

export default function Whiteboard() {
  const params = new URLSearchParams(window.location.search);
  const leagueId = params.get('leagueId');
  const teamName = params.get('teamName')?.trim() || '';

  // read overrides once per mount
  const overrides = useMemo(() => readOverridesFromUrl(), []);

  const [settings, setSettings] = useState({
    teams: 12,
    ppr: true,
    tepValue: 0,
    positions: { qb: 1, rb: 2, wr: 2, te: 1, flex: 2, def: 1, k: 1, bench: 6 }
  });
  const [starters, setStarters] = useState([]);
  const [rosterIds, setRosterIds] = useState([]);
  const [playersById, setPlayersById] = useState({});
  const [loading, setLoading] = useState(!!leagueId);
  const [error, setError] = useState(null);

  // HUD/debug
  const [ownerId, setOwnerId] = useState(null);
  const [rosterCount, setRosterCount] = useState(0);
  const [teamSamples, setTeamSamples] = useState([]);

  // picks/ADP for Starters text + chart
  const [pickByPlayerId, setPickByPlayerId] = useState({});
  const [adpByPlayerId, setAdpByPlayerId] = useState({});
  const [draftPoints, setDraftPoints] = useState([]);

  // Final stars
  const [finalStars, setFinalStars] = useState(null);

  // Moves baseline (overrideable)
  const [moves] = useState([
    { id: 'trade',  label: 'TRADE',  variant: 'teal',  primary: null, recs: [null, null], note: undefined },
    { id: 'uptier', label: 'UPTIER', variant: 'gold',  primary: null, recs: [null, null], note: undefined },
    { id: 'pivot',  label: 'PIVOT',  variant: 'green', primary: null, recs: [null, null], note: undefined },
  ]);

  // Four Factors baseline
  const [factorScores, setFactorScores] = useState({ upside: 5, reliability: 5, depth: 5, risk: 5 });

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const s = await getLeagueSettings(leagueId);
        if (cancelled) return;
        setSettings(s);

        const [users, rosters, playersMap] = await Promise.all([
          fetchLeagueUsers(leagueId),
          fetchLeagueRosters(leagueId),
          fetchPlayersMap(),
        ]);
        if (cancelled) return;

        const sample = users.slice(0, 6).map(u => ({
          tn: u.metadata?.team_name || '', dn: u.display_name || ''
        }));
        setTeamSamples(sample);

        const oid = findOwnerUserId(users, teamName);
        setOwnerId(oid);
        if (!oid) throw new Error(`Could not find team "${teamName}" in this league.`);

        const myRoster = rosters.find(r => String(r.owner_id) === String(oid));
        const myRosterId = myRoster?.roster_id;
        const ids = myRoster?.players || [];
        setRosterIds(ids);
        setRosterCount(ids.length);
        setPlayersById(playersMap);

        // Build lineup from Sleeper roster by default
        setStarters(buildStartingLineup(s.positions, ids, playersMap));

        // --- Draft picks (whole team) ---
        try {
          const drafts = await fetchLeagueDrafts(leagueId);
          const draft = Array.isArray(drafts) && drafts.length ? drafts[0] : null;
          if (draft) {
            const picks = await fetchDraftPicks(draft.draft_id || draft.id);

            // Map for starters text
            const map = {};
            const teamsCount = Number(s.teams || 12);
            for (const pk of picks || []) {
              const pid = String(pk.player_id);
              let overall = Number(pk.pick_no);
              if (!Number.isFinite(overall)) {
                if (Number.isFinite(pk.round) && Number.isFinite(pk.pick)) {
                  overall = (Number(pk.round) - 1) * teamsCount + Number(pk.pick);
                } else continue;
              }
              const label = (Number.isFinite(pk.round) && Number.isFinite(pk.pick))
                ? `${pk.round}.${String(pk.pick).padStart(2, '0')}`
                : `#${overall}`;
              if (!map[pid] || overall < map[pid].overall) {
                map[pid] = { overall, label };
              }
            }
            if (!cancelled) setPickByPlayerId(map);

            // Chart points from team picks
            const teamPicks = (picks || []).filter(
              pk => myRosterId == null || String(pk.roster_id) === String(myRosterId)
            );
            const pts = [];
            const seen = new Set();
            for (const pk of teamPicks) {
              const pid = String(pk.player_id);
              if (!pid) continue;

              let overall = Number(pk.pick_no);
              const teamsCount2 = Number(s.teams || 12);
              if (!Number.isFinite(overall) && Number.isFinite(pk.round) && Number.isFinite(pk.pick)) {
                overall = (Number(pk.round) - 1) * teamsCount2 + Number(pk.pick);
              }
              if (!Number.isFinite(overall)) continue;
              const round = Math.max(1, Math.ceil(overall / Math.max(1, teamsCount2)));

              const p = playersMap[pid] || {};
              const full = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || pid;
              const [first, ...rest] = full.trim().toUpperCase().split(/\s+/);

              const fromSleeper =
                p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std;
              const fromLocal = gradeData[pid]?.sleeperAdp
                ?? gradeData[pid]?.domainAdpN
                ?? gradeData[pid]?.domainAdp;
              const adpSleeper = Number(fromSleeper);
              const adpLocal   = Number(fromLocal);
              const adp = Number.isFinite(adpSleeper)
                ? adpSleeper
                : Number.isFinite(adpLocal)
                  ? adpLocal
                  : Number(overall);

              pts.push({ id: pid, first, last: rest.join(' '), overall, round, adp });
            }
            if (!cancelled) setDraftPoints(pts);
          }
        } catch {
          // ignore; chart will just show "No data"
        }

        // ADP map for starters text (coerce first, fallback to local)
        const adpMap = {};
        for (const pid of ids) {
          const p = playersById[pid] || playersMap[pid] || {};
          const fromSleeper =
            p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std;
          const fromLocal = gradeData[String(pid)]?.sleeperAdp
            ?? gradeData[String(pid)]?.domainAdpN
            ?? gradeData[String(pid)]?.domainAdp;
          const adpSleeper = Number(fromSleeper);
          const adpLocal   = Number(fromLocal);
          const adp = Number.isFinite(adpSleeper) ? adpSleeper
                    : Number.isFinite(adpLocal)   ? adpLocal
                    : undefined;
          if (adp !== undefined) adpMap[String(pid)] = adp;
        }
        if (!cancelled) setAdpByPlayerId(adpMap);

        // ---------- MANUAL ROSTER ----------
        const manualRows = Array.isArray(overrides?.manual?.roster) ? overrides.manual.roster : [];
        if (!cancelled && manualRows.length) {
          const manualIds = [];
          const manualPts = [];
          const seenManual = new Set();
          const teamsCount = Number(s.teams || 12);

          for (const row of manualRows) {
            const idFromOverride = String(row?.id || row?.playerId || '').trim();
            let id = idFromOverride && playersMap[idFromOverride] ? idFromOverride : null;

            if (!id) {
              const nm = row?.name?.trim();
              if (!nm) continue;
              id = resolveIdByName(playersMap, nm);
            }
            if (!id) continue;

            if (!manualIds.includes(id)) manualIds.push(id);

            const pick = parsePick(row?.pick, teamsCount);
            if (pick) {
              const p = playersMap[id] || {};
              const full = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).toUpperCase();
              const [first, ...rest] = full.split(/\s+/);

              const v = p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std;
              const adpSleeper = Number(v);
              const adpLocal   = Number(gradeData[id]?.sleeperAdp ?? gradeData[id]?.domainAdpN ?? gradeData[id]?.domainAdp);
              const adp = Number.isFinite(adpSleeper) ? adpSleeper
                        : Number.isFinite(adpLocal)   ? adpLocal
                        : Number(pick.overall);

              const key = `${id}-${pick.overall}`;
              if (!seenManual.has(key)) {
                seenManual.add(key);
                manualPts.push({ id, first, last: rest.join(' '), overall: pick.overall, round: pick.round, adp });
              }
            }
          }

          setRosterIds(manualIds);
          setRosterCount(manualIds.length);
          setStarters(buildStartingLineup(s.positions, manualIds, playersMap));
          setDraftPoints(manualPts);
        }
      } catch (e) {
        setError(e.message || 'Failed to load league data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId, teamName]);

  // ---------- EFFECTIVE values (overrides layered on top) ----------
  const effTeamName   = overrides.teamName ?? teamName;

  // SPLIT overrides so FLEX (W/R/T) and SF (Q/W/R/T) are explicit
  const effSettings = useMemo(() => {
    const o    = overrides?.leagueSettings || {};
    const posO = o?.positions || {};
    const base = settings || {};
    const basePos = base.positions || {};

    // start merged from base
    const merged = {
      ...base,
      ...(o.teams    != null ? { teams: Number(o.teams) } : null),
      ...(o.ppr      != null ? { ppr: !!o.ppr } : null),
      // ⬇️ NEW: custom scoring label/value support
      ...(o.scoring  != null && String(o.scoring).trim() !== '' ? { scoring: String(o.scoring) } : null),
      ...(o.tepValue != null ? { tepValue: Number(o.tepValue) || 0 } : null),
      positions: { ...basePos },
    };

    // final counts
    const oSF        = posO.sf ?? posO.superflex;
    const oFlexValue = posO.flex;

    let sfFinal   = Number(oSF        ?? basePos.sf ?? basePos.superflex ?? 0);
    let flexFinal = Number(oFlexValue ?? basePos.flex ?? 0);
    if (!Number.isFinite(sfFinal))   sfFinal = 0;
    if (!Number.isFinite(flexFinal)) flexFinal = 0;

    merged.positions = {
      ...merged.positions,
      ...Object.fromEntries(Object.entries(posO).map(([k, v]) => [k, Number(v)])),
      flex: flexFinal,
      sf: sfFinal,
      superflex: sfFinal,
    };
    return merged;
  }, [settings, overrides]);

  // Recompute starters whenever effective counts or roster change — keeps roster in sync with pills
  useEffect(() => {
    if (!rosterIds?.length) return;
    if (!playersById || Object.keys(playersById).length === 0) return;
    setStarters(buildStartingLineup(effSettings.positions, rosterIds, playersById));
  }, [
    rosterIds,
    playersById,
    effSettings.positions.qb,
    effSettings.positions.rb,
    effSettings.positions.wr,
    effSettings.positions.te,
    effSettings.positions.flex,
    effSettings.positions.sf,
    effSettings.positions.superflex,
    effSettings.positions.def,
    effSettings.positions.k,
  ]);

  const effFour = {
    upside: oget(overrides, 'fourFactors.upside',     undefined) ?? oget(factorScores, 'upside', 5),
    reliability: oget(overrides, 'fourFactors.reliability', undefined) ?? oget(factorScores, 'reliability', 5),
    depth: oget(overrides, 'fourFactors.depth',       undefined) ?? oget(factorScores, 'depth', 5),
    risk: oget(overrides, 'fourFactors.risk',         undefined) ?? oget(factorScores, 'risk', 5),
  };

  const effGrades = {
    QB: oget(overrides, 'positionalGrades.QB', undefined),
    RB: oget(overrides, 'positionalGrades.RB', undefined),
    WR: oget(overrides, 'positionalGrades.WR', undefined),
    TE: oget(overrides, 'positionalGrades.TE', undefined),
  };

  const effStars      = overrides?.finalVerdict?.stars ?? undefined;
  const effVerdictTxt = overrides?.finalVerdict?.note ?? '';
  const effPowerRank  = overrides?.powerRanking?.rank ?? undefined;

  const effRSItems = useMemo(() => {
    const raw = overrides?.rosterStrengths?.items;
    if (Array.isArray(raw)) return [raw[0] ?? null, raw[1] ?? null, raw[2] ?? null];
    if (raw && typeof raw === 'object') {
      return [raw[0] ?? raw['0'] ?? null, raw[1] ?? raw['1'] ?? null, raw[2] ?? raw['2'] ?? null];
    }
    return [null, null, null];
  }, [overrides]);

  const effMoves = overrides?.moves ?? undefined;
  const mergedMoves = useMemo(() => {
    const base = moves;
    if (Array.isArray(effMoves)) {
      return base.map((b, idx) => {
        const o = effMoves[idx] || {};
        const recs = Array.isArray(o.recs) ? o.recs.filter(Boolean) : (Array.isArray(b.recs) ? b.recs.filter(Boolean) : []);
        return { ...b, label: (o.label ?? b.label) || b.label, note: o.note ?? b.note, primary: (o.primary ?? b.primary) || null, recs };
      });
    }
    if (effMoves && typeof effMoves === 'object') {
      return base.map((b) => {
        const o = effMoves[b.id] || {};
        const recs = Array.isArray(o.recs) ? o.recs.filter(Boolean) : (Array.isArray(b.recs) ? b.recs.filter(Boolean) : []);
        return { ...b, label: (o.label ?? b.label) || b.label, note: o.note ?? b.note, primary: (o.primary ?? b.primary) || null, recs };
      });
    }
    return base;
  }, [moves, effMoves]);

  // Background choice
  const bgVariant = overrides?.background?.variant === 'wb2' ? 'wb2' : 'wb1';
  const selectedBg = bgVariant === 'wb2' ? whiteboardBg2 : whiteboardBg;

  // ---- League Settings fit-to-bar geometry ----
  const LS_LEFT_PX = 80;
  const LS_RIGHT_LIMIT_PX = 920;
  const LS_GUTTER_PX = 12;
  const LS_BASE_SCALE = 0.70;
  const LS_MIN_SCALE = 0.30;

  // Auto-fit LeagueSettings row (right boundary)
  const lsInnerRef = useRef(null);
  const lsScale = useScaleToRightLimit(lsInnerRef, {
    baseScale: LS_BASE_SCALE,
    minScale:  LS_MIN_SCALE,
    maxScale:  LS_BASE_SCALE,
    widthBudgetPx: Math.max(1, LS_RIGHT_LIMIT_PX - LS_LEFT_PX - LS_GUTTER_PX),
    deps: [
      effSettings.teams,
      effSettings.ppr,
      effSettings.scoring, // include scoring so pill updates on edit
      effSettings.tepValue,
      effSettings.positions?.qb,
      effSettings.positions?.rb,
      effSettings.positions?.wr,
      effSettings.positions?.te,
      effSettings.positions?.flex,
      effSettings.positions?.superflex ?? effSettings.positions?.sf,
      effSettings.positions?.def,
      effSettings.positions?.k,
      effSettings.positions?.bench,
    ],
  });

  return (
    <div
      style={{
        backgroundImage: `url(${selectedBg})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'top left',
        width: '1920px',
        height: '1080px',
        position: 'relative',
        overflow: 'hidden',
        margin: '0 auto'
      }}
    >
      {/* TEAM NAME */}
      <div style={{ position: 'absolute', top: 90, left: 40, zIndex: 3 }}>
        <TeamName
          text={effTeamName}
          maxWidth={890}
          maxFont={120}
          minFont={60}
          color="#2D2D2C"
          baselineAlign
          baselineRatio={0.78}
          baselineNudge={6}
        />
      </div>

      {/* LEAGUE POWER RANKING */}
      <div
        style={{
          position: 'absolute',
          top: '50px',
          left: '1655px',
          transform: 'scale(1.8)',
          transformOrigin: 'top left',
          zIndex: 5,
        }}
      >
        {!loading && !error && ownerId && (
          <PowerRanking
            leagueId={leagueId}
            ownerId={ownerId}
            settings={effSettings}
            playersById={playersById}
            forcedRank={effPowerRank}
          />
        )}
      </div>

      {/* ROSTER TAG */}
      <div
        style={{
          position: 'absolute',
          top: '90px',
          left: '970px',
          transform: 'scale(0.6)',
          transformOrigin: 'top left',
          zIndex: 4,
        }}
      >
        <RosterTag
          scores={effFour}
          overrideTag={overrides?.rosterTag ?? undefined}
          width={650}
          fontSize={40}
          iconLeft={28}
          iconWidth={40}
          insetLeft={106}
          insetRight={28}
        />
      </div>

      {/* LEAGUE SETTINGS (auto-fit to right boundary) */}
      <div
        style={{
          position: 'absolute',
          top: '220px',
          left: `${LS_LEFT_PX}px`,
          transform: `scale(${lsScale})`,
          transformOrigin: 'top left'
        }}
      >
        {loading ? (
          <div style={{ fontFamily: 'Arial, sans-serif' }}>Loading league…</div>
        ) : error ? (
          <div style={{ color: 'crimson', fontFamily: 'Arial, sans-serif' }}>
            {error}
          </div>
        ) : (
          <div ref={lsInnerRef} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            <LeagueSettings settings={effSettings} />
          </div>
        )}
      </div>

      {/* FOUR FACTORS */}
      <div
        style={{
          position: 'absolute',
          top: '190px',
          left: '640px',
          transform: 'scale(0.86)',
          transformOrigin: 'top left'
        }}
      >
        {!loading && !error && (
          <FourFactors
            settings={effSettings}
            rosterIds={rosterIds}
            playersById={playersById}
            lineup={starters}
            onScoresChange={setFactorScores}
            forcedScores={overrides?.fourFactors ? effFour : undefined}
          />
        )}
      </div>
      
      {/* WHITE BOX OVERLAY */}
      {overrides?.whiteBox?.enabled && (
        <WhiteBox
          x={overrides?.whiteBox?.x ?? 650}
          y={overrides?.whiteBox?.y ?? 558}
          width={overrides?.whiteBox?.width ?? 640}
          height={overrides?.whiteBox?.height ?? 68}
          opacity={overrides?.whiteBox?.opacity ?? 1}
          rotate={overrides?.whiteBox?.rotate ?? 0}
          z={overrides?.whiteBox?.z ?? 6}
        />
      )}

      {/* STARTERS */}
      <div
        style={{
          position: 'absolute',
          top: '340px',
          left: '70px',
          transform: 'scale(0.8)',
          transformOrigin: 'top left'
        }}
      >
        {!loading && !error && (
          <Starters
            lineup={starters}
            rosterIds={rosterIds}
            playersById={playersById}
            pickByPlayerId={pickByPlayerId}
            adpByPlayerId={adpByPlayerId}
          />
        )}
      </div>

      {/* POSITIONAL GRADES */}
      <div
        style={{
          position: 'absolute',
          top: '700px',
          left: '40px',
          transform: 'scale(1.2)',
          transformOrigin: 'top left'
        }}
      >
        {!loading && !error && (
          <PositionalGrades
            settings={effSettings}
            rosterIds={rosterIds}
            playersById={playersById}
            forcedGrades={oget(overrides,'positionalGrades',undefined)}
          />
        )}
      </div>

      {/* ⬇️ TOP WAIVER PRIORITIES or MANUAL OVERLAY (single tile) */}
      <div
        style={{
          position: 'absolute',
          top: '575px',
          left: '665px',
          transform: 'scale(0.75)',
          transformOrigin: 'top left'
        }}
      >
        {!loading && !error && (
          // Overrides take precedence
          ((overrides?.topWaivers?.overrideIds || []).filter(Boolean).length > 0) ? (
            <TopWaiverPriorities
              leagueId={leagueId}
              settings={effSettings}
              playersById={playersById}
              rosterIds={rosterIds}
              overrideIds={(overrides?.topWaivers?.overrideIds || []).filter(Boolean)}
            />
          ) : (
            overrides?.manualWaivers?.enabled ? (
              <ManualTopWaivers
                enabled
                items={[{
                  preset: String(overrides?.manualWaivers?.preset || '').toUpperCase(),
                  label: overrides?.manualWaivers?.label || undefined
                }]}
                width={560}
                tileHeight={150}
                gap={18}
                fontSize={40}
                textScale={1.8}
              />
            ) : (
              <TopWaiverPriorities
                leagueId={leagueId}
                settings={effSettings}
                playersById={playersById}
                rosterIds={rosterIds}
                overrideIds={[]}
              />
            )
          )
        )}
      </div>

      {/* ROSTER STRENGTHS & WEAKNESSES */}
      <div
        style={{
          position: 'absolute',
          top: '320px',
          left: '1555px',
          transform: 'scale(0.6)',
          transformOrigin: 'top left'
        }}
      >
        {!loading && !error && ownerId && (
          <RosterStrengths
            leagueId={leagueId}
            ownerId={ownerId}
            starCount={overrides?.finalVerdict?.stars ?? finalStars ?? 3}
            overrideItems={effRSItems}
          />
        )}
      </div>

      {/* FINAL VERDICT — Stars */}
      <div
        style={{
          position: 'absolute',
          top: '855px',
          left: '1550px',
          transform: 'scale(0.75)',
          transformOrigin: 'top left',
          zIndex: 50,
        }}
      >
        {!loading && !error && (
          <Stars
            settings={effSettings}
            rosterIds={rosterIds}
            playersById={playersById}
            onStarsChange={(n) => setFinalStars(n)}
            forcedStars={overrides?.finalVerdict?.stars ?? undefined}
          />
        )}
      </div>

      {/* FINAL VERDICT — Text */}
      <div
        style={{
          position: 'absolute',
          top: '910px',
          left: '1150px',
          transform: 'scale(0.4)',
          transformOrigin: 'top left',
          zIndex: 50,
          width: '1725px',
        }}
      >
        {!loading && !error && (
          <FinalVerdict text={effVerdictTxt} maxWidth='1725px'/>
        )}
      </div>

      {/* MOVES TO MAKE */}
      <div
        style={{
          position: 'absolute',
          top: '530px',
          left: '1100px',
          transform: 'scale(0.75)',
          transformOrigin: 'top left'
        }}
      >
        {!loading && !error && (
          <MovesToMake moves={mergedMoves} playersById={playersById} />
        )}
      </div>
    </div>
  );
}
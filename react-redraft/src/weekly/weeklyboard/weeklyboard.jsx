import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from "react";
import weeklyBase from "./weekly-base.png";
import TeamName from "../team-name/TeamName.jsx";
import LeagueSettings from "../league-settings/LeagueSettings.jsx";
import StartersWeekly from "../starting-lineup/StartersWeekly.jsx";
import FlexAnalysis from "../starting-lineup/FlexAnalysis.jsx";
import WeekLabel from "../week-label/WeekLabel.jsx";

// Chosen weekly ranking datasets (enriched so rows always have `lights`)
import RANK_1QB from "../players/weekly-1qb.enriched.json";
import RANK_SF  from "../players/weekly-sf.enriched.json";

// Global lights by id (optional fallback)
import LIGHTS_ALL from "../players/lights.json";

import {
  getLeagueSettings,
  fetchLeagueUsers,
  fetchLeagueRosters,
  fetchPlayersMap,
  findOwnerUserId,
  buildStartingLineup,
} from "../../redraft/sleeper-league/sleeperAPI.js";

/* Fallbacks from URL so the board still works when opened directly */
function useQueryFallback() {
  return useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return {
      leagueId: (sp.get("leagueId") || "").trim(),
      teamName: (sp.get("teamName") || "TEAM NAME").trim(),
      weekFromUrl: Number(sp.get("week")),
    };
  }, []);
}

/* Auto-fit TeamName to a width budget */
function useAutoScaleToWidth(ref, widthBudgetPx, deps = []) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.scrollWidth || el.getBoundingClientRect().width || 1;
      setScale(Math.min(1, widthBudgetPx / w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, widthBudgetPx, ...deps]);
  return scale;
}

/* Name normalizer so id-less rows still match later by name */
const HYPHENS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2043\uFE58\uFE63\uFF0D-]/g;
const SUFFIX_RE = /\b(jr|sr|ii|iii|iv|v)\b$/i;
const normName = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // diacritics
    .replace(/[’']/g, "")                             // quotes
    .replace(HYPHENS, " ")                            // dash family → space
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(SUFFIX_RE, "").trim()
    .toLowerCase();

export default function WeeklyBoard(props) {
  const { leagueId: pLeagueId, teamName: pTeamName, week: weekProp } = props;
  const { leagueId: qLeagueId, teamName: qTeamName, weekFromUrl } = useQueryFallback();

  const leagueId = pLeagueId || qLeagueId || "";
  const teamName = pTeamName || qTeamName || "TEAM NAME";

  const weekToShow =
    Number.isFinite(weekProp) ? Number(weekProp)
    : Number.isFinite(weekFromUrl) ? Number(weekFromUrl)
    : 1;

  const [settings, setSettings] = useState({
    teams: 12,
    ppr: true,
    tepValue: 0,
    positions: { qb: 1, rb: 2, wr: 2, te: 1, flex: 2, def: 1, k: 1, bench: 6, superflex: 0 },
  });
  const [playersById, setPlayersById] = useState({});
  const [rosterIds, setRosterIds] = useState([]);
  const [lineup, setLineup] = useState([]);
  const [ownerId, setOwnerId] = useState(null);
  const [loading, setLoading] = useState(!!leagueId);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!leagueId) return;

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

        const oid = findOwnerUserId(users, teamName);
        setOwnerId(oid);

        const myRoster = rosters.find((r) => String(r.owner_id) === String(oid));
        const ids = myRoster?.players || [];
        setRosterIds(ids);
        setPlayersById(playersMap);

        // ADP-based fallback lineup while weekly ranks are loading
        setLineup(ids.length ? buildStartingLineup(s.positions, ids, playersMap) : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load weekly data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId, teamName]);

  // ---- Choose dataset (SF >= 1 → SF file, else 1QB) and build maps ----
  const { rankMap, rankNameMap, lightsById, lightsByName } = useMemo(() => {
    // Accept several aliases just in case the source uses a different key
    const sfCount = Number(
      (settings?.positions?.superflex ??
       settings?.positions?.sf ??
       settings?.positions?.sflex ??
       settings?.positions?.op ??
       0)
    );

    const list = sfCount >= 1 ? RANK_SF : RANK_1QB;

    // id → rank
    const rMap = new Map();
    // name → rank (normalized), for rows that didn't resolve id
    const rNameMap = new Map();

    // id → lights (merge global → row.lights)
    const lById = { ...(LIGHTS_ALL || {}) };
    // name → lights (normalized name), for id-less rows
    const lByName = {};

    list.forEach((row, i) => {
      const id = String(row?.id ?? row?.playerId ?? row?.player_id ?? "").trim();
      const nameKey = normName(row?.name);
      const rank = Number(row?.rank ?? (i + 1));

      if (nameKey) rNameMap.set(nameKey, rank);
      if (id) rMap.set(id, rank);

      const lights = row?.lights && typeof row.lights === "object" ? row.lights : null;
      if (lights) {
        if (id) lById[id] = { ...lById[id], ...lights };
        if (nameKey) lByName[nameKey] = { ...lights };
      }
    });

    return { rankMap: rMap, rankNameMap: rNameMap, lightsById: lById, lightsByName: lByName };
  }, [settings]);

  // Rebuild lineup using weekly ranks (includes name fallback)
  useEffect(() => {
    if (!rosterIds?.length || !playersById || (!rankMap?.size && !rankNameMap?.size)) return;

    // pools by position with a rank accessor (id → rank, else name → rank)
    const getRank = (p) => {
      const id = String(p.player_id || p.id || "");
      const byId = rankMap?.get(id);
      if (Number.isFinite(byId)) return byId;
      const nm = normName(p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim());
      const byName = rankNameMap?.get(nm);
      return Number.isFinite(byName) ? byName : Infinity;
    };

    const buildByRanks = () => {
      const pool = { QB: [], RB: [], WR: [], TE: [] };
      for (const rid of rosterIds) {
        const p = playersById[rid];
        if (!p) continue;
        const pos =
          (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) ||
          p.position || "";
      const POS = String(pos).toUpperCase();
        if (pool[POS]) pool[POS].push(p);
      }
      for (const k of Object.keys(pool)) {
        pool[k].sort((a, b) => getRank(a) - getRank(b));
      }

      const take = (pos) => (pool[pos] && pool[pos].shift()) || null;
      const out = [];
      const push = (slot, player) => out.push({ slot, player });

      const qbN   = Number(settings?.positions?.qb   || 0);
      const rbN   = Number(settings?.positions?.rb   || 0);
      const wrN   = Number(settings?.positions?.wr   || 0);
      const teN   = Number(settings?.positions?.te   || 0);
      const flexN = Number(settings?.positions?.flex || 0);
      const sfN   = Number(settings?.positions?.superflex ?? settings?.positions?.sf ?? 0);

      for (let i = 0; i < qbN; i++) push("QB",  take("QB"));
      for (let i = 0; i < rbN; i++) push("RB",  take("RB"));
      for (let i = 0; i < wrN; i++) push("WR",  take("WR"));
      for (let i = 0; i < teN; i++) push("TE",  take("TE"));

      // SFLEX: best of QB/RB/WR/TE remaining
      for (let i = 0; i < sfN; i++) {
        const c = [pool.QB[0], pool.RB[0], pool.WR[0], pool.TE[0]].filter(Boolean);
        c.sort((a, b) => getRank(a) - getRank(b));
        const pick = c[0] || null;
        if (pick) {
          const POS = (Array.isArray(pick.fantasy_positions) && pick.fantasy_positions[0]) || pick.position || "";
          pool[String(POS).toUpperCase()]?.shift();
        }
        push("SFLEX", pick || null);
      }

      // FLEX: best of RB/WR/TE remaining
      for (let i = 0; i < flexN; i++) {
        const c = [pool.RB[0], pool.WR[0], pool.TE[0]].filter(Boolean);
        c.sort((a, b) => getRank(a) - getRank(b));
        const pick = c[0] || null;
        if (pick) {
          const POS = (Array.isArray(pick.fantasy_positions) && pick.fantasy_positions[0]) || pick.position || "";
          pool[String(POS).toUpperCase()]?.shift();
        }
        push("FLEX", pick || null);
      }

      return out;
    };

    const ranked = buildByRanks();
    if (ranked.some(it => it?.player)) setLineup(ranked);
  }, [rankMap, rankNameMap, rosterIds, playersById, settings?.positions]);

  // === TeamName auto-fit to a 660px area (no clipping) ===
  const TEAMNAME_WIDTH = 660;
  const tnRef = useRef(null);
  const tnScale = useAutoScaleToWidth(tnRef, TEAMNAME_WIDTH, [teamName]);

  // === League Settings: right-side limit auto-shrink (preserves base 0.8 scale) ===
  const LS_LEFT = 40;                 // current left used below
  const LS_RIGHT_LIMIT = 700;         // <-- adjust this stop point as needed
  const LS_WIDTH_BUDGET = LS_RIGHT_LIMIT - LS_LEFT;

  const lsRef = useRef(null);
  const lsScaleRaw = useAutoScaleToWidth(lsRef, LS_WIDTH_BUDGET, [settings]);
  const lsScale = Math.min(0.8, lsScaleRaw); // keep your 0.8 baseline, shrink further only if needed

  return (
    <div style={{ background:"#f6f6f6", minHeight:"100vh", display:"grid", placeItems:"start center", padding:20 }}>
      <div
        style={{
          position:"relative",
          width:"1000px",
          height:"1070px",
          backgroundImage:`url(${weeklyBase})`,
          backgroundSize:"contain",
          backgroundRepeat:"no-repeat",
          backgroundPosition:"top left",
          overflow:"hidden",
        }} className="weeklyboard"
      >
        {/* Team Name (auto-fit to 660px; shrinks when needed) */}
        <div style={{ position:"absolute", top:50, left:40, zIndex:5, width:TEAMNAME_WIDTH }}>
          <div
            ref={tnRef}
            style={{ display:"inline-block", whiteSpace:"nowrap", transform:`scale(${tnScale})`, transformOrigin:"top left" }}
          >
            <TeamName
              text={teamName}
              maxFont={80}
              minFont={20}
              color="#fff"
              baselineAlign
              baselineRatio={0.78}
            />
          </div>
        </div>

        {/* Week Label */}
        <div style={{ position:"absolute", top:64, left:698, width:300, zIndex:5 }}>
          <WeekLabel week={weekToShow} fontSize={40} color="#000" align="center" width={300} />
        </div>

        {/* League Settings (auto-shrinks to respect LS_RIGHT_LIMIT) */}
        <div
          style={{
            position:"absolute",
            top:155,
            left:LS_LEFT,
            width:LS_WIDTH_BUDGET,
            zIndex:4,
            overflow:"hidden", // clip any sub-pixel overflow
          }}
        >
          <div
            ref={lsRef}
            style={{
              display:"inline-block",
              transform:`scale(${lsScale})`,
              transformOrigin:"top left",
            }}
          >
            {loading ? (
              <div style={{ fontFamily:"Arial, sans-serif", color:"#fff" }}>Loading league…</div>
            ) : error ? (
              <div style={{ fontFamily:"Arial, sans-serif", color:"crimson" }}>{error}</div>
            ) : (
              <LeagueSettings settings={settings} />
            )}
          </div>
        </div>

        {/* Starters (uses lights & ranks; rows will use name fallback) */}
        <div style={{ position:"absolute", top:280, left:-60, width:600, transform:"scale(1.2)", transformOrigin:"top left", zIndex:4 }}>
          {!loading && !error && (
            <StartersWeekly
              lineup={lineup}
              rosterIds={rosterIds}
              playersById={playersById}
              targetHeight={600}
              rowHeight={68}
              minGap={10}
              rankMap={rankMap}
              rankNameMap={rankNameMap}
              lightsOverride={lightsById}
              lightsByName={lightsByName}
            />
          )}
        </div>

        {/* Flex Analysis (same fallbacks for rank & lights) */}
        <div style={{ position:"absolute", top:340, left:480, width:520, transform:"scale(1.0)", transformOrigin:"top left", zIndex:4 }}>
          {!loading && !error && (
            <FlexAnalysis
              lineup={lineup}
              rosterIds={rosterIds}
              playersById={playersById}
              count={3}
              rankMap={rankMap}
              rankNameMap={rankNameMap}
              lightsOverride={lightsById}
              lightsByName={lightsByName}
            />
          )}
        </div>
      </div>
    </div>
  );
}

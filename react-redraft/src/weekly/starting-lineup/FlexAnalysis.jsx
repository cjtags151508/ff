import React, { useMemo } from "react";
import "./weekly-starters.css";

/* Category-specific icons */
import MATCHUP_GREEN  from "./lights/matchup-green.png";
import MATCHUP_YELLOW from "./lights/matchup-yellow.png";
import MATCHUP_RED    from "./lights/matchup-red.png";
import VEGAS_GREEN    from "./lights/vegas-green.png";
import VEGAS_YELLOW   from "./lights/vegas-yellow.png";
import VEGAS_RED      from "./lights/vegas-red.png";
import OPP_GREEN      from "./lights/opponent-green.png";
import OPP_YELLOW     from "./lights/opponent-yellow.png";
import OPP_RED        from "./lights/opponent-red.png";

const CATS = ["matchup", "offense", "vegas"];

/* Name normalizer for name-based rank/lights fallbacks */
const HYPHENS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2043\uFE58\uFE63\uFF0D-]/g;
const SUFFIX_RE = /\b(jr|sr|ii|iii|iv|v)\b$/i;
const normName = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(HYPHENS, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(SUFFIX_RE, "").trim()
    .toLowerCase();

/* === EXCEPTIONS ===
   Force certain names to FLEX-eligible positions even if Sleeper lists them as DB/etc. */
const EXCEPTIONS = {
  names: {
    "travis hunter": { forcePos: "WR", allowFlex: true }, // 👈 main exception
  },
  ids: {
    // if you know his Sleeper id, list it here e.g. "9999": { forcePos: "WR", allowFlex: true }
  },
};

const colorOf = (v) => {
  const s = String(v || "").toUpperCase();
  if (s.includes("GREEN"))  return "GREEN";
  if (s.includes("YELLOW")) return "YELLOW";
  if (s.includes("RED"))    return "RED";
  return null;
};
const ICON = {
  matchup: { GREEN: MATCHUP_GREEN, YELLOW: MATCHUP_YELLOW, RED: MATCHUP_RED },
  vegas:   { GREEN: VEGAS_GREEN,   YELLOW: VEGAS_YELLOW,   RED: VEGAS_RED   },
  offense: { GREEN: OPP_GREEN,     YELLOW: OPP_YELLOW,     RED: OPP_RED     },
};

export default function FlexAnalysis({
  lineup = [],
  rosterIds = [],
  playersById = {},
  count = 3,
  allowed = ["WR", "RB", "TE"],

  // from WeeklyBoard
  rankMap,                 // Map(id -> rank)
  rankNameMap,             // Map(normName(name) -> rank)
  lightsOverride = {},     // { id: lights }
  lightsByName = {},       // { normName(name): lights }
}) {
  // IDs already used in starters (exclude from bench)
  const usedIds = useMemo(() => {
    const s = new Set();
    for (const it of lineup || []) {
      const p = it?.player;
      const id = p?.player_id || p?.id;
      if (id) s.add(String(id));
    }
    return s;
  }, [lineup]);

  const scoreAdp = (p) =>
    (Number(p?.adp_half_ppr ?? p?.adp_ppr ?? p?.adp ?? p?.adp_full_ppr ?? p?.adp_std ?? 9999)) +
    (p?.search_rank ? p.search_rank / 10000 : 0);

  const getRank = (rawP) => {
    const id = String(rawP?.player_id || rawP?.id || "");
    const r1 = rankMap?.get(id);
    if (Number.isFinite(r1)) return r1;
    const nm = normName(rawP?.full_name || `${rawP?.first_name || ""} ${rawP?.last_name || ""}`.trim());
    const r2 = rankNameMap?.get(nm);
    return Number.isFinite(r2) ? r2 : Infinity;
  };

  const rows = useMemo(() => {
    const allowedSet = new Set(allowed.map((x) => String(x).toUpperCase()));

    const candidates = (rosterIds || [])
      .map((id) => playersById[id])
      .filter(Boolean)
      .map((p) => {
        const pos =
          (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) ||
          p.position ||
          "";
        const id = String(p.player_id || p.id || "");
        const nm = normName(p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim());

        // apply exception if needed
        const ex = EXCEPTIONS.ids[id] || EXCEPTIONS.names[nm];
        const effPos = (ex?.forcePos || pos).toUpperCase();

        return {
          raw: p,
          id,
          name:
            p.full_name ||
            `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
            "—",
          position: effPos, // effective position after exception
          team: p.team || p.pro_team || p.team_abbr || "",
          _nm: nm,
        };
      })
      .filter((p) => {
        // if exception explicitly allows FLEX, bypass allowedSet
        const ex = EXCEPTIONS.ids[p.id] || EXCEPTIONS.names[p._nm];
        if (ex?.allowFlex) return true;
        return allowedSet.has(p.position);
      })
      .filter((p) => !usedIds.has(p.id));

    // sort by weekly rank (id → name fallback), then ADP for unranked
    const INF = 1e9;
    const getSortKey = (cand) => {
      const r = getRank(cand.raw);
      if (Number.isFinite(r)) return r;
      return INF + scoreAdp(cand.raw);
    };
    candidates.sort((a, b) => getSortKey(a) - getSortKey(b));

    return candidates.slice(0, Math.max(0, count));
  }, [allowed, rosterIds, playersById, usedIds, count, rankMap, rankNameMap]);

  const logoForTeam = (team) => {
    const code = String(team || "").toLowerCase();
    if (!code) return "";
    try {
      return new URL(`../../assets/standard/${code}.png`, import.meta.url).href;
    } catch { return ""; }
  };

  const PlayerRow = ({ p }) => {
    const slotClass =
      p.position === "QB" ? "pos-qb" :
      p.position === "RB" ? "pos-rb" :
      p.position === "WR" ? "pos-wr" :
      p.position === "TE" ? "pos-te" :
      "pos-bench";

    const headshot =
      p.id && !String(p.id).startsWith("placeholder-")
        ? `https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg`
        : "";

    const teamLogo = logoForTeam(p.team);
    const team = (p.team || "").toUpperCase();
    const details = `${p.position || ""} – ${team}`;

    const display = (p.name || "—").toUpperCase();
    let nameSize = 18;
    if (display.length > 22) nameSize = 16;
    if (display.length > 28) nameSize = 14;

    // lights: id → name → map
    const lights =
      lightsOverride?.[p.id] ||
      lightsByName?.[p._nm] ||
      playersById?.[p.id]?.weekly?.lights ||
      null;

    return (
      <div className={`player-row ${slotClass}`}>
        <div className="player-media">
          {teamLogo && (
            <img
              className="team-logo"
              src={teamLogo}
              alt={team}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
            />
          )}
          <div className="headshot-bg">
            {headshot && (
              <img
                className="player-headshot"
                src={headshot}
                alt=""
                loading="lazy"
                onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
              />
            )}
          </div>
        </div>

        <div className="player-info">
          <div className="player-name-row">
            <div className="player-name" style={{ fontSize: nameSize }} title={display}>
              {display}
            </div>

            {!!lights && (
              <div className="player-tags">
                {CATS.map((cat) => {
                  const col = colorOf(lights?.[cat]);
                  const src =
                    cat === "matchup" ? ICON.matchup[col || ""] :
                    cat === "vegas"   ? ICON.vegas[col || ""]   :
                                        ICON.offense[col || ""];

                  return src ? (
                    <img
                      key={`${p.id}-tag-${cat}`}
                      src={src}
                      alt={`${cat} ${col || "—"}`}
                      className="tag"
                      title={`${cat}: ${lights?.[cat] || "—"}`}
                    />
                  ) : null;
                })}
              </div>
            )}
          </div>
          <div className="player-details">{details}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="starting-roster" style={{ "--row-gap": "16px" }}>
      <div className="roster-column">
        {rows.map((p, i) => (
          <PlayerRow key={`${i}-${p.id}-${p.position}`} p={p} />
        ))}
      </div>
    </div>
  );
}

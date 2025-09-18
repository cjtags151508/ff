import React, { useMemo } from "react";
import "./weekly-starters.css";

/* Category-specific icons that match your filenames */
import MATCHUP_GREEN  from "./lights/matchup-green.png";
import MATCHUP_YELLOW from "./lights/matchup-yellow.png";
import MATCHUP_RED    from "./lights/matchup-red.png";

import VEGAS_GREEN    from "./lights/vegas-green.png";
import VEGAS_YELLOW   from "./lights/vegas-yellow.png";
import VEGAS_RED      from "./lights/vegas-red.png";

import OPP_GREEN      from "./lights/opponent-green.png";
import OPP_YELLOW     from "./lights/opponent-yellow.png";
import OPP_RED        from "./lights/opponent-red.png";

/* Category order: Matchup → Vegas → Offense */
const CATS = ["matchup", "offense", "vegas"];

/* Normalize a full name so id-less rows can still match lights by name */
const HYPHENS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2043\uFE58\uFE63\uFF0D-]/g;
const SUFFIX_RE = /\b(jr|sr|ii|iii|iv|v)\b$/i;
const normName = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // diacritics
    .replace(/[’']/g, "")                             // quotes
    .replace(HYPHENS, " ")                            // any dash → space
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(SUFFIX_RE, "").trim()
    .toLowerCase();

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

export default function StartersWeekly({
  lineup = [],
  rosterIds = [],
  playersById = {},
  targetHeight = 450,
  rowHeight = 68,
  minGap = 10,

  // provided by WeeklyBoard
  rankMap,              // (unused here; lineup already built)
  rankNameMap,          // (unused here; parity)
  lightsOverride = {},  // { id: {matchup, vegas, offense} }
  lightsByName = {},    // { normName(name): {matchup, vegas, offense} }

  leftGuardPx = 0,      // tiny left padding so the bracket isn’t hugged
}) {
  // Build core-only starters, normalizing SFLEX
  const rows = useMemo(() => {
    const starters = (lineup || []).map((it) => {
      const p = it?.player || {};
      const id = p.player_id || p.id;
      const rawSlot = String(it?.slot || "").toLowerCase();
      const slot = rawSlot === "superflex" ? "sflex" : rawSlot; // normalize to sflex
      return {
        id: String(id || ""),
        slot,
        name:
          p.full_name ||
          `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
          "—",
        position:
          (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) ||
          p.position ||
          "",
        team: p.team || p.pro_team || p.team_abbr || "",
      };
    });

    const CORE = new Set(["qb", "rb", "wr", "te", "sflex", "flex"]);
    const core = starters.filter((r) => CORE.has(r.slot));
    const ORDER = ["qb", "rb", "wr", "te", "flex", "sflex"];
    return ORDER.flatMap((s) => core.filter((r) => r.slot === s));
  }, [lineup]);

  const logoForTeam = (team) => {
    const code = String(team || "").toLowerCase();
    if (!code) return "";
    try {
      return new URL(`../../assets/standard/${code}.png`, import.meta.url).href;
    } catch {
      return "";
    }
  };

  // prefer id -> name -> teammate lights
  const getLightsFor = (p) => {
    const byId = lightsOverride?.[p.id];
    if (byId) return byId;

    const nm = normName(p.name);
    const byName = lightsByName?.[nm];
    if (byName) return byName;

    // teammate fallback (same NFL team)
    const team = String(p.team || "").toUpperCase();
    for (const [pid, val] of Object.entries(lightsOverride || {})) {
      const ref = playersById?.[pid];
      const tm = (ref?.team || ref?.pro_team || ref?.team_abbr || "").toUpperCase();
      if (tm === team) return val;
    }
    return null;
  };

  const PlayerRow = ({ p }) => {
    const slotClass =
      p.slot === "qb"    ? "pos-qb"   :
      p.slot === "rb"    ? "pos-rb"   :
      p.slot === "wr"    ? "pos-wr"   :
      p.slot === "te"    ? "pos-te"   :
      p.slot === "sflex" ? "pos-sflex pos-flex" :
      p.slot === "flex"  ? "pos-flex" : "pos-bench";

    const headshot =
      p.id && !String(p.id).startsWith("placeholder-")
        ? `https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg`
        : "";

    const teamLogo = logoForTeam(p.team);
    const team = (p.team || "").toUpperCase();

    const details =
      p.slot === "sflex"
        ? `SFLEX – ${p.position || ""} – ${team}`
        : p.slot === "flex"
          ? `FLEX – ${p.position || ""} – ${team}`
          : `${p.position || ""} – ${team}`;

    const display = (p.name || "—").toUpperCase();
    let nameSize = 18;
    if (display.length > 22) nameSize = 16;
    if (display.length > 28) nameSize = 14;

    const lights = getLightsFor(p);

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

  // Fit-to-range logic
  const n = Math.max(1, rows.length);
  const contentH = n * rowHeight;
  const gaps = Math.max(0, n - 1);

  let gap = minGap;
  let scale = 1;

  if (gaps === 0) {
    scale = Math.min(1, targetHeight / contentH);
  } else {
    const exactGap = (targetHeight - contentH) / gaps;
    if (exactGap >= minGap) {
      gap = exactGap;
      scale = 1;
    } else {
      gap = minGap;
      const needed = contentH + gaps * gap;
      scale = Math.min(1, targetHeight / needed);
    }
  }

  return (
    <div className="starting-roster-guard" style={{ paddingLeft: leftGuardPx }}>
      <div
        className="starting-roster"
        style={{
          "--row-gap": `${gap}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          height: `${targetHeight}px`,
        }}
      >
        <div className="roster-column">
          {rows.map((p, i) => (
            <PlayerRow key={`${i}-${p.id}-${p.slot}`} p={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

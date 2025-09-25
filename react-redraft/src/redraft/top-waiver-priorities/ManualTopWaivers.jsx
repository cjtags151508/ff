// /src/whiteboard-site/components/ManualTopWaivers.jsx
import React, { useEffect, useMemo, useState } from "react";
import gradeData from "../../redraft/players/players-by-id.json";
import { fetchLeagueRosters } from "../../redraft/sleeper-league/sleeperAPI.js";

/**
 * Manual Top Waivers picker (Tweaks-side)
 *
 * Props:
 *  - playersById: Record<string, SleeperPlayer>
 *  - values: [id1?, id2?, id3?]  // current selections (string or '')
 *  - onChange: (index: 0|1|2, id: string|undefined) => void
 *  - leagueId?: string            // optional; if not provided, read from URL
 */
export default function ManualTopWaivers({
  playersById = {},
  values = [],
  onChange,
  leagueId: leagueIdProp,
}) {
  // use URL leagueId if prop not passed
  const leagueId =
    leagueIdProp ||
    new URLSearchParams(window.location.search).get("leagueId") ||
    "";

  const [rostered, setRostered] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!leagueId) {
        setRostered(new Set());
        return;
      }
      try {
        const rosters = await fetchLeagueRosters(leagueId);
        if (cancelled) return;
        const s = new Set();
        for (const r of rosters || []) {
          for (const pid of r?.players || []) s.add(String(pid));
        }
        setRostered(s);
      } catch {
        setRostered(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  // FA options = players not on ANY roster; only QB/RB/WR/TE; sort by Domain rank (lower=better)
  const faOptions = useMemo(() => {
    const out = [];
    for (const [id, p] of Object.entries(playersById || {})) {
      const pid = String(id);
      if (rostered.has(pid)) continue; // only free agents

      const pos =
        (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) ||
        p.position || "";
      const POS = String(pos).toUpperCase();
      if (!["QB", "RB", "WR", "TE"].includes(POS)) continue;

      const team = String(p.team || p.pro_team || p.team_abbr || "").toUpperCase();
      const name =
        p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || pid;

      const rank = Number(gradeData?.[pid]?.rank ?? Infinity);
      if (!Number.isFinite(rank)) continue; // must have a domain rank

      out.push({
        id: pid,
        label: team ? `${name} — ${POS} • ${team}` : `${name} — ${POS}`,
        rank,
      });
    }
    out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
    return out;
  }, [playersById, rostered]);

  const picks = [values[0] || "", values[1] || "", values[2] || ""];

  const Row = ({ index }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 700, opacity: 0.8 }}>Player {index + 1}</div>
      <select
        value={picks[index]}
        onChange={(e) => onChange?.(index, e.target.value || undefined)}
      >
        <option value="">Auto</option>
        {faOptions.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button
        type="button"
        className="wb-danger"
        onClick={() => onChange?.(index, undefined)}
      >
        Clear
      </button>
    </div>
  );

  return (
    <>
      <div className="wb-sep">Top Waivers Overrides</div>
      <div
        className="wb-row"
        style={{ gridColumn: "1 / -1", fontSize: 12, opacity: 0.75, margin: "2px 0 8px" }}
      >
        Pick exact players to show as <b>#1</b>, <b>#2</b>, <b>#3</b>.
        List shows <b>league free agents</b> (not on any roster), sorted by your rank.
      </div>
      <Row index={0} />
      <Row index={1} />
      <Row index={2} />
    </>
  );
}

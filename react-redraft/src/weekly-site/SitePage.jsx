// /src/weekly-site/SitePage.jsx
import React, { useEffect, useMemo, useState } from "react";
import LZString from "lz-string";
import "./site.css";

import SleeperForm from "./components/SleeperForm.jsx";
import TweaksPanel from "./components/TweaksPanel.jsx";
import ExportButton from "./ExportButton.jsx";
import { fetchLeagueUsers } from '../redraft/sleeper-league/sleeperAPI.js';

// NOTE: use a RELATIVE import so CI (Linux) resolves it correctly
import WeeklyBoard from "../weekly/weeklyboard/weeklyboard.jsx";

/** tiny helper so we only write ?o= when we truly have overrides */
const isEmptyObj = (obj) => !obj || (Object.keys(obj).length === 0 && obj.constructor === Object);

export default function WeeklySitePage() {
  const sp = new URLSearchParams(window.location.search);
  const [leagueId, setLeagueId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [ownerId, setOwnerId]   = useState("");   // ← NEW: persist which team is selected
  const [week, setWeek] = useState(sp.get("week") || 1);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  
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

  // ---- hydrate from URL (leagueId, teamName, ownerId, week, overrides via ?o=) ----
  useEffect(() => {
    try {
      const sp  = new URLSearchParams(window.location.search);
      const lid = (sp.get("leagueId") || "").trim();
      const tn  = (sp.get("teamName") || "").trim();
      const oid = (sp.get("ownerId")  || "").trim();
      const wk  = Number(sp.get("week"));

      if (lid) setLeagueId(lid);
      if (tn)  setTeamName(tn);
      if (oid) setOwnerId(oid);
      if (Number.isFinite(wk) && wk > 0) setWeek(wk);

      const enc = sp.get("o");
      if (enc) {
        try {
          const json = LZString.decompressFromEncodedURIComponent(enc);
          if (json) {
            const parsed = JSON.parse(json);
            if (parsed && typeof parsed === "object") setOverrides(parsed);
          }
        } catch { /* ignore bad ?o= */ }
      }
    } catch {/* ignore */}
  }, []);

  // Effective week: Tweaks override wins, else form/URL
  const effectiveWeek = useMemo(() => {
    const w = Number(overrides?.week);
    return Number.isFinite(w) && w > 0 ? w : week;
  }, [overrides?.week, week]);

  // ---- keep URL in sync (leagueId, teamName, ownerId, week, ?o=) ----
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.set("site", "weekly");
    if (leagueId) sp.set("leagueId", leagueId); else sp.delete("leagueId");
    if (teamName) sp.set("teamName", teamName); else sp.delete("teamName");
    if (ownerId)  sp.set("ownerId",  ownerId);  else sp.delete("ownerId");
    if (Number.isFinite(effectiveWeek) && effectiveWeek > 0) {
      sp.set("week", String(effectiveWeek));
    } else {
      sp.delete("week");
    }

    if (!isEmptyObj(overrides)) {
      const enc = LZString.compressToEncodedURIComponent(JSON.stringify(overrides));
      sp.set("o", enc);
    } else {
      sp.delete("o");
    }
    const url = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState({}, "", url);
  }, [leagueId, teamName, ownerId, effectiveWeek, overrides]);

  // ---- SleeperForm callback ----
  // Always use the drop-down selection for which team to load (ownerId),
  // and ONLY use the override name to replace the printed label if provided.
  const onSleeperLoad = async ({ leagueId: id, ownerId: selectedOwnerId, teamNameInput, week: wFromForm }) => {
    try {
      setLoading(true);
      setErr("");

      const lid = (id || "").trim();
      setLeagueId(lid);

      // Persist the chosen team (this controls which roster WeeklyBoard fetches)
      setOwnerId(String(selectedOwnerId || "").trim());

      // Label override: if typed, replace printed team name; otherwise keep current URL/teamName
      const overrideName = (teamNameInput || "").trim();
      if (overrideName) setTeamName(overrideName);

      if (Number.isFinite(+wFromForm) && +wFromForm > 0) setWeek(+wFromForm);
    } catch (e) {
      setErr(e?.message || "Failed to prepare weekly board");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wb-site">
      <header className="wb-site__header">
        <div className="wb-title">Weekly Board — Website</div>
        <div className="wb-actions" />
      </header>

      <main className="wb-layout">
        {/* LEFT: loader + tweaks */}
        <aside className="wb-left">
          <section className="wb-card">
            <div className="wb-card__title">Load from Sleeper</div>
            <SleeperForm onLoad={onSleeperLoad} loading={loading} />
            {err && <div className="wb-err">{err}</div>}
          </section>

          <section className="wb-card">
            <div className="wb-card__title">Tweaks & Overrides</div>
            <TweaksPanel
              overrides={overrides}
              onOverrides={setOverrides}
              playersById={{}}
              rosterIds={[]}
              hud={{ loading, err }}
              onExport={() => {}}
              exportLabel="Download PNG"
            />
          </section>
        </aside>
        <ExportButton 
          className="weeklyboard"      
        />

        {/* RIGHT: Weekly board (fetches league/users itself; now receives ownerId too) */}
        <section className="wb-right">
          <div data-export-root>
            <WeeklyBoard
              leagueId={leagueId}
              teamName={teamName}    
              ownerId={ownerId}       
              week={effectiveWeek}
              overrides={overrides}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

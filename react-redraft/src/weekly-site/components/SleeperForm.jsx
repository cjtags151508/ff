// /src/weekly-site/components/SleeperForm.jsx
import React, { useEffect, useState } from 'react';
import { fetchLeagueUsers } from '../../redraft/sleeper-league/sleeperAPI.js';

export default function SleeperForm({ onLoad, loading }) {
  const sp = new URLSearchParams(window.location.search);
  const [leagueId, setLeagueId] = useState('');
  const [week, setWeek] = useState(sp.get('week') || 1);


  const [fetchingTeams, setFetchingTeams] = useState(false);
  const [teams, setTeams] = useState([]); // [{ value, label, teamName, displayName }]
  const [ownerId, setOwnerId] = useState('');
  const [overrideName, setOverrideName] = useState(''); // ← stays blank unless user types
  const [err, setErr] = useState('');

  // Prefill from URL
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const lid = sp.get('leagueId') || sp.get('league') || '';
      if (lid) setLeagueId(lid);
      const w = Number(sp.get('week'));
      if (Number.isFinite(w) && w > 0) setWeek(w);
    } catch {}
  }, []);

  // Keep ?week= in sync
  useEffect(() => {
    if (!Number.isFinite(week) || week <= 0) return;
    const sp = new URLSearchParams(window.location.search);
    const current = Number(sp.get('week'));
    if (current !== week) {
      sp.set('week', String(week));
      const url = `${window.location.pathname}?${sp.toString()}`;
      window.history.replaceState({}, '', url);
    }
  }, [week]);

  const clampWeek = (n) => Math.min(18, Math.max(1, Number(n) || 1));

  const fetchTeams = async () => {
    if (!leagueId.trim()) return;
    try {
      setErr('');
      setFetchingTeams(true);
      const users = await fetchLeagueUsers(leagueId.trim());
      const opts = (users || [])
        .map((u) => {
          const tn = (u?.metadata?.team_name || '').trim();
          const dn = (u?.display_name || '').trim();
          const label = tn ? `${tn} — ${dn || 'unknown'}` : (dn || u.user_id);
          return { value: u.user_id, label, teamName: tn, displayName: dn };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      setTeams(opts);
      setOwnerId(opts[0]?.value || '');
      // IMPORTANT: do NOT prefill overrideName — leave it blank
      // setOverrideName('');  // (it already is)
    } catch (e) {
      setErr(e?.message || 'Failed to fetch teams');
    } finally {
      setFetchingTeams(false);
    }
  };

  const onChangeTeam = (e) => {
    setOwnerId(e.target.value);
    // Do NOT auto-fill the override when changing teams — user controls it manually.
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const lid = leagueId.trim();
    if (!lid) return;

    // Persist leagueId in URL (preserve existing params)
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.set('leagueId', lid);
      const url = `${window.location.pathname}?${sp.toString()}`;
      window.history.replaceState({}, '', url);
    } catch {}

    // If teams are loaded, finalize; otherwise fetch teams first
    if (teams.length && ownerId) {
      const sel = teams.find((t) => String(t.value) === String(ownerId));
      const typed = (overrideName || '').trim(); // ← user-entered override (blank by default)
      const finalTeamName = typed || sel?.teamName || sel?.displayName || '';

      onLoad?.({
        leagueId: lid,
        ownerId,
        teamNameInput: finalTeamName, // parent (SitePage) uses this directly
        week, // weekly key
      });
    } else {
      fetchTeams();
    }
  };

  const resetTeams = () => {
    setTeams([]);
    setOwnerId('');
    setOverrideName(''); // clear override explicitly
    setErr('');
  };

  const disableAll = loading || fetchingTeams;

  return (
    <form onSubmit={onSubmit} className="wb-form" style={{ display: 'grid', gap: 8 }}>
      <label>League ID</label>
      <input
        value={leagueId}
        placeholder="e.g., 1254558115920093184"
        onChange={(e) => setLeagueId(e.target.value)}
        disabled={disableAll}
      />

      {/* Week picker (weekly-only) */}
      <label>Week</label>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <input
          type="number"
          min={1}
          max={18}
          value={week}
          onChange={(e) => setWeek(clampWeek(e.target.value))}
          disabled={disableAll}
        />
        <button
          type="button"
          onClick={() => setWeek((w) => clampWeek(w - 1))}
          disabled={disableAll}
          aria-label="Previous week"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setWeek((w) => clampWeek(w + 1))}
          disabled={disableAll}
          aria-label="Next week"
        >
          +
        </button>
      </div>

      {/* Step 1: Fetch teams */}
      {!teams.length && (
        <button type="submit" disabled={!leagueId.trim() || disableAll}>
          {fetchingTeams ? 'Fetching teams…' : 'Next: Choose Team'}
        </button>
      )}

      {/* Step 2: Choose team, optionally override name, then submit */}
      {!!teams.length && (
        <>
          <label>Team</label>
          <select
            value={ownerId}
            onChange={onChangeTeam}
            disabled={disableAll}
          >
            {teams.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Override box — stays BLANK by default */}
          <label>Override Team Name (optional)</label>
          <input
            value={overrideName}
            placeholder="Enter a company-safe team name…"
            onChange={(e) => setOverrideName(e.target.value)}
            disabled={disableAll}
          />
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            If provided, this replaces the Sleeper team name on the board.
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={disableAll}>Load League</button>
            <button type="button" onClick={resetTeams} disabled={disableAll}>Change League ID</button>
          </div>
        </>
      )}

      {err && <div className="wb-err">{err}</div>}
    </form>
  );
}

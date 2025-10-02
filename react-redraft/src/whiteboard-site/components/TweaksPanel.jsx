import React, { useEffect, useMemo, useRef, useState } from 'react';
import gradeData from '../../redraft/players/players-by-id.json';
import { fetchLeagueRosters } from '../../redraft/sleeper-league/sleeperAPI.js';

export default function TweaksPanel({
  overrides,
  onOverrides,
  onExport,
  hud,
  exportLabel = 'Download PNG',
  playersById = {},
  rosterIds = [],
}) {
  const o = overrides || {};

  /* -------------------- deep get/set (with moves normalization) -------------------- */
  const normalizeMovesContainer = (obj) => {
    const next = obj || {};
    const m = next.moves;
    if (Array.isArray(m)) {
      next.moves = {
        trade:  typeof m[0] === 'string' ? { primary: m[0] } : (m[0] || {}),
        uptier: typeof m[1] === 'string' ? { primary: m[1] } : (m[1] || {}),
        pivot:  typeof m[2] === 'string' ? { primary: m[2] } : (m[2] || {}),
      };
    } else if (!m || typeof m !== 'object') {
      next.moves = {};
    }
    return next;
  };

  const set = (path, val) => {
    onOverrides((prev) => {
      let next = normalizeMovesContainer(JSON.parse(JSON.stringify(prev || {})));
      const keys = path.split('.');
      let cur = next;

      if (path.startsWith('moves.')) {
        next = normalizeMovesContainer(next);
        cur = next;
      }

      keys.forEach((k, i) => {
        const last = i === keys.length - 1;
        if (last) {
          if (val === undefined) {
            try { delete cur[k]; } catch { cur[k] = undefined; }
          } else {
            cur[k] = val;
          }
        } else {
          if (typeof cur[k] === 'string') cur[k] = {};
          if (!cur[k] || typeof cur[k] !== 'object') {
            cur[k] = Number.isInteger(+keys[i + 1]) ? [] : {};
          }
          cur = cur[k];
        }
      });

      return next;
    });
  };

  const get = (path, fallback = '') => {
    try { return path.split('.').reduce((a, k) => (a && k in a ? a[k] : undefined), o) ?? fallback; }
    catch { return fallback; }
  };

  /* -------------------- TEAM CODE CANONICALIZATION -------------------- */
  const TEAM_ALIASES = { WAS: 'WSH', WASH: 'WSH' };
  const canonicalTeam = (t) => {
    const key = (t || '').toUpperCase();
    return TEAM_ALIASES[key] || key;
  };
  const normalizeCommitStringTeam = (s) => {
    if (!s) return s;
    const parts = String(s).trim().split(/\s+/);
    if (parts.length >= 3) {
      const last = parts[parts.length - 1];
      parts[parts.length - 1] = canonicalTeam(last);
      return parts.join(' ');
    }
    return s;
  };

  /* --------------------------------- small inputs --------------------------------- */
  function TextInput({ value, placeholder, onCommit, maxLength, counterFrom, disabled }) {
    const [local, setLocal] = useState(value ?? '');
    useEffect(() => { setLocal(value ?? ''); }, [value]);
    const commit = () => onCommit(local.trim() === '' ? undefined : local.trim());
    const onKeyDown = (e) => { if (e.key === 'Enter') commit(); };

    const left = typeof counterFrom === 'number'
      ? Math.max(0, counterFrom - (local?.length ?? 0))
      : null;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: left !== null ? '1fr auto' : '1fr', gap: 8, alignItems: 'center' }}>
        <input
          value={local}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          disabled={disabled}
        />
        {left !== null && <span style={{ fontSize: 12, opacity: .7, whiteSpace: 'nowrap' }}>{left} left</span>}
      </div>
    );
  }

  function TextArea({ value, placeholder, onCommit, maxLength, rows = 2 }) {
    const [local, setLocal] = useState(value ?? '');
    useEffect(() => { setLocal(value ?? ''); }, [value]);
    const commit = () => onCommit(local.trim() === '' ? undefined : local.trim());
    const onKeyDown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); };
    return (
      <textarea
        value={local}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={{ resize: 'vertical' }}
      />
    );
  }

  const ClearBtn = ({ onClick }) => <button onClick={onClick} className="wb-danger" type="button">Clear</button>;

  const numInput = (val, setPath, { min = 0, max = 10, step = 1 } = {}) => (
    <input
      type="number"
      value={val ?? ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') set(setPath, undefined);
        else set(setPath, Number(raw));
      }}
    />
  );

  /* ============================= Player Autocomplete ============================== */
  const INCLUDE_POS = new Set(['QB', 'RB', 'WR', 'TE']);
  const ALWAYS_KEEP = new Set(['TRAVIS HUNTER']); // plays both ways

  const allPlayerOptions = useMemo(() => {
    const arr = [];
    for (const [id, p] of Object.entries(playersById || {})) {
      const name = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).trim();
      if (!name) continue;
      const pos = (Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : p.position || '').toUpperCase();
      const teamRaw = (p.team || p.pro_team || p.team_abbr || '');
      const team = canonicalTeam(teamRaw);

      const keep = INCLUDE_POS.has(pos) || ALWAYS_KEEP.has(name.toUpperCase());
      if (!keep) continue;

      const label = team && pos ? `${name} — ${pos} • ${team}` : name;
      const search = `${name} ${pos} ${team}`.toLowerCase();
      const adp = Number(p.adp_half_ppr ?? p.adp_ppr ?? p.adp ?? p.adp_full_ppr ?? p.adp_std);

      arr.push({ id, name, label, search, pos, team, adp: isFinite(adp) ? adp : 9999 });
    }
    arr.sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
    return arr;
  }, [playersById]);

  const rosterOptions = useMemo(() => {
    const opts = [];
    for (const id of rosterIds || []) {
      const p = playersById?.[id];
      if (!p) continue;
      const name = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).trim();
      const pos  = (Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : p.position || '').toUpperCase();
      const teamRaw = (p.team || p.pro_team || p.team_abbr || '');
      const team = canonicalTeam(teamRaw);
      const keep = INCLUDE_POS.has(pos) || ALWAYS_KEEP.has(name.toUpperCase());
      if (!keep) continue;

      const commitStr = [name, pos, team].filter(Boolean).join(' ');
      const label     = team && pos ? `${name} — ${pos} • ${team}` : name;
      if (!opts.some(o => o.value === commitStr)) {
        opts.push({ value: commitStr, label, name, pos, team, id });
      }
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [rosterIds, playersById]);

  function PlayerAutocomplete({ value, placeholder, onCommit, maxResults = 14 }) {
    const [input, setInput] = useState(value ?? '');
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(-1);

    useEffect(() => { setInput(value ?? ''); }, [value]);

    const q = (input || '').toLowerCase().trim();
    const suggestions = useMemo(() => {
      if (!allPlayerOptions.length) return [];
      if (!q) return allPlayerOptions.slice(0, maxResults);
      const starts = []; const contains = [];
      for (const opt of allPlayerOptions) {
        if (opt.search.startsWith(q)) starts.push(opt);
        else if (opt.search.includes(q)) contains.push(opt);
        if (starts.length >= maxResults) break;
      }
      return [...starts, ...contains].slice(0, maxResults);
    }, [q, allPlayerOptions, maxResults]);

    const commit = (val) => onCommit(val && val.trim() ? val.trim() : undefined);

    const onKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) setOpen(true);
        else setHover((h) => Math.min((h < 0 ? -1 : h) + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (open) setHover((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && hover >= 0 && suggestions[hover]) {
          const chosen = suggestions[hover];
          setInput(chosen.name);
          setOpen(false);
          setHover(-1);
          commit([chosen.name, chosen.pos, chosen.team].filter(Boolean).join(' '));
        } else {
          setOpen(false);
          const exact = allPlayerOptions.find(opt => opt.name.toLowerCase() === (input||'').toLowerCase().trim());
          if (exact) commit([exact.name, exact.pos, exact.team].filter(Boolean).join(' '));
          else commit(input);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };

    return (
      <div style={{ position: 'relative' }}>
        <input
          value={input}
          placeholder={placeholder}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            const exact = allPlayerOptions.find(opt => opt.name.toLowerCase() === (input||'').toLowerCase().trim());
            if (exact) commit([exact.name, exact.pos, exact.team].filter(Boolean).join(' '));
            else commit(input);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          style={{ width: '100%' }}
        />
        {open && suggestions.length > 0 && (
          <div
            style={{
              position: 'absolute', zIndex: 9999, top: '100%', left: 0, right: 0,
              background: '#fff', border: '1px solid #ddd', borderRadius: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,.12)', marginTop: 4, maxHeight: 260, overflow: 'auto'
            }}
          >
            {suggestions.map((opt, idx) => (
              <div
                key={opt.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(opt.name);
                  setOpen(false);
                  setHover(-1);
                  commit([opt.name, opt.pos, opt.team].filter(Boolean).join(' '));
                }}
                onMouseEnter={() => setHover(idx)}
                onMouseLeave={() => setHover(-1)}
                style={{ padding: '8px 10px', cursor: 'pointer', background: hover === idx ? '#f3f4f6' : 'transparent', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
              >
                <span style={{ opacity: .55, minWidth: 42, fontSize: 12 }}>
                  {opt.pos}{opt.team ? ` • ${opt.team}` : ''}
                </span>
                <span>{opt.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function resolveIdFromCommitString(commitStr) {
    if (!commitStr) return undefined;
    const parts = String(commitStr).trim().split(/\s+/);
    if (!parts.length) return undefined;

    const maybeTeam = parts[parts.length - 1]?.toUpperCase();
    the_return: { }
    const maybePos  = parts[parts.length - 2]?.toUpperCase();
    const posIsKnown = ['QB','RB','WR','TE'].includes(maybePos);
    const name = parts.slice(0, parts.length - (posIsKnown ? 2 : 1)).join(' ').trim();

    let cands = allPlayerOptions.filter(o => o.name.toLowerCase() === name.toLowerCase());
    if (!cands.length) return undefined;

    if (posIsKnown) cands = cands.filter(o => o.pos === maybePos);
    if (maybeTeam && cands.length > 1) cands = cands.filter(o => o.team === maybeTeam);

    return cands[0]?.id;
  }

  function LabelCombo({ value, onCommit, options, listId, placeholder = 'Select or type…', maxLength = 40 }) {
    const [local, setLocal] = useState(value ?? '');
    useEffect(() => { setLocal(value ?? ''); }, [value]);
    const commit = () => onCommit(local.trim() === '' ? undefined : local.trim());
    const onKeyDown = (e) => { if (e.key === 'Enter') commit(); };

    return (
      <div>
        <input
          list={listId}
          value={local}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e)=>setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{ width:'100%' }}
        />
        <datalist id={listId}>
          {options.map(opt => <option key={opt} value={opt} />)}
        </datalist>
      </div>
    );
  }

  /* ====== NEW: Combobox for Top Waivers (type-to-search + dropdown) ====== */
  function WaiverCombo({ value, options, onChange, placeholder = "Type to search…" }) {
    // value is a player id (string or '')
    const idToLabel = useMemo(() => {
      const map = new Map();
      for (const opt of options || []) map.set(String(opt.id), opt.label);
      return map;
    }, [options]);

    const [local, setLocal] = useState(value ? (idToLabel.get(String(value)) || "") : "");
    useEffect(() => {
      setLocal(value ? (idToLabel.get(String(value)) || "") : "");
    }, [value, idToLabel]);

    const commit = () => {
      const txt = (local || "").trim().toLowerCase();
      if (!txt) { onChange?.(undefined); return; }
      // exact label match
      const hit = (options || []).find(o => o.label.toLowerCase() === txt);
      if (hit) { onChange?.(String(hit.id)); return; }
      // allow direct id paste
      const byId = (options || []).find(o => String(o.id) === local.trim());
      if (byId) { onChange?.(String(byId.id)); return; }
      onChange?.(undefined);
    };

    const listId = useMemo(() => `waivers-list-${Math.random().toString(36).slice(2)}`, []);
    const onKeyDown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } };

    return (
      <>
        <input
          list={listId}
          value={local}
          onChange={(e)=> setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          style={{ width: "100%" }}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id={listId}>
          {(options || []).map(opt => (
            <option key={opt.id} value={opt.label} />
          ))}
        </datalist>
      </>
    );
  }

  /* ============================ SW options ============================ */
  const STRENGTH_OPTIONS = [
    'Best WR Room In The League','Best RB Room In The League','Best TE Room In The League','Best QB Room In The League',
    'Strong WR Room','Strong RB Room','High Upside','Low Risk','Strong TE Room','Strong QB Room','Strong Reliability','Strong Depth',
    'Value Necessary To Pivot','Has Tools to Make a Playoff Push',
  ];
  const WEAKNESS_OPTIONS = [
    'Weak WR Room','Weak RB Room','Low Upside','High Risk','Weak TE Room','Weak QB Room','Weak Reliability','Weak Depth',
    'Changes are Necessary to Compete',
  ];

  /* ============================ Roster Tag options ============================ */
  const ROSTER_TAG_OPTIONS = [
    'The Juggernaut','Riskit For Biskit','Safe And Sound','Balanced Approach','Wi Tu Lo','Mariana Trench','Star Studded',
  ];

  /* ============================ Moves editor (unchanged) ============================ */
  const LABEL_OPTIONS = ['TRADE', 'UPTIER', 'PIVOT'];
  const MoveCardEditor = ({ moveId, title }) => {
    const base = `moves.${moveId}`;
    const label   = get(`${base}.label`, '');
    const primary = get(`${base}.primary`, '');
    const rec0    = get(`${base}.recs.0`, '');
    const rec1    = get(`${base}.recs.1`, '');
    const note    = get(`${base}.note`, '');

    const setRec = (idx, val) => {
      const a = [get(`${base}.recs.0`, undefined), get(`${base}.recs.1`, undefined)];
      a[idx] = val;
      const clean = a.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
      set(`${base}.recs`, clean.length ? clean : undefined);

      const ids = [get(`${base}.recsIds.0`, undefined), get(`${base}.recsIds.1`, undefined)];
      ids[idx] = resolveIdFromCommitString(val);
      const idClean = ids.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
      set(`${base}.recsIds`, idClean.length ? idClean : undefined);
    };

    const defaultLabel = moveId === 'trade' ? 'TRADE' : moveId === 'uptier' ? 'UPTIER' : 'PIVOT';

    const primaryField = () => {
      if (rosterOptions.length > 0) {
        const normalizedPrimary = get(`${base}.primary`, '');
        const valueIsOption = rosterOptions.some(o => o.value === normalizedPrimary);
        const selected = valueIsOption ? normalizedPrimary : '';
        return (
          <select
            value={selected}
            onChange={(e) => {
              const val = e.target.value || undefined;
              set(`${base}.primary`, val);
              const opt = rosterOptions.find(o => o.value === val);
              set(`${base}.primaryId`, opt?.id || undefined);
            }}
          >
            <option value="">— Select player from your roster —</option>
            {rosterOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );
      }
      return (
        <PlayerAutocomplete
          value={get(`${base}.primary`, '')}
          placeholder="start typing a player…"
          onCommit={(v) => {
            set(`${base}.primary`, v);
            set(`${base}.primaryId`, resolveIdFromCommitString(v));
          }}
          maxResults={14}
        />
      );
    };

    const playerField = (value, onCommit) => {
      const hasPlayers = playersById && Object.keys(playersById).length > 0;
      return hasPlayers ? (
        <PlayerAutocomplete value={value} placeholder="start typing a player…" onCommit={onCommit} maxResults={14} />
      ) : (
        <TextInput value={value} placeholder="type player name…" onCommit={onCommit} maxLength={64} />
      );
    };

    return (
      <div className="wb-card" style={{ padding: 12, overflow: 'visible' }}>
        <div className="wb-card__title" style={{ marginBottom: 8 }}>{title}</div>

        <div className="wb-row" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Column Label</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <select
              value={(label || defaultLabel).toUpperCase()}
              onChange={(e) => set(`${base}.label`, e.target.value.toUpperCase())}
            >
              {LABEL_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <ClearBtn onClick={() => set(`${base}.label`, undefined)} />
          </div>
        </div>

        <div className="wb-row" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Primary (pick from your roster)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            {primaryField()}
            <ClearBtn onClick={() => { set(`${base}.primary`, undefined); set(`${base}.primaryId`, undefined); }} />
          </div>
        </div>

        <div className="wb-row" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Recommendation A (choose player)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            {playerField(get(`${base}.recs.0`, ''), (v) => {
              const cur = [get(`${base}.recs.0`, undefined), get(`${base}.recs.1`, undefined)];
              cur[0] = v;
              const clean = cur.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recs`, clean.length ? clean : undefined);

              const ids = [get(`${base}.recsIds.0`, undefined), get(`${base}.recsIds.1`, undefined)];
              ids[0] = resolveIdFromCommitString(v);
              const idClean = ids.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recsIds`, idClean.length ? idClean : undefined);
            })}
            <ClearBtn onClick={() => {
              const cur = [get(`${base}.recs.0`, undefined), get(`${base}.recs.1`, undefined)];
              cur[0] = undefined;
              const clean = cur.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recs`, clean.length ? clean : undefined);

              const ids = [get(`${base}.recsIds.0`, undefined), get(`${base}.recsIds.1`, undefined)];
              ids[0] = undefined;
              const idClean = ids.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recsIds`, idClean.length ? idClean : undefined);
            }} />
          </div>
        </div>

        <div className="wb-row">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Recommendation B (choose player)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            {playerField(get(`${base}.recs.1`, ''), (v) => {
              const cur = [get(`${base}.recs.0`, undefined), get(`${base}.recs.1`, undefined)];
              cur[1] = v;
              const clean = cur.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recs`, clean.length ? clean : undefined);

              const ids = [get(`${base}.recsIds.0`, undefined), get(`${base}.recsIds.1`, undefined)];
              ids[1] = resolveIdFromCommitString(v);
              const idClean = ids.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recsIds`, idClean.length ? idClean : undefined);
            })}
            <ClearBtn onClick={() => {
              const cur = [get(`${base}.recs.0`, undefined), get(`${base}.recs.1`, undefined)];
              cur[1] = undefined;
              const clean = cur.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recs`, clean.length ? clean : undefined);

              const ids = [get(`${base}.recsIds.0`, undefined), get(`${base}.recsIds.1`, undefined)];
              ids[1] = undefined;
              const idClean = ids.filter((x, i, ar) => x !== undefined || i < ar.length - 1);
              set(`${base}.recsIds`, idClean.length ? idClean : undefined);
            }} />
          </div>
        </div>

        <div className="wb-row" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Option / Note</div>
          <TextInput
            value={get(`${base}.note`, '')}
            placeholder="e.g., Package WR2 + RB4 for elite TE; or flip TE for WR upgrade"
            onCommit={(v) => set(`${base}.note`, v)}
            maxLength={200}
          />
        </div>
      </div>
    );
  };

  /* ============================ Badges (dropdown + free-typing) ============================ */
  const SWRow = ({ index }) => {
    const base  = `rosterStrengths.items.${index}`;
    const color = get(`${base}.color`, '');
    const label = get(`${base}.label`, '');

    const listId = `sw-opts-${index}`;
    const options = color === 'green'
      ? STRENGTH_OPTIONS
      : color === 'red'
        ? WEAKNESS_OPTIONS
        : [...STRENGTH_OPTIONS, ...WEAKNESS_OPTIONS];

    return (
      <div className="wb-row sw-row" style={{ display:'grid', gridTemplateColumns:'auto 1fr 2fr auto', gap:8, alignItems:'center' }}>
        <div style={{ fontWeight:700, opacity:.8 }}>Badge {index + 1}</div>

        <select value={color} onChange={(e) => set(`${base}.color`, e.target.value || undefined)}>
          <option value="">Auto</option>
          <option value="green">Strength (Green)</option>
          <option value="red">Weakness (Red)</option>
        </select>

        <LabelCombo
          value={label}
          onCommit={(v) => set(`${base}.label`, v)}
          options={options}
          listId={listId}
          placeholder="Select or type a label…"
          maxLength={40}
        />

        <button onClick={() => set(base, undefined)} className="wb-danger" type="button">Clear</button>
      </div>
    );
  };

  /* ======================== Manual Roster (unchanged) ======================== */
  const ManualRosterSection = () => {
    const initial = Array.isArray(o?.manual?.roster) ? o.manual.roster : [];
    const normalizeRow = (r) => {
      if (!r) return { name: '', id: undefined };
      if (typeof r === 'string') return { name: r, id: undefined };
      return { name: r.name || '', id: r.id || r.playerId || undefined };
    };
    const initialRows = initial.map(normalizeRow);
    const initialCount = Math.max(12, initialRows.length);

    const [rows, setRows] = useState(
      Array.from({ length: initialCount }, (_, i) => initialRows[i] || { name: '', id: undefined })
    );
    const [savedFlag, setSavedFlag] = useState(false);

    const setRow = (idx, nameVal) => {
      const name = normalizeCommitStringTeam(nameVal || '');
      const id = resolveIdFromCommitString(name) || undefined;
      setRows((prev) => {
        const next = prev.slice();
        next[idx] = { name, id };
        return next;
      });
    };

    const addRow = () => setRows((prev) => [...prev, { name: '', id: undefined }]);
    const submit = () => {
      const payload = rows
        .map((r) => ({ name: (r.name || '').trim(), id: r.id }))
        .filter((r) => r.name.length > 0);
      set('manual.roster', payload.length ? payload : undefined);
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 1600);
    };

    const Row = ({ index }) => (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
        <PlayerAutocomplete
          value={rows[index]?.name || ''}
          placeholder="start typing a player…"
          onCommit={(v) => setRow(index, v)}
          maxResults={14}
        />
        <ClearBtn onClick={() => setRow(index, '')} />
      </div>
    );

    return (
      <div style={{ display: 'grid', gap: 8, gridColumn: '1 / -1' }}>
        {rows.map((_, idx) => (<Row key={idx} index={idx} />))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={addRow}>Add Player</button>
          <button type="button" onClick={submit}>Save Manual Roster</button>
          {savedFlag && <span style={{ fontSize: 12, color: '#2c7' }}>Saved!</span>}
        </div>

        <div style={{ fontSize: 12, opacity: .75, marginTop: 6 }}>Saved manual roster:</div>
        <pre style={{ background: '#fafafa', border: '1px solid #ddd', padding: 8, fontSize: 12, maxHeight: 140, overflow: 'auto' }}>
          {JSON.stringify(o?.manual?.roster || [], null, 2)}
        </pre>
      </div>
    );
  };

  /* ----------------------------- Background picker ----------------------------- */
  const bgVariant = get('background.variant', 'wb1');
  const setBgExclusive = (variant, checked) => {
    set('background.variant', checked ? variant : undefined);
  };

  const board = get('manualDraft.board', 'green');
  const setBoardExclusive = (color, checked) => {
    set('manualDraft.board', checked ? color : undefined);
  };

  /* --------- PRESETS for Manual Waivers (single tile) --------- */
  const WAIVER_PRESETS = [
    { id: 'WR_UPSIDE', label: 'WR UPSIDE' }, // #7ab274
    { id: 'RB_UPSIDE', label: 'RB UPSIDE' }, // #81c6c9
    { id: 'QB_UPSIDE', label: 'QB UPSIDE' }, // #c15252
    { id: 'TE_UPSIDE', label: 'TE UPSIDE' }, // #f0c05f
  ];

  /* ------------------ League free agents for Top Waivers overrides ------------------ */
  const leagueIdFromUrl = useMemo(
    () => new URLSearchParams(window.location.search).get('leagueId') || '',
    []
  );
  const [leagueRostered, setLeagueRostered] = useState(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!leagueIdFromUrl) { setLeagueRostered(new Set()); return; }
      try {
        const rosters = await fetchLeagueRosters(leagueIdFromUrl);
        if (cancelled) return;
        const s = new Set();
        for (const r of rosters || []) for (const pid of r?.players || []) s.add(String(pid));
        setLeagueRostered(s);
      } catch {
        setLeagueRostered(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [leagueIdFromUrl]);

  const faOptionsSorted = useMemo(() => {
    const out = [];
    for (const [id, p] of Object.entries(playersById || {})) {
      const pid = String(id);
      if (leagueRostered.has(pid)) continue; // free agents only

      const pos =
        (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) ||
        p.position || '';
      const POS = String(pos).toUpperCase();
      if (!['QB','RB','WR','TE'].includes(POS)) continue;

      const team = (p.team || p.pro_team || p.team_abbr || '').toUpperCase();
      const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || pid;

      const rank = Number(gradeData?.[pid]?.rank ?? Infinity);
      if (!Number.isFinite(rank)) continue;

      out.push({ id: pid, label: team ? `${name} — ${POS} • ${team}` : `${name} — ${POS}`, rank });
    }
    out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
    return out;
  }, [playersById, leagueRostered]);

  const waiverOverrideIds = [
    get('topWaivers.overrideIds.0', ''),
    get('topWaivers.overrideIds.1', ''),
    get('topWaivers.overrideIds.2', ''),
  ];

  return (
    <div className="wb-tweaks">
      <div className="wb-grid">
        {/* Team & Tag */}
        <label>Team Name</label>
        <TextInput value={get('teamName', '')} placeholder="override team name…" onCommit={(v) => set('teamName', v)} />

        <label>Roster Tag</label>
        <LabelCombo
          value={get('rosterTag', '')}
          onCommit={(v) => set('rosterTag', v)}
          options={ROSTER_TAG_OPTIONS}
          listId="roster-tag-options"
          placeholder="Select or type a roster tag…"
          maxLength={40}
        />

        {/* Board Background */}
        <div className="wb-sep">Board Background</div>
        <div style={{ display:'flex', gap:16, alignItems:'center' }}>
          <label style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={bgVariant === 'wb1'} onChange={(e)=> setBgExclusive('wb1', e.target.checked)} />
            <span>Classic (WB-Base.png)</span>
          </label>
          <label style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={bgVariant === 'wb2'} onChange={(e)=> setBgExclusive('wb2', e.target.checked)} />
            <span>Alternate (WB2-base.png)</span>
          </label>
        </div>

        {/* League Settings (override) */}
        <div className="wb-sep">League Settings (override)</div>
        <label>Teams</label>{numInput(get('leagueSettings.teams', null), 'leagueSettings.teams', { min:2, max:20 })}
        <label>PPR Scoring</label>
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:8 }}>
          <input
            type="checkbox"
            checked={!!get('leagueSettings.ppr', false)}
            onChange={(e)=> set('leagueSettings.ppr', e.target.checked || undefined)}
          />
          <span style={{ fontSize:12, opacity:.7 }}>If unchecked, treated as Standard</span>
        </div>

        {/* NEW: Scoring (label/value) */}
        <label>Scoring (label/value)</label>
        <TextInput
          value={get('leagueSettings.scoring', '')}
          placeholder="e.g., PPR, STD, 0.5"
          onCommit={(v)=> set('leagueSettings.scoring', v)}
          maxLength={12}
        />

        <label>TE Premium (points)</label>{numInput(get('leagueSettings.tepValue', null), 'leagueSettings.tepValue', { min:0, max:5, step:0.1 })}

        <div style={{ gridColumn:'1 / -1', display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:8, alignItems:'center' }}>
          <div style={{ gridColumn:'1 / -1', fontSize:12, opacity:.8, margin:'4px 0 2px' }}>Positions</div>
          <span>QB</span>{numInput(get('leagueSettings.positions.qb', null), 'leagueSettings.positions.qb', { min:0, max:3 })}
          <span>RB</span>{numInput(get('leagueSettings.positions.rb', null), 'leagueSettings.positions.rb', { min:0, max:6 })}
          <span>WR</span>{numInput(get('leagueSettings.positions.wr', null), 'leagueSettings.positions.wr', { min:0, max:6 })}
          <span>TE</span>{numInput(get('leagueSettings.positions.te', null), 'leagueSettings.positions.te', { min:0, max:3 })}
          <span>FLEX</span>{numInput(get('leagueSettings.positions.flex', null), 'leagueSettings.positions.flex', { min:0, max:6 })}
          <span>SF</span>{numInput(get('leagueSettings.positions.sf', null), 'leagueSettings.positions.sf', { min:0, max:3 })}
          <span>DEF</span>{numInput(get('leagueSettings.positions.def', null), 'leagueSettings.positions.def', { min:0, max:3 })}
          <span>K</span>{numInput(get('leagueSettings.positions.k', null), 'leagueSettings.positions.k', { min:0, max:3 })}
          <span>Bench</span>{numInput(get('leagueSettings.positions.bench', null), 'leagueSettings.positions.bench', { min:0, max:20 })}
        </div>

        {/* League Power Rank */}
        <div className="wb-sep">League Power Rank</div>
        <label>Rank (1 = best)</label>{numInput(get('powerRanking.rank', null), 'powerRanking.rank', { min:1, max:99 })}

        {/* Four Factors */}
        <div className="wb-sep">Four Factors (0–10)</div>
        <label>Upside</label>{numInput(get('fourFactors.upside', null), 'fourFactors.upside')}
        <label>Reliability</label>{numInput(get('fourFactors.reliability', null), 'fourFactors.reliability')}
        <label>Depth</label>{numInput(get('fourFactors.depth', null), 'fourFactors.depth')}
        <label>Risk</label>{numInput(get('fourFactors.risk', null), 'fourFactors.risk')}

        {/* Positional Grades */}
        <div className="wb-sep">Positional Grades (0–10)</div>
        <label>QB</label>{numInput(get('positionalGrades.QB', null), 'positionalGrades.QB')}
        <label>RB</label>{numInput(get('positionalGrades.RB', null), 'positionalGrades.RB')}
        <label>WR</label>{numInput(get('positionalGrades.WR', null), 'positionalGrades.WR')}
        <label>TE</label>{numInput(get('positionalGrades.TE', null), 'positionalGrades.TE')}

        {/* Roster Strengths & Weaknesses (manual overrides) */}
        <div className="wb-sep">Roster Strengths &amp; Weaknesses</div>
        <div className="wb-row" style={{ gridColumn:'1 / -1', fontSize:12, opacity:.75, margin:'2px 0 8px' }}>
          Leave any badge blank to auto-pick. Fill 2 greens + 1 red (or vice-versa) to force labels.
        </div>
        <SWRow index={0} />
        <SWRow index={1} />
        <SWRow index={2} />
        <div className="wb-row" style={{ gridColumn:'1 / -1', display:'flex', justifyContent:'flex-end', marginTop:4 }}>
          <button type="button" className="wb-danger" onClick={() => set('rosterStrengths.items', undefined)}>Clear All (Auto)</button>
        </div>

        {/* Draft Value Grade (manual) */}
        <div className="wb-sep">Draft Value Grade (manual)</div>
        <label>Show manual grade overlay</label>
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center' }}>
          <input type="checkbox" checked={!!get('manualDraft.enabled', false)} onChange={(e)=> set('manualDraft.enabled', e.target.checked || undefined)} />
          <span style={{ fontSize:12, opacity:.7 }}>When ON, replaces the Draft Value Chart with a manual overlay.</span>
        </div>
        <label>Grade (0–10)</label>
        {numInput(get('manualDraft.grade', null), 'manualDraft.grade', { min:0, max:10, step:0.1 })}

        {/* Manual board color */}
        <label>Manual board color</label>
        <div style={{ display:'flex', gap:16, alignItems:'center' }}>
          <label style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={get('manualDraft.board', 'green') === 'red'} onChange={(e)=> set('manualDraft.board', e.target.checked ? 'red' : undefined)} />
            <span>Red</span>
          </label>
          <label style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={get('manualDraft.board', 'green') === 'yellow'} onChange={(e)=> set('manualDraft.board', e.target.checked ? 'yellow' : undefined)} />
            <span>Yellow</span>
          </label>
          <label style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={get('manualDraft.board', 'green') === 'green'} onChange={(e)=> set('manualDraft.board', e.target.checked ? 'green' : undefined)} />
            <span>Green</span>
          </label>
        </div>

        {/* Top Waivers (manual overlay) — SINGLE TILE */}
        <div className="wb-sep">Top Waivers (manual overlay)</div>

        <label>Show manual Top Waivers</label>
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center' }}>
          <input
            type="checkbox"
            checked={!!get('manualWaivers.enabled', false)}
            onChange={(e)=> set('manualWaivers.enabled', e.target.checked || undefined)}
          />
          <span style={{ fontSize:12, opacity:.7 }}>When ON, replaces the auto waivers with a single full-width tile.</span>
        </div>

        <label>Tile preset</label>
        <select
          value={get('manualWaivers.preset', '')}
          onChange={(e)=> set('manualWaivers.preset', e.target.value || undefined)}
        >
          <option value="">— Select a preset —</option>
          {WAIVER_PRESETS.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <label>Custom label (optional)</label>
        <TextInput
          value={get('manualWaivers.label', '')}
          placeholder="leave blank to use preset label…"
          onCommit={(v)=> set('manualWaivers.label', v)}
          maxLength={40}
        />

        {/* NEW: Top Waivers Overrides (3 comboboxes; type + choose; stores player id) */}
        <div className="wb-sep">Top Waivers Overrides</div>
        <div style={{ gridColumn:'1 / -1', fontSize:12, opacity:.75, margin:'2px 0 8px' }}>
          Pick exact players to show as <b>#1</b>, <b>#2</b>, <b>#3</b>. List shows <b>league free agents</b> (not on any roster), sorted by your Domain rank.
        </div>

        {[0,1,2].map((idx) => (
          <div key={idx} className="wb-row" style={{ display:'grid', gridTemplateColumns:'auto 1fr auto', gap:8, alignItems:'center' }}>
            <div style={{ fontWeight:700, opacity:.8 }}>Player {idx + 1}</div>

            {/* <= replaced <select> with combobox */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
              <WaiverCombo
                value={waiverOverrideIds[idx] || ''}
                options={faOptionsSorted}
                onChange={(id) => set(`topWaivers.overrideIds.${idx}`, id || undefined)}
                placeholder="Type name, then choose…"
              />
              <div style={{ fontSize: 11, opacity: 0.65 }}>
                Tip: start typing to filter; choose a suggestion or press Enter.
              </div>
            </div>

            <button type="button" className="wb-danger" onClick={()=> set(`topWaivers.overrideIds.${idx}`, undefined)}>Clear</button>
          </div>
        ))}

        {/* White Box Overlay */}
        <div className="wb-sep">White Box Overlay</div>
        <label>Show white box overlay</label>
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center' }}>
          <input
            type="checkbox"
            checked={!!get('whiteBox.enabled', false)}
            onChange={(e)=> set('whiteBox.enabled', e.target.checked || undefined)}
          />
          <span style={{ fontSize:12, opacity:.7 }}>Toggle the white cover PNG (place/size in Whiteboard.jsx).</span>
        </div>

        {/* Final Verdict */}
        <div className="wb-sep">Final Verdict</div>
        <label>Stars (1–5)</label>{numInput(get('finalVerdict.stars', null), 'finalVerdict.stars', { min: 1, max: 5 })}
        <label>Verdict Text</label>
        <TextInput
          value={get('finalVerdict.note', '')}
          placeholder="Type your verdict (max 450 chars)…"
          onCommit={(v) => set('finalVerdict.note', v)}
          maxLength={450}
          counterFrom={450}
        />

        {/* Moves To Make */}
        <div className="wb-sep">Moves To Make (choose players)</div>
        <MoveCardEditor moveId="trade"  title="#1 Column" />
        <MoveCardEditor moveId="uptier" title="#2 Column" />
        <MoveCardEditor moveId="pivot"  title="#3 Column" />

        {/* Manual Roster */}
        <div className="wb-sep">Manual Roster (type players; 12 rows)</div>
        <ManualRosterSection />

        {/* Actions */}
        <div className="wb-actions-row" style={{ gridColumn:'1 / -1' }}>
          <button onClick={onExport}>{exportLabel}</button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              alert('Share link copied!');
            }}
          >
            Copy Share Link
          </button>
          <button onClick={()=>onOverrides({})} className="wb-danger">Reset All</button>
        </div>

        {/* HUD */}
        <div className="wb-hud" style={{ gridColumn:'1 / -1' }}>
          <div><strong>ownerId:</strong> {hud?.ownerId || '—'}</div>
          <div><strong>roster:</strong> {hud?.rosterCount ?? 0}</div>
          <div><strong>starters:</strong> {hud?.startersCount ?? 0}</div>
          <div><strong>loading:</strong> {String(hud?.loading ?? false)}</div>
          {hud?.err && <div className="wb-err">{hud.err}</div>}
        </div>
      </div>
    </div>
  );
}

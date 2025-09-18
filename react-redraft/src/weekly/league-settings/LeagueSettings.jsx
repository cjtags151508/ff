import React from 'react';
import './league-settings.css';

export default function LeagueSettings({ settings }) {
  const teams = Number(settings?.teams ?? 12);

  // scoring label
  const pprNum = Number(settings?.ppr ?? 0);
  const is = (x) => Math.abs(pprNum - x) < 1e-6;
  let scoringLabel = 'STD';
  if (is(1)) scoringLabel = 'PPR';
  else if (is(0.5)) scoringLabel = 'Half';

  const tepValue = Number(settings?.tepValue ?? 0);

  // positions (combine FLEX + SFLEX for display)
  const pos = settings?.positions || {};
  const qb    = Number(pos.qb    ?? 0);
  const rb    = Number(pos.rb    ?? 0);
  const wr    = Number(pos.wr    ?? 0);
  const te    = Number(pos.te    ?? 0);
  const bench = Number(pos.bench ?? 0);
  const def   = Number(pos.def   ?? 0);
  const k     = Number(pos.k     ?? 0);

  const wrtFlex = Number(pos.flex ?? 0);                // W/R/T
  const sflex   = Number(pos.sf ?? pos.superflex ?? 0); // Q/W/R/T
  const hasSFKey = ('sf' in pos) || ('superflex' in pos);
  const combinedFlex = hasSFKey ? (wrtFlex + sflex) : (wrtFlex || sflex);

  const cells = [
    ['QB',   'qb',    qb],
    ['RB',   'rb',    rb],
    ['WR',   'wr',    wr],
    ['TE',   'te',    te],
    ['FLEX', 'flex',  combinedFlex],
  ];
  if (def > 0) cells.push(['DEF', 'def', def]);
  if (k   > 0) cells.push(['K',   'k',   k]);
  cells.push(['Bench', 'bench', bench]);

  return (
    <div className="league-settings-container">
      <div className="league-settings">
        {/* Teams */}
        <div className="setting">
          <div className="setting-label">Teams</div>
          <div className="setting-box teams">{teams}</div>
        </div>

        {/* Scoring */}
        <div className="setting">
          <div className="setting-label">Scoring</div>
          <div className="setting-box scoring">{scoringLabel}</div>
        </div>

        {/* TEP (only when > 0) */}
        {tepValue > 0 && (
          <div className="setting">
            <div className="setting-label">TEP</div>
            <div className="setting-box tep">{tepValue}</div>
          </div>
        )}

        {/* Positions (FLEX combined; no separate SF pill) */}
        {cells.map(([label, cls, count]) => (
          <div className="setting" key={cls}>
            <div className="setting-label">{label}</div>
            <div className={`setting-box ${cls}`}>{count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

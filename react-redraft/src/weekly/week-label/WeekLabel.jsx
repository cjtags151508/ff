// /src/weekly/week-label/WeekLabel.jsx
import React from "react";
import "./week-label.css";

/**
 * Text-only label. No background (your PNG has the green pill).
 * Pass either:
 *   - week={number}  -> renders "WEEK {n}"
 *   - text="WEEK 4"  -> renders exactly the string
 * If both are given, `text` wins.
 */
export default function WeekLabel({
  week,
  text,
  fontSize = 38,
  color = "#2D2D2C",
  weight = 700,
  align = "center",
  width,               // px, optional
  letterGap = 1,
  style = {},
}) {
  const computed = text ?? (Number.isFinite(+week) ? `WEEK ${+week}` : "WEEK 4");
  const label = String(computed).toUpperCase();

  return (
    <div
      className="week-label"
      style={{
        fontSize,
        color,
        fontWeight: weight,
        textAlign: align,
        letterSpacing: `${letterGap}px`,
        width: width ? `${width}px` : undefined,
        ...style,
      }}
      aria-label={label}
      title={label}
    >
      {label}
    </div>
  );
}

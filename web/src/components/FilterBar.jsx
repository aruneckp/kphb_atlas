import React, { useState } from "react";
import { go, GLOBAL } from "../lib/route.js";

const AGE_PRESETS = [
  ["", "", "All ages"],
  ["18", "19", "First-time (18–19)"],
  ["18", "29", "Youth (18–29)"],
  ["30", "59", "30–59"],
  ["60", "", "Senior (60+)"],
  ["80", "", "80 and above"],
];

// The area / gender / age filters apply to every page and live in the address bar.
export default function FilterBar({ route, meta }) {
  const p = route.params;
  const set = (patch) => {
    const next = { ...p, ...patch, page: "" };
    go(route.path, next);
  };
  const stations = meta.stations.filter((s) =>
    (!p.locality || s.locality === p.locality) && (!p.police || s.police_en === p.police) &&
    (!p.mandal || s.mandal_en === p.mandal) && (!p.pin || s.pin === p.pin));
  const ageKey = `${p.age_min || ""}-${p.age_max || ""}`;
  const activeN = GLOBAL.filter((k) => p[k]).length;
  const active = activeN > 0;
  const [open, setOpen] = useState(false);
  return (
    <div className={`filterbar ${open ? "open" : ""}`} role="search" aria-label="Filters for every page">
      <button type="button" className="filter-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide filters" : `Filters${active ? ` (${activeN} on)` : ""}`}
      </button>
      <label>
        <span>Mandal</span>
        <select value={p.mandal || ""} onChange={(e) => set({ mandal: e.target.value, part: "" })}>
          <option value="">All</option>
          {meta.mandals.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label>
        <span>Police station</span>
        <select value={p.police || ""} onChange={(e) => set({ police: e.target.value, part: "" })}>
          <option value="">All</option>
          {meta.police.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label>
        <span>Locality</span>
        <select value={p.locality || ""} onChange={(e) => set({ locality: e.target.value, part: "" })}>
          <option value="">All</option>
          {meta.localities.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label>
        <span>PIN</span>
        <select value={p.pin || ""} onChange={(e) => set({ pin: e.target.value, part: "" })}>
          <option value="">All</option>
          {meta.pins.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="wide">
        <span>Polling station</span>
        <select value={p.part || ""} onChange={(e) => set({ part: e.target.value })}>
          <option value="">All {stations.length} stations</option>
          {stations.map((s) => <option key={s.part_no} value={s.part_no}>{s.part_no} · {s.locality} · {s.voters} voters</option>)}
        </select>
      </label>
      <label>
        <span>Sex</span>
        <select value={p.gender || ""} onChange={(e) => set({ gender: e.target.value })}>
          <option value="">All</option>
          <option value="F">Women</option>
          <option value="M">Men</option>
          <option value="T">Third gender</option>
        </select>
      </label>
      <label>
        <span>Age</span>
        <select value={AGE_PRESETS.some(([a, b]) => `${a}-${b}` === ageKey) ? ageKey : "custom"}
          onChange={(e) => { const [a, b] = e.target.value.split("-"); set({ age_min: a, age_max: b }); }}>
          {AGE_PRESETS.map(([a, b, l]) => <option key={l} value={`${a}-${b}`}>{l}</option>)}
          {!AGE_PRESETS.some(([a, b]) => `${a}-${b}` === ageKey) && <option value="custom">{p.age_min || 18}–{p.age_max || "+"}</option>}
        </select>
      </label>
      {active && (
        <button type="button" className="clear" onClick={() => go(route.path, Object.fromEntries(Object.entries(p).filter(([k]) => !GLOBAL.includes(k))))}>
          Clear filters
        </button>
      )}
    </div>
  );
}

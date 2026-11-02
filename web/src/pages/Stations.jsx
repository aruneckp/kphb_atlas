import React, { useState } from "react";
import { useApi } from "../lib/api.js";
import { globals, link } from "../lib/route.js";
import { num, ratio } from "../lib/format.js";
import { Meter } from "../components/charts.jsx";
import { ErrorBox, Loading, SortTable } from "../components/ui.jsx";
import { scopeLabel } from "./Overview.jsx";

export default function Stations({ params, meta }) {
  const g = globals(params);
  delete g.part;
  const { data, error } = useApi("/api/stations", g);
  const [find, setFind] = useState("");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const f = find.trim().toLowerCase();
  const list = data.filter((s) => !f || String(s.part_no) === f || s.locality.toLowerCase().includes(f) || s.name.includes(find.trim()));
  const maxV = Math.max(...data.map((s) => s.voters));
  const cols = [
    { key: "part_no", label: "PS", num: true, render: (s) => <a href={link(`/stations/${s.part_no}`, params)}><b>{s.part_no}</b></a> },
    { key: "locality", label: "Locality", render: (s) => <>{s.locality}<small className="sub" lang="te">{s.name}</small></> },
    { key: "voters", label: "Voters", num: true, render: (s) => <span className="nm">{num(s.voters)}<Meter value={s.voters} max={maxV} /></span> },
    { key: "ratio", label: "Women / 1,000 men", num: true, value: (s) => s.female / (s.male || 1), render: (s) => ratio(s.female, s.male) },
    { key: "avg_age", label: "Avg age", num: true, render: (s) => s.avg_age },
    { key: "a18_19", label: "First-time", num: true },
    { key: "senior", label: "60+", num: true, value: (s) => s.a60_69 + s.a70_79 + s.a80p, render: (s) => num(s.a60_69 + s.a70_79 + s.a80p) },
    { key: "families", label: "Families", num: true },
    { key: "households", label: "Doors", num: true },
    { key: "review", label: "To check", num: true },
  ];
  return (
    <div className="page">
      <div className="page-title">
        <h2>Polling stations</h2>
        <p>{list.length} stations in {scopeLabel({ ...params, part: "" }, meta).toLowerCase()}. Select a column to sort, a row to open the station.</p>
      </div>
      <div className="toolbar">
        <label className="grow-input">Find a station
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Number, locality or building name" />
        </label>
      </div>
      <SortTable rows={list} cols={cols} initial={{ key: "part_no", dir: 1 }} rowHref={(s) => link(`/stations/${s.part_no}`, params)} className="stations" />
    </div>
  );
}

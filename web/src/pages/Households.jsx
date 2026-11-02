import React, { useEffect, useState } from "react";
import { useApi } from "../lib/api.js";
import { globals, link, go, replace } from "../lib/route.js";
import { num } from "../lib/format.js";
import { ErrorBox, Loading, Pager, SortTable } from "../components/ui.jsx";
import { Meter } from "../components/charts.jsx";

export default function Households({ params }) {
  const [text, setText] = useState(params.q || "");
  useEffect(() => {
    if (text === (params.q || "")) return undefined;
    const t = setTimeout(() => replace("/households", { ...params, q: text, page: "" }), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const min = params.min_size ?? "5";
  const g = globals(params);
  const { data, error, loading } = useApi("/api/households", { part: g.part, locality: g.locality, police: g.police, mandal: g.mandal,
    pin: g.pin, min_size: min, q: params.q, page: params.page });
  const max = data?.rows[0]?.size || 1;
  return (
    <div className="page">
      <div className="page-title">
        <h2>Households</h2>
        <p>Voters who share a door number in the same polling station, largest first. Very large doors are often hostels, apartments or roll errors - good places to verify on the ground.</p>
      </div>
      <div className="toolbar">
        <label className="grow-input">Door number
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 15-31-1 or HIG" />
        </label>
        <label>At least
          <select value={min} onChange={(e) => go("/households", { ...params, min_size: e.target.value, page: "" })}>
            {["1", "2", "5", "10", "20", "50"].map((n) => <option key={n} value={n}>{n} voters</option>)}
          </select>
        </label>
        <span className="grow" />
        {data && <span className="count">{num(data.total)} door numbers{loading ? " · updating" : ""}</span>}
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className={loading ? "dim" : ""}>
          <SortTable rows={data.rows} initial={{ key: "size", dir: -1 }} rowHref={(h) => link(`/household/${h.id}`, params)}
            cols={[
              { key: "house", label: "Door number", render: (h) => <a href={link(`/household/${h.id}`, params)}>{h.house}</a> },
              { key: "part_no", label: "PS", num: true },
              { key: "locality", label: "Locality" },
              { key: "size", label: "Voters", num: true, render: (h) => <span className="nm">{h.size}<Meter value={h.size} max={max} /></span> },
              { key: "families", label: "Families", num: true },
              { key: "male", label: "Men", num: true },
              { key: "female", label: "Women", num: true },
            ]} />
          <Pager page={data.page} size={data.size} total={data.total} onPage={(pg) => go("/households", { ...params, page: pg })} />
        </div>
      )}
    </div>
  );
}

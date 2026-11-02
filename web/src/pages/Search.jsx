import React, { useEffect, useRef, useState } from "react";
import { useApi, downloadCsv } from "../lib/api.js";
import { globals, replace, go } from "../lib/route.js";
import { num } from "../lib/format.js";
import { ErrorBox, Loading, Pager, VoterTable } from "../components/ui.jsx";
import { scopeLabel } from "./Overview.jsx";

const FIELDS = [
  ["any", "Everything"],
  ["name", "Voter name"],
  ["rel", "Relative's name"],
  ["epic", "Voter ID"],
  ["house", "House no."],
  ["sn", "Serial no."],
];
const HINT = {
  any: "Name in Telugu or English, voter ID, house no., or station/serial like 258/45",
  name: "Voter name, e.g. Venkatesh or వెంకటేష్",
  rel: "Father, mother or husband's name",
  epic: "Voter ID, e.g. RDV6803571 - paste several at once",
  house: "Door number, e.g. 15-31-1 or 8-2-23",
  sn: "Serial no. in the station, several, or a range like 100-150",
};

export default function Search({ route, meta, params }) {
  const [text, setText] = useState(params.q || "");
  const field = params.field || "any";
  const box = useRef(null);
  useEffect(() => { setText(params.q || ""); }, [params.q]);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    if (text === (params.q || "")) return undefined;
    const t = setTimeout(() => replace("/search", { ...params, q: text, page: "" }), 280);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => go("/search", { ...params, ...patch, page: patch.page ?? "" });
  const query = { ...globals(params), q: params.q, field, rel: params.rel, review: params.review, dup: params.dup,
    reason: params.reason, sort: params.sort, dir: params.dir, page: params.page, size: 50 };
  const { data, error, loading } = useApi("/api/voters", query);

  return (
    <div className="page">
      <div className="page-title">
        <h2>Find voters</h2>
        <p>Searching {scopeLabel(params, meta).toLowerCase()}. English spellings match Telugu names by sound, so Lakshmi, Laxmi and లక్ష్మి all find the same people.</p>
      </div>
      <form className="searchbox" onSubmit={(e) => { e.preventDefault(); replace("/search", { ...params, q: text, page: "" }); }}>
        <input ref={box} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={HINT[field]}
          aria-label="Search voters" autoComplete="off" spellCheck="false" />
        <div className="pills" role="radiogroup" aria-label="Search in">
          {FIELDS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={field === k} className={field === k ? "pill on" : "pill"}
              onClick={() => set({ field: k })}>{l}</button>
          ))}
        </div>
      </form>
      <div className="toolbar">
        <label>Relative
          <select value={params.rel || ""} onChange={(e) => set({ rel: e.target.value })}>
            <option value="">Any</option><option>Father</option><option>Husband</option><option>Mother</option><option>Other</option>
          </select>
        </label>
        <label>Sort by
          <select value={`${params.sort || "part"}:${params.dir || "asc"}`} onChange={(e) => { const [s, d] = e.target.value.split(":"); set({ sort: s, dir: d }); }}>
            <option value="part:asc">Station and serial no.</option>
            <option value="name:asc">Name (A–Z)</option>
            <option value="age:asc">Age, youngest first</option>
            <option value="age:desc">Age, oldest first</option>
            <option value="house:asc">House no.</option>
            <option value="family:asc">Family</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={params.review === "1"} onChange={(e) => set({ review: e.target.checked ? "1" : "" })} /> Only entries to check</label>
        <label className="check"><input type="checkbox" checked={params.dup === "1"} onChange={(e) => set({ dup: e.target.checked ? "1" : "" })} /> Possible duplicates</label>
        <span className="grow" />
        {data && <span className="count" aria-live="polite">{num(data.total)} voters{loading ? " · updating" : ""}</span>}
        {data?.total > 0 && <button type="button" className="btn" onClick={() => downloadCsv({ ...query, page: "", size: "" })}>Download CSV</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading label="Searching" />}
      {data && (
        <div className={loading ? "dim" : ""}>
          <VoterTable rows={data.rows} params={params} />
          <Pager page={data.page} size={data.size} total={data.total} onPage={(pg) => set({ page: pg })} />
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { useApi } from "../lib/api.js";
import { globals, link, go, replace } from "../lib/route.js";
import { num } from "../lib/format.js";
import { ErrorBox, Loading, Pager } from "../components/ui.jsx";
import { scopeLabel } from "./Overview.jsx";

export default function Families({ params, meta }) {
  const [text, setText] = useState(params.q || "");
  useEffect(() => {
    if (text === (params.q || "")) return undefined;
    const t = setTimeout(() => replace("/families", { ...params, q: text, page: "" }), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const min = params.min_size ?? "3";
  const g = globals(params);
  const { data, error, loading } = useApi("/api/families", { part: g.part, locality: g.locality, police: g.police, mandal: g.mandal, pin: g.pin,
    min_size: min, gens: params.gens, q: params.q, sort: params.sort, page: params.page });
  const set = (patch) => go("/families", { ...params, ...patch, page: "" });
  return (
    <div className="page">
      <div className="page-title">
        <h2>Families</h2>
        <p>Voters in {scopeLabel({ ...params, gender: "", age_min: "", age_max: "" }, meta).toLowerCase()} grouped by the father, mother or husband each one names, inside the same polling station. Relatives who are not on the roll still join their children together.</p>
      </div>
      <div className="toolbar">
        <label className="grow-input">Member name
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Any member, Telugu or English" />
        </label>
        <label>At least
          <select value={min} onChange={(e) => set({ min_size: e.target.value })}>
            {["1", "2", "3", "4", "5", "6", "8", "10"].map((n) => <option key={n} value={n}>{n} voter{n === "1" ? "" : "s"}</option>)}
          </select>
        </label>
        <label>Generations
          <select value={params.gens || ""} onChange={(e) => set({ gens: e.target.value })}>
            <option value="">Any</option><option value="2">2 or more</option><option value="3">3 or more</option>
          </select>
        </label>
        <label>Sort by
          <select value={params.sort || "size"} onChange={(e) => set({ sort: e.target.value })}>
            <option value="size">Largest first</option><option value="gens">Most generations</option>
            <option value="part">Polling station</option><option value="age">Oldest member</option>
          </select>
        </label>
        <span className="grow" />
        {data && <span className="count">{num(data.total)} families{loading ? " · updating" : ""}</span>}
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className={loading ? "dim" : ""}>
          <div className="fam-grid">
            {data.rows.map((f) => (
              <a key={f.id} className="fam-card" href={link(`/family/${f.id}`, params)}>
                <span className="fam-size" aria-label={`${f.size} voters`}>{f.size}</span>
                <span className="fam-body">
                  <span className="fam-head" lang="te">{f.head_name}</span>
                  <span className="fam-en">{f.head_name_en}</span>
                  <span className="fam-meta">PS {f.part_no} · {f.locality} · {f.gens} generation{f.gens > 1 ? "s" : ""} · {f.houses} door{f.houses === 1 ? "" : "s"}{f.ghosts ? ` · ${f.ghosts} not on roll` : ""}</span>
                  <span className="fam-gender"><i style={{ flexGrow: f.male }} className="m" /><i style={{ flexGrow: f.female }} className="f" /></span>
                </span>
              </a>
            ))}
          </div>
          {!data.rows.length && <div className="empty">No families match. Lower the minimum size or clear the name.</div>}
          <Pager page={data.page} size={data.size} total={data.total} onPage={(pg) => go("/families", { ...params, page: pg })} />
        </div>
      )}
    </div>
  );
}

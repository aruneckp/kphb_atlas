import React, { useMemo, useState } from "react";
import { link } from "../lib/route.js";
import { num } from "../lib/format.js";

export const Loading = ({ label = "Loading" }) => <div className="loading" role="status"><span className="spinner" />{label}…</div>;
export const ErrorBox = ({ error }) => <div className="error" role="alert">{error}. Check that the server is running (python3 server/server.py) and reload.</div>;
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function Panel({ title, note, actions, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>{title && <h2>{title}</h2>}{note && <p className="note">{note}</p>}</div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// Numbers row. items: [{label, value, sub, tone}]
export function Kpis({ items }) {
  return (
    <dl className="kpis">
      {items.map((k) => {
        const body = (<>
          <dt>{k.label}</dt>
          <dd>{typeof k.value === "number" ? num(k.value) : k.value}</dd>
          {k.sub && <small>{k.sub}</small>}
        </>);
        return k.href
          ? <a key={k.label} href={k.href} className={`kpi drill ${k.tone || ""}`} title="Drill down">{body}</a>
          : <div key={k.label} className={`kpi ${k.tone || ""}`}>{body}</div>;
      })}
    </dl>
  );
}

export const GenderTag = ({ g }) => <span className={`gtag g-${g}`} title={{ M: "Male", F: "Female", T: "Third gender" }[g] || "Gender not read"}>{{ M: "M", F: "F", T: "TG" }[g] || "?"}</span>;

export function Pager({ page, size, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {num(page)} of {num(pages)}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

// Voter list used on search, station, household pages.
export function VoterTable({ rows, params, showStation = true, focus }) {
  if (!rows?.length) return <Empty>No voters match. Try fewer words, or clear a filter.</Empty>;
  return (
    <div className="table-wrap">
      <table className="grid voters">
        <thead>
          <tr>
            {showStation && <th className="n">PS</th>}
            <th className="n">Sl.</th>
            <th>Name</th>
            <th>Relative</th>
            <th className="n">Age</th>
            <th>Sex</th>
            <th>House no.</th>
            <th>Voter ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className={String(v.id) === String(focus) ? "focus" : ""}>
              {showStation && <td className="n"><a href={link(`/stations/${v.part_no}`, params)}>{v.part_no}</a></td>}
              <td className="n">{v.serial_no}</td>
              <td>
                <a className="vname" href={link(`/voter/${v.id}`, params)}>
                  <span lang="te">{v.name || "Name not read"}</span>
                  <small>{v.name_en}</small>
                </a>
                {v.needs_review ? <span className="flag" title={v.review_reason}>check</span> : null}
              </td>
              <td><span className="rel">{v.rel_type ? `${v.rel_type}: ` : ""}</span><span lang="te">{v.rel_name}</span><small className="sub">{v.rel_name_en}</small></td>
              <td className="n">{v.age ?? "–"}</td>
              <td><GenderTag g={v.gender} /></td>
              <td className="mono-ish">{v.house || "–"}</td>
              <td className="mono-ish">{v.epic || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Client-side sortable table. cols: [{key, label, num, render, width}]
export function SortTable({ rows, cols, initial, rowHref, limit = 1000, className = "" }) {
  const [sort, setSort] = useState(initial || { key: cols[0].key, dir: 1 });
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === sort.key);
    const val = c?.value || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [rows, sort, cols]);
  return (
    <div className="table-wrap">
      <table className={`grid ${className}`}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? "n" : ""} style={c.width ? { width: c.width } : undefined}
                aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : c.num ? -1 : 1 }))}>
                  {c.label}{sort.key === c.key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map((r, i) => (
            <tr key={r.key ?? r.part_no ?? r.area ?? i} onClick={rowHref ? () => { window.location.hash = rowHref(r).slice(1); } : undefined}
              className={rowHref ? "clickable" : ""}>
              {cols.map((c) => <td key={c.key} className={c.num ? "n" : ""}>{c.render ? c.render(r) : c.num ? num(r[c.key]) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

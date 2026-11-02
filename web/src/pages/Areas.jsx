import React, { useMemo, useState } from "react";
import { useApi } from "../lib/api.js";
import { globals, link, go } from "../lib/route.js";
import { num, ratio } from "../lib/format.js";
import { Meter } from "../components/charts.jsx";
import { ErrorBox, Loading, SortTable } from "../components/ui.jsx";
import { drill } from "../lib/drill.js";

const LEVELS = [
  ["tree", "Mandal → police station → locality"],
  ["locality", "Localities"],
  ["police", "Police stations"],
  ["mandal", "Mandals"],
  ["pin", "PIN codes"],
  ["section", "Sections (streets)"],
];

const sumUp = (list) => {
  const o = { voters: 0, male: 0, female: 0, first_time: 0, senior: 0, families: 0, households: 0, review: 0, age: 0, stations: list.length };
  for (const s of list) {
    o.voters += s.voters; o.male += s.male; o.female += s.female; o.first_time += s.a18_19;
    o.senior += s.a60_69 + s.a70_79 + s.a80p; o.families += s.families; o.households += s.households;
    o.review += s.review; o.age += (s.avg_age || 0) * s.voters;
  }
  o.avg_age = o.voters ? (o.age / o.voters).toFixed(1) : "–";
  return o;
};

function Tree({ stations, params }) {
  const tree = useMemo(() => {
    const m = new Map();
    for (const s of stations) {
      const a = m.get(s.mandal_en) || m.set(s.mandal_en, new Map()).get(s.mandal_en);
      const b = a.get(s.police_en) || a.set(s.police_en, new Map()).get(s.police_en);
      const c = b.get(s.locality) || b.set(s.locality, []).get(s.locality);
      c.push(s);
    }
    return m;
  }, [stations]);
  const [open, setOpen] = useState(() => new Set([...tree.keys()].map((k) => `m:${k}`)));
  const toggle = (k) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const max = Math.max(1, ...[...tree.values()].map((a) => sumUp([...a.values()].flatMap((b) => [...b.values()].flat())).voters));
  const Row = ({ k, depth, label, list, children, filter }) => {
    const t = sumUp(list);
    const isOpen = open.has(k);
    return (
      <>
        <tr className={`tree d${depth}`}>
          <td>
            {children ? (
              <button type="button" className="twist" aria-expanded={isOpen} onClick={() => toggle(k)}>{isOpen ? "−" : "+"}</button>
            ) : <span className="twist-pad" />}
            {filter ? <a href={drill(params, filter)}>{label}</a> : label}
          </td>
          <td className="n">{num(t.stations)}</td>
          <td className="n"><span className="nm">{num(t.voters)}<Meter value={t.voters} max={depth === 0 ? max : max / 3} /></span></td>
          <td className="n">{ratio(t.female, t.male)}</td>
          <td className="n">{t.avg_age}</td>
          <td className="n">{num(t.first_time)}</td>
          <td className="n">{num(t.senior)}</td>
          <td className="n">{num(t.families)}</td>
          <td className="n">{num(t.review)}</td>
        </tr>
        {isOpen && children}
      </>
    );
  };
  return (
    <div className="table-wrap">
      <table className="grid areas-tree">
        <thead><tr><th>Area</th><th className="n">Stations</th><th className="n">Voters</th><th className="n">Women / 1,000 men</th>
          <th className="n">Avg age</th><th className="n">First-time</th><th className="n">60+</th><th className="n">Families</th><th className="n">To check</th></tr></thead>
        <tbody>
          {[...tree].map(([mandal, pol]) => (
            <Row key={mandal} k={`m:${mandal}`} depth={0} label={`${mandal} mandal`} filter={{ mandal }}
              list={[...pol.values()].flatMap((b) => [...b.values()].flat())}>
              {[...pol].map(([police, locs]) => (
                <Row key={police} k={`p:${mandal}:${police}`} depth={1} label={`${police} police station`} filter={{ police }}
                  list={[...locs.values()].flat()}>
                  {[...locs].map(([loc, list]) => (
                    <Row key={loc} k={`l:${police}:${loc}`} depth={2} label={loc} filter={{ locality: loc }} list={list}>
                      {list.map((s) => (
                        <tr key={s.part_no} className="tree d3">
                          <td><span className="twist-pad" /><a href={drill(params, { part: s.part_no })}>PS {s.part_no}</a> <small className="sub" lang="te">{s.name}</small></td>
                          <td className="n">1</td><td className="n">{num(s.voters)}</td><td className="n">{ratio(s.female, s.male)}</td>
                          <td className="n">{s.avg_age}</td><td className="n">{num(s.a18_19)}</td><td className="n">{num(s.a60_69 + s.a70_79 + s.a80p)}</td>
                          <td className="n">{num(s.families)}</td><td className="n">{num(s.review)}</td>
                        </tr>
                      ))}
                    </Row>
                  ))}
                </Row>
              ))}
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Areas({ params }) {
  const level = params.level || "tree";
  const g = globals(params);
  const sts = useApi(level === "tree" ? "/api/stations" : null, g);
  const ar = useApi(level !== "tree" ? "/api/areas" : null, { ...g, level });
  const data = level === "tree" ? sts.data : ar.data;
  const error = sts.error || ar.error;
  const filterKey = { locality: "locality", police: "police", mandal: "mandal", pin: "pin" }[level];
  const max = data ? Math.max(1, ...data.map((r) => r.voters)) : 1;
  const cols = level === "section" ? [
    { key: "area", label: "PS-section", value: (r) => r.part_no * 1000 + r.section_no, render: (r) => <a href={drill(params, { part: r.part_no, sec: r.section_no })}>{r.part_no}-{r.section_no}</a> },
    { key: "name", label: "Section", render: (r) => <span lang="te">{r.name}</span> },
    { key: "locality", label: "Locality" },
    { key: "voters", label: "Voters", num: true, render: (r) => <span className="nm">{num(r.voters)}<Meter value={r.voters} max={max} /></span> },
    { key: "ratio", label: "Women / 1,000 men", num: true, value: (r) => r.female / (r.male || 1), render: (r) => ratio(r.female, r.male) },
    { key: "avg_age", label: "Avg age", num: true, render: (r) => r.avg_age },
    { key: "households", label: "Doors", num: true },
    { key: "families", label: "Families", num: true },
  ] : [
    { key: "area", label: LEVELS.find((l) => l[0] === level)[1].replace(/s$/, ""), render: (r) => <a href={drill(params, { [filterKey]: r.area })}>{r.area}</a> },
    { key: "stations", label: "Stations", num: true },
    { key: "voters", label: "Voters", num: true, render: (r) => <span className="nm">{num(r.voters)}<Meter value={r.voters} max={max} /></span> },
    { key: "ratio", label: "Women / 1,000 men", num: true, value: (r) => r.female / (r.male || 1), render: (r) => ratio(r.female, r.male) },
    { key: "avg_age", label: "Avg age", num: true, render: (r) => r.avg_age },
    { key: "first_time", label: "First-time", num: true },
    { key: "senior", label: "60+", num: true },
    { key: "families", label: "Families", num: true },
    { key: "households", label: "Doors", num: true },
    { key: "review", label: "To check", num: true },
  ];
  return (
    <div className="page">
      <div className="page-title">
        <h2>Areas</h2>
        <p>Every figure adds up from the polling stations in each area. Click any area to drill down: map of its stations and streets, age and sex, families and the voter list.</p>
      </div>
      <div className="pills tabs" role="tablist">
        {LEVELS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={level === k} className={level === k ? "pill on" : "pill"}
            onClick={() => go("/areas", { ...params, level: k })}>{l}</button>
        ))}
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && level === "tree" && <Tree stations={data} params={params} />}
      {data && level !== "tree" && (
        <SortTable rows={data.map((r) => ({ ...r, key: r.area }))} cols={cols} initial={{ key: "voters", dir: -1 }} limit={2000}
          rowHref={(r) => (level === "section" ? drill(params, { part: r.part_no, sec: r.section_no }) : drill(params, { [filterKey]: r.area }))} />
      )}
    </div>
  );
}

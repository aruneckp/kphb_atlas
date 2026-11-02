import React, { useEffect, useMemo, useState } from "react";
import { useApi, downloadCsv } from "../lib/api.js";
import { go, href, link } from "../lib/route.js";
import { num, pct, ratio } from "../lib/format.js";
import { bandAges, chips, describe, drill, slice, without } from "../lib/drill.js";
import { Columns, GenderBar, HBars, Meter, Pyramid } from "../components/charts.jsx";
import { ErrorBox, Loading, Pager, Panel, SortTable, VoterTable } from "../components/ui.jsx";
import SliceMap from "../components/SliceMap.jsx";
import DrillKpis from "../components/DrillKpis.jsx";

// group station counts up to an area level
function rollup(counts, stations, key) {
  const st = new Map(stations.map((s) => [s.part_no, s]));
  const m = new Map();
  for (const c of counts) {
    const s = st.get(c.part_no);
    if (!s) continue;
    const k = s[key] || "Unknown";
    const o = m.get(k) || { area: k, n: 0, base: 0, male: 0, female: 0, stations: 0 };
    o.n += c.n; o.base += s.voters; o.male += c.male; o.female += c.female; o.stations += 1;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export default function Drill({ params, meta }) {
  const p = slice(params);
  const sum = useApi("/api/summary", p);
  const br = useApi("/api/breakdown", p);
  const sts = useApi("/api/stations");
  const secs = useApi("/api/sections");
  const vs = useApi("/api/voters", { ...p, page: params.page, size: 50 });
  const [layer, setLayer] = useState(params.part ? "sections" : "stations");
  const [colour, setColour] = useState("share");
  const [allSt, setAllSt] = useState(false);
  useEffect(() => { setLayer(params.part ? "sections" : "stations"); }, [params.part]);
  const stations = sts.data || [];

  const level = params.part ? null : params.locality ? "part" : params.police ? "locality" : params.mandal ? "police_en" : "locality";
  const areaRows = useMemo(() => (br.data && stations.length && level && level !== "part" ? rollup(br.data.stations, stations, level) : []),
    [br.data, stations, level]);
  const stRows = useMemo(() => {
    if (!br.data || !stations.length) return [];
    const st = new Map(stations.map((s) => [s.part_no, s]));
    return br.data.stations.map((c) => {
      const s = st.get(c.part_no) || {};
      return { ...c, locality: s.locality, name: s.name, voters: s.voters, share: (100 * c.n) / (s.voters || 1) };
    });
  }, [br.data, stations]);
  const secRows = useMemo(() => {
    if (!br.data || !params.part || !secs.data) return [];
    const info = new Map(secs.data.map((x) => [`${x.part_no}-${x.section_no}`, x]));
    return br.data.sections.filter((x) => String(x.part_no) === String(params.part)).map((x) => {
      const i = info.get(`${x.part_no}-${x.section_no}`) || {};
      return { ...x, key: x.section_no, name: i.name, voters: i.voters, share: (100 * x.n) / (i.voters || 1) };
    });
  }, [br.data, secs.data, params.part]);

  const c = chips(params, meta);
  if (sum.error) return <ErrorBox error={sum.error} />;
  const t = sum.data?.totals;
  const areaKey = { locality: "locality", police_en: "police", part: "part" }[level];
  const areaTitle = { locality: "By locality", police_en: "By police station" }[level];

  return (
    <div className="page drill-page">
      <div className="crumbs">
        <a href={link("/", params)}>Overview</a><span>·</span><span>Drill-down</span>
        <span className="grow" />
        {vs.data?.total > 0 && <button type="button" className="btn" onClick={() => downloadCsv(p)}>Download these voters (CSV)</button>}
      </div>
      <div className="page-title">
        <h2>{describe(params, meta)}</h2>
        <p>{t ? <>{num(t.voters)} voters · {pct(t.voters, meta.voters, 2)} of the constituency. Click any bar, circle or number to drill further; remove a filter with ✕.</> : "Counting…"}</p>
      </div>
      {c.length > 0 && (
        <div className="chips" aria-label="Active filters">
          {c.map((x) => (
            <a key={x.key} className="chip" href={href("/drill", without(params, x.key))} title="Remove this filter">{x.label}<span aria-hidden="true">✕</span></a>
          ))}
          <a className="chip clear-all" href={href("/drill", {})}>Clear all</a>
        </div>
      )}
      {!t ? <Loading /> : t.voters === 0 ? <div className="empty">No voters in this slice. Remove a filter above.</div> : <>
        <DrillKpis t={t} params={params} fam={sum.data.family_sizes} />

        <div className="cols-2 map-first">
          <Panel title="Where these voters are" note={layer === "sections"
            ? "Each dot is a section (street) of a polling station. Street positions are approximate, set around their station."
            : "Each circle is a polling station: size shows voters in this slice, colour shows the share or count."}
            actions={
              <div className="seg-toggle">
                <div role="radiogroup" aria-label="Show">
                  {[["stations", "Stations"], ["sections", "Streets"]].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={layer === k} className={layer === k ? "on" : ""} onClick={() => setLayer(k)}>{l}</button>
                  ))}
                </div>
                <div role="radiogroup" aria-label="Colour by">
                  {[["share", "Share"], ["count", "Count"]].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={colour === k} className={colour === k ? "on" : ""} onClick={() => setColour(k)}>{l}</button>
                  ))}
                </div>
              </div>
            }>
            {br.data && stations.length && secs.data
              ? <SliceMap stations={stations} counts={br.data.stations} sections={br.data.sections} secInfo={secs.data}
                params={params} layer={layer} colour={colour} height={520} />
              : <Loading label="Placing voters on the map" />}
          </Panel>
          <div className="stack">
            <Panel title="Men and women" note="Click a colour to keep only that group.">
              <GenderBar male={t.male} female={t.female} third={t.third} hrefFor={(g) => drill(params, { gender: g })} />
            </Panel>
            {areaTitle && (
              <Panel title={areaTitle} note="Bar = voters in this slice. Click to drill into the area.">
                <HBars limit={14} items={areaRows.map((r) => ({
                  key: r.area, label: r.area, sub: `${r.stations} stations · ${pct(r.n, r.base)} of their voters`, value: r.n,
                  href: drill(params, { [areaKey]: r.area }),
                }))} />
              </Panel>
            )}
            {params.part && secRows.length > 0 && (
              <Panel title="Sections (streets)" note="Click a section to drill into it.">
                <HBars items={[...secRows].sort((a, b) => a.section_no - b.section_no).map((r) => ({
                  key: r.section_no, label: `Section ${r.section_no}`, sub: r.name, value: r.n,
                  href: drill(params, { sec: r.section_no }),
                }))} />
              </Panel>
            )}
            {!params.part && (
              <Panel title="Top polling stations" note="Most voters from this slice.">
                <HBars limit={8} items={[...stRows].sort((a, b) => b.n - a.n).map((r) => ({
                  key: r.part_no, label: `PS ${r.part_no}`, sub: `${r.locality} · ${r.share.toFixed(1)}% of station`, value: r.n,
                  href: drill(params, { part: r.part_no }),
                }))} />
              </Panel>
            )}
          </div>
        </div>

        <div className="cols-3">
          <Panel title="Age and sex" note="Click a bar for that age and sex, or the age label for both.">
            <Pyramid rows={sum.data.pyramid} hrefFor={(band, g) => drill(params, { ...bandAges(band), gender: g || params.gender || "" })} />
          </Panel>
          <Panel title="Relative named on the roll">
            <HBars items={sum.data.relations.map((r) => ({ key: r.rel, label: r.rel, value: r.n,
              href: r.rel !== "Not read" ? drill(params, { rel: r.rel }) : undefined }))} />
          </Panel>
          <Panel title="Family size" note="Families of two or more voters.">
            <Columns unit="families" caption="Voters in the family" items={sum.data.family_sizes.filter((r) => r.size >= 2).map((r) => ({
              label: r.size >= 10 ? "10+" : String(r.size), value: r.families, href: drill(params, { fam_size: r.size >= 10 ? "10+" : String(r.size) }),
            }))} />
          </Panel>
        </div>

        {!params.part && stRows.length > 1 && (
          <Panel title={`All ${stRows.length} polling stations in this slice`} note="Select a row to drill into the station.">
            <SortTable rows={stRows} limit={allSt ? 1000 : 25} initial={{ key: "n", dir: -1 }} rowHref={(r) => drill(params, { part: r.part_no })}
              cols={[
                { key: "part_no", label: "PS", num: true },
                { key: "locality", label: "Locality", render: (r) => <>{r.locality}<small className="sub" lang="te">{r.name}</small></> },
                { key: "n", label: "In this slice", num: true, render: (r) => <span className="nm">{num(r.n)}<Meter value={r.n} max={Math.max(...stRows.map((x) => x.n))} /></span> },
                { key: "share", label: "% of station", num: true, render: (r) => `${r.share.toFixed(1)}%` },
                { key: "male", label: "Men", num: true },
                { key: "female", label: "Women", num: true },
                { key: "avg_age", label: "Avg age", num: true, render: (r) => r.avg_age },
              ]} />
            {stRows.length > 25 && (
              <p className="more"><button type="button" className="linkish" onClick={() => setAllSt((x) => !x)}>
                {allSt ? "Show the top 25 only" : `Show all ${stRows.length} stations`}</button></p>
            )}
          </Panel>
        )}

        <Panel title="Voters in this slice" actions={<button type="button" className="btn" onClick={() => go("/search", p)}>Search within these</button>}>
          {vs.data ? <>
            <VoterTable rows={vs.data.rows} params={params} />
            <Pager page={vs.data.page} size={vs.data.size} total={vs.data.total} onPage={(pg) => go("/drill", { ...p, page: pg })} />
          </> : <Loading />}
        </Panel>
      </>}
    </div>
  );
}

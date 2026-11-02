import React, { Suspense, lazy } from "react";
import { useApi } from "../lib/api.js";
import { globals, link, go } from "../lib/route.js";
import { num, pct, ratio } from "../lib/format.js";
import { Columns, GenderBar, HBars, Pyramid } from "../components/charts.jsx";
import { ErrorBox, Kpis, Loading, Panel } from "../components/ui.jsx";
import DrillKpis from "../components/DrillKpis.jsx";
import { bandAges, drill } from "../lib/drill.js";

const OverviewMap = lazy(() => import("../components/OverviewMap.jsx"));

export function scopeLabel(params, meta) {
  const bits = [];
  if (params.part) {
    const s = meta.stations.find((x) => String(x.part_no) === String(params.part));
    bits.push(`Polling station ${params.part}${s ? ` (${s.locality})` : ""}`);
  }
  if (params.locality && !params.part) bits.push(params.locality);
  if (params.police && !params.part) bits.push(`${params.police} police station`);
  if (params.mandal && !params.part) bits.push(`${params.mandal} mandal`);
  if (params.pin && !params.part) bits.push(`PIN ${params.pin}`);
  if (params.gender) bits.push({ F: "women", M: "men", T: "third gender" }[params.gender]);
  if (params.age_min || params.age_max) bits.push(`age ${params.age_min || 18}${params.age_max ? `–${params.age_max}` : "+"}`);
  return bits.length ? bits.join(", ") : "Whole constituency";
}

export function SummaryKpis({ t, fam }) {
  const multi = fam ? fam.filter((r) => r.size >= 2) : null;
  const famCount = multi ? multi.reduce((s, r) => s + r.families, 0) : t.families;
  return (
    <Kpis items={[
      { label: "Voters", value: t.voters, sub: `${num(t.stations)} polling stations` },
      { label: "Women per 1,000 men", value: ratio(t.female, t.male), sub: `${num(t.female)} women · ${num(t.male)} men` },
      { label: "Average age", value: t.avg_age ?? "–", sub: `${pct(t.youth, t.voters)} are 18–29` },
      { label: "First-time voters", value: t.first_time, sub: "aged 18–19", tone: "sun" },
      { label: "Aged 60 and over", value: t.senior, sub: `${num(t.over80)} are 80+` },
      { label: multi ? "Families of 2+ voters" : "Families", value: famCount, sub: `${pct(t.linked, t.voters)} of voters linked to a relative` },
      { label: "Door numbers", value: t.households, sub: `${(t.voters / (t.households || 1)).toFixed(1)} voters per door` },
      { label: "Entries to check", value: t.review, sub: "OCR or roll doubts", tone: "warn" },
    ]} />
  );
}

export default function Overview({ params, meta }) {
  const g = globals(params);
  const { data, error } = useApi("/api/summary", g);
  const locs = useApi("/api/areas", { ...g, level: params.locality ? "pin" : "locality" });
  const sts = useApi("/api/stations", g);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const t = data.totals;
  const stations = (sts.data || []).filter((s) => !params.part || String(s.part_no) === String(params.part));
  const bySize = [...stations].sort((a, b) => b.voters - a.voters);
  const singles = data.family_sizes.find((r) => r.size === 1)?.families || 0;
  const famItems = data.family_sizes.filter((r) => r.size >= 2).map((r) => ({ label: r.size >= 10 ? "10+" : String(r.size), value: r.families, href: drill(params, { fam_size: r.size >= 10 ? "10+" : String(r.size) }) }));
  const hhItems = data.household_sizes.map((r) => ({ label: r.size >= 15 ? "15+" : String(r.size), value: r.households, href: drill(params, { hh_size: r.size >= 15 ? "15+" : String(r.size) }) }));
  const bigDoors = data.household_sizes.filter((r) => r.size >= 10).reduce((s, r) => s + r.households, 0);

  return (
    <div className="page">
      <div className="page-title">
        <h2>{scopeLabel(params, meta)}</h2>
        <p>Click any number, bar or chart to drill down: you get a map of where those voters are, a breakdown by area and street, and the voter list.</p>
      </div>
      {!t.voters ? <div className="empty">No voters match these filters. Clear a filter to see figures again.</div> : <>
        <DrillKpis t={t} params={params} fam={data.family_sizes} />

        <div className="cols-2">
          <div className="stack">
            <Panel title="Age and sex" note="Each bar is a five-year age band. Hover for exact counts.">
              <Pyramid rows={data.pyramid} hrefFor={(band, gd) => drill(params, { ...bandAges(band), gender: gd || params.gender || "" })} />
            </Panel>
            <Panel title="How voters name their relative" note="The roll prints one relative for each voter.">
              <HBars items={data.relations.map((r) => ({ key: r.rel, label: r.rel, value: r.n,
                href: r.rel !== "Not read" ? drill(params, { rel: r.rel }) : undefined }))} />
            </Panel>
          </div>
          <div className="stack">
            <Panel title="Men and women">
              <GenderBar male={t.male} female={t.female} third={t.third} hrefFor={(gd) => drill(params, { gender: gd })} />
            </Panel>
            <Panel title={params.locality ? "By PIN code" : "By locality"} note="Click a row to drill into it: map, streets, ages and voters.">
              {locs.data ? (
                <HBars limit={12} items={locs.data.map((r) => ({
                  key: r.area, label: r.area, sub: `${r.stations} stations`, value: r.voters,
                  href: drill(params, params.locality ? { pin: r.area } : { locality: r.area }),
                }))} />
              ) : <Loading />}
              {!params.locality && locs.data?.length > 12 && <p className="more"><a href={link("/areas", params)}>All {locs.data.length} localities</a></p>}
            </Panel>
          </div>
        </div>

        <Panel title="Where the voters are" note="Polling stations sized by voters. Click a circle to drill into that station and its streets." className="ov-map"
          actions={<a className="btn" href={drill(params)}>Open full map drill-down</a>}>
          <Suspense fallback={<Loading label="Loading map" />}><OverviewMap params={params} /></Suspense>
        </Panel>

        <div className="cols-3">
          <Panel title="Largest polling stations" note="Voters on the roll at each station.">
            <HBars limit={10} items={bySize.map((s) => ({
              key: s.part_no, label: `PS ${s.part_no}`, sub: s.locality, value: s.voters, href: drill(params, { part: s.part_no }),
            }))} />
            <p className="more"><a href={link("/stations", params)}>Compare all {stations.length} stations</a></p>
          </Panel>
          <Panel title="Family size" note="Families of two or more voters, linked through the father, mother or husband each names.">
            <Columns items={famItems} unit="families" caption="Voters in the family" />
            <p className="more">{num(singles)} voters have no relative found on the roll in their station.</p>
          </Panel>
          <Panel title="Voters per door number" note={bigDoors ? `${num(bigDoors)} door numbers have 10 or more voters - worth a field check.` : "Voters sharing one house number."}>
            <Columns items={hhItems} unit="door numbers" caption="Voters at the door" />
            <p className="more"><a href={link("/households", params, { min_size: 10 })}>See doors with 10+ voters</a></p>
          </Panel>
        </div>

        <a className="ghost-btn" href={drill(params)}>Open the full drill-down with map</a>
      </>}
    </div>
  );
}

import React from "react";
import { useApi } from "../lib/api.js";
import { globals, link } from "../lib/route.js";
import { num } from "../lib/format.js";
import { GenderBar, Pyramid } from "../components/charts.jsx";
import { ErrorBox, Loading, Pager, Panel, SortTable, VoterTable } from "../components/ui.jsx";
import { go } from "../lib/route.js";
import { bandAges, drill } from "../lib/drill.js";
import DrillKpis from "../components/DrillKpis.jsx";

export default function Station({ params, part }) {
  const { data: s, error } = useApi(`/api/station/${part}`);
  const g = { ...globals(params), part };
  const sum = useApi("/api/summary", g);
  const sec = params.sec || "";
  const vs = useApi("/api/voters", { ...g, sec, page: params.page, size: 100 });
  if (error) return <ErrorBox error={error} />;
  if (!s) return <Loading />;
  const prev = s.neighbours.find((n) => n.part_no === part - 1);
  const next = s.neighbours.find((n) => n.part_no === part + 1);
  return (
    <div className="page">
      <div className="crumbs">
        <a href={link("/stations", params)}>Polling stations</a>
        <span className="grow" />
        {prev && <a href={link(`/stations/${prev.part_no}`, params)}>PS {prev.part_no}</a>}
        {next && <a href={link(`/stations/${next.part_no}`, params)}>PS {next.part_no}</a>}
      </div>
      <div className="station-head">
        <div className="ps-no" aria-label={`Polling station ${part}`}><small>PS</small>{part}</div>
        <div>
          <h2 lang="te">{s.name}</h2>
          <p lang="te">{s.address}</p>
          <p className="tags">
            <a href={drill({ ...params, part: "" }, { locality: s.locality, part: "" })}>{s.locality}</a>
            <span>{s.police_en} police station</span><span>{s.mandal_en} mandal</span><span>PIN {s.pin}</span>
            <a href={drill(params, { part })}>Map and drill-down</a>
            <a href={link("/map", params, { focus: part })}>{s.geo_source === "approximate" ? "Approximate pin" : "Show on big map"}</a>
          </p>
        </div>
      </div>
      {sum.data ? <DrillKpis t={sum.data.totals} params={{ ...params, part }} fam={sum.data.family_sizes} /> : <Loading />}
      {s.cover_total && s.cover_total !== s.voters && (
        <p className="callout">The roll cover lists {num(s.cover_total)} voters; {num(s.voters)} entries were read from the pages ({s.voters > s.cover_total ? "+" : ""}{num(s.voters - s.cover_total)}).</p>
      )}
      <div className="cols-2">
        <Panel title="Age and sex">{sum.data ? <Pyramid rows={sum.data.pyramid} hrefFor={(band, gd) => drill({ ...params, part }, { ...bandAges(band), gender: gd || params.gender || "" })} /> : <Loading />}</Panel>
        <div className="stack">
          <Panel title="Men and women">{sum.data && <GenderBar male={sum.data.totals.male} female={sum.data.totals.female} third={sum.data.totals.third} hrefFor={(gd) => drill({ ...params, part }, { gender: gd })} />}</Panel>
          <Panel title="Sections (streets) in this station" note="Click a section to drill into it with a street map.">
            <SortTable rows={s.sections_list} initial={{ key: "section_no", dir: 1 }}
              rowHref={(r) => drill({ ...params, part }, { sec: r.section_no })}
              cols={[
                { key: "section_no", label: "No.", num: true },
                { key: "name", label: "Section", render: (r) => <span lang="te">{r.name}</span> },
                { key: "voters", label: "Voters", num: true },
                { key: "avg_age", label: "Avg age", num: true, render: (r) => r.avg_age },
                { key: "households", label: "Doors", num: true },
              ]} />
          </Panel>
        </div>
      </div>
      <div className="cols-2">
        <Panel title="Largest families here">
          <ul className="list">
            {s.top_families.map((f) => (
              <li key={f.id}><a href={link(`/family/${f.id}`, params)}><span lang="te">{f.head_name}</span> <small>{f.head_name_en}</small></a>
                <span className="nm">{f.size} voters · {f.gens} gen.</span></li>
            ))}
          </ul>
        </Panel>
        <Panel title="Busiest door numbers">
          <ul className="list">
            {s.top_households.map((h) => (
              <li key={h.id}><a href={link(`/household/${h.id}`, params)}>{h.house}</a><span className="nm">{h.size} voters · {h.families} families</span></li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title={sec ? `Voters in section ${sec}` : "All voters in this station"}
        actions={sec ? <button type="button" className="btn" onClick={() => go(`/stations/${part}`, { ...params, sec: "", page: "" })}>Show all sections</button> : null}>
        {vs.data ? <>
          <VoterTable rows={vs.data.rows} params={params} showStation={false} />
          <Pager page={vs.data.page} size={vs.data.size} total={vs.data.total} onPage={(pg) => go(`/stations/${part}`, { ...params, page: pg })} />
        </> : <Loading />}
      </Panel>
    </div>
  );
}

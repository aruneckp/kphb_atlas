import React from "react";
import { useApi } from "../lib/api.js";
import { link } from "../lib/route.js";
import { linkWord, num } from "../lib/format.js";
import FamilyTree from "../components/FamilyTree.jsx";
import { ErrorBox, Kpis, Loading, Panel, VoterTable } from "../components/ui.jsx";

export default function Family({ params, id }) {
  const { data, error } = useApi(`/api/family/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const f = data.family;
  const hows = {};
  for (const m of data.members) if (m.link_how) hows[m.link_how] = (hows[m.link_how] || 0) + 1;
  return (
    <div className="page">
      <div className="crumbs"><a href={link("/families", params)}>Families</a><span>·</span><a href={link(`/stations/${f.part_no}`, params)}>PS {f.part_no} · {f.station?.locality}</a></div>
      <div className="page-title">
        <h2><span lang="te">{f.head_name}</span> family</h2>
        <p>{f.head_name_en} · polling station {f.part_no}</p>
      </div>
      <Kpis items={[
        { label: "Voters", value: f.size, sub: `${f.male} men · ${f.female} women` },
        { label: "Generations", value: f.gens },
        { label: "Door numbers", value: f.houses },
        { label: "Ages", value: f.min_age ? `${f.min_age}–${f.max_age}` : "–", sub: f.avg_age ? `average ${f.avg_age}` : "" },
        { label: "Relatives not on roll", value: f.ghosts },
      ]} />
      <Panel title="Family tree" note="Wives sit beside their husband; children hang below. Dashed cards are relatives named on the roll who are not voters here.">
        <FamilyTree payload={data} focus={params.focus} params={params} />
      </Panel>
      <Panel title="How the links were made" note="Exact matches in the same house are the most reliable.">
        <ul className="list">{Object.entries(hows).map(([h, n]) => <li key={h}><span>{linkWord(h)}</span><span className="nm">{num(n)}</span></li>)}</ul>
      </Panel>
      <Panel title="Members">
        <VoterTable rows={data.members.map((m) => ({ ...m, needs_review: 0 }))} params={params} focus={params.focus} />
      </Panel>
    </div>
  );
}

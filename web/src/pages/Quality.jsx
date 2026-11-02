import React from "react";
import { useApi } from "../lib/api.js";
import { globals, link } from "../lib/route.js";
import { num } from "../lib/format.js";
import { Columns, HBars } from "../components/charts.jsx";
import { ErrorBox, Kpis, Loading, Panel, SortTable } from "../components/ui.jsx";
import { drill } from "../lib/drill.js";

export default function Quality({ params }) {
  const g = globals(params);
  const { data, error } = useApi("/api/quality", g);
  const sum = useApi("/api/summary", g);
  if (error) return <ErrorBox error={error} />;
  if (!data || !sum.data) return <Loading />;
  const t = sum.data.totals;
  return (
    <div className="page">
      <div className="page-title">
        <h2>Data checks</h2>
        <p>The roll was read from scanned PDFs. These are the entries where the reading may be wrong, so check them against the printed page before relying on them.</p>
      </div>
      <Kpis items={[
        { label: "Entries to check", value: t.review, sub: `of ${num(t.voters)} voters`, tone: "warn", href: drill(params, { review: 1 }) },
        { label: "Same voter ID twice", value: data.epic_dups, href: drill(params, { dup: 1 }) },
        { label: "Same name and relative twice", value: data.name_dups, href: drill(params, { dup: 1 }) },
        { label: "Marked deleted", value: data.deleted, href: drill(params, { deleted: 1 }) },
        { label: "No house no.", value: data.no_house, href: drill(params, { nohouse: 1 }) },
        { label: "No age", value: data.no_age },
      ]} />
      <div className="cols-2">
        <Panel title="Why entries need checking" note="Click a reason to see where those entries are on the map.">
          <HBars unit="entries" items={data.reasons.map((r) => ({ key: r.reason, label: r.reason, value: r.n,
            href: drill(params, { review: 1, reason: r.reason }) }))} />
        </Panel>
        <Panel title="Reading confidence" note="How sure the text reader was, in 5-point bands.">
          <Columns unit="entries" caption="Confidence %" items={data.ocr.map((r) => ({ label: String(r.band), value: r.n, href: drill(params, { ocr: r.band }) }))} />
        </Panel>
      </div>
      <div className="cols-2">
        <Panel title="Stations with the most doubts">
          <SortTable rows={data.worst} initial={{ key: "pct", dir: -1 }} rowHref={(r) => drill(params, { part: r.part_no, review: 1 })}
            cols={[{ key: "part_no", label: "PS", num: true }, { key: "locality", label: "Locality" },
              { key: "review", label: "To check", num: true }, { key: "pct", label: "% of voters", num: true, render: (r) => `${r.pct}%` }]} />
        </Panel>
        <Panel title="Count differs from the roll cover" note="The cover page total versus entries read from the pages.">
          {data.cover.length ? (
            <SortTable rows={data.cover} initial={{ key: "diff", dir: 1 }} rowHref={(r) => link(`/stations/${r.part_no}`, params)}
              cols={[{ key: "part_no", label: "PS", num: true }, { key: "locality", label: "Locality" },
                { key: "cover_total", label: "Cover", num: true }, { key: "voters", label: "Read", num: true },
                { key: "diff", label: "Difference", num: true, render: (r) => (r.diff > 0 ? `+${r.diff}` : r.diff) }]} />
          ) : <p>Every station matches its cover total.</p>}
        </Panel>
      </div>
    </div>
  );
}

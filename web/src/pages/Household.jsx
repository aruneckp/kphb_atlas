import React from "react";
import { useApi } from "../lib/api.js";
import { link } from "../lib/route.js";
import { ErrorBox, Kpis, Loading, Panel, VoterTable } from "../components/ui.jsx";

export default function Household({ params, id }) {
  const { data: h, error } = useApi(`/api/household/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!h) return <Loading />;
  return (
    <div className="page">
      <div className="crumbs"><a href={link("/households", params)}>Households</a><span>·</span><a href={link(`/stations/${h.part_no}`, params)}>PS {h.part_no} · {h.locality}</a></div>
      <div className="page-title"><h2>Door {h.house}</h2><p lang="te">{h.station_name}</p></div>
      <Kpis items={[
        { label: "Voters", value: h.size },
        { label: "Families", value: h.families },
        { label: "Men", value: h.male },
        { label: "Women", value: h.female },
      ]} />
      <Panel title="Voters at this door" note="Sorted by family, oldest first.">
        <VoterTable rows={h.members} params={params} showStation={false} />
      </Panel>
    </div>
  );
}

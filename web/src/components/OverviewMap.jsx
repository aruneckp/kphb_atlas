import React from "react";
import { useApi } from "../lib/api.js";
import { slice } from "../lib/drill.js";
import SliceMap from "./SliceMap.jsx";
import { Loading } from "./ui.jsx";

// Map for the overview: same slice as the page filters.
export default function OverviewMap({ params }) {
  const p = slice(params);
  const br = useApi("/api/breakdown", p);
  const sts = useApi("/api/stations");
  const secs = useApi("/api/sections");
  if (!br.data || !sts.data || !secs.data) return <Loading label="Placing stations" />;
  return <SliceMap stations={sts.data} counts={br.data.stations} sections={br.data.sections} secInfo={secs.data}
    params={params} layer={params.part ? "sections" : "stations"} colour="count" height={420} />;
}

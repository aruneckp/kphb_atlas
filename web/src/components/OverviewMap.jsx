import React, { useState } from "react";
import { useApi } from "../lib/api.js";
import { slice } from "../lib/drill.js";
import AtlasMap from "./AtlasMap.jsx";
import { Loading } from "./ui.jsx";

// Map for the overview: constituency border with localities shaded by voters in the current filters.
export default function OverviewMap({ params }) {
  const p = slice(params);
  const filtered = Object.keys(p).length > 0;
  const br = useApi(filtered ? "/api/breakdown" : null, p);
  const sts = useApi("/api/stations");
  const [layer, setLayer] = useState("locality");
  if (!sts.data || (filtered && !br.data)) return <Loading label="Drawing the constituency" />;
  const rows = filtered ? new Map(br.data.stations.map((r) => [r.part_no, r])) : null;
  return <AtlasMap stations={sts.data} rows={rows} params={params} layer={layer} onLayer={setLayer} metric="n" height={480} />;
}

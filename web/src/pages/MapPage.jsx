import React, { useMemo, useState } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import AtlasMap, { METRICS } from "../components/AtlasMap.jsx";
import { useApi, postJSON, SERVER } from "../lib/api.js";
import { savedPins } from "../data/client.js";
import { globals, link, go } from "../lib/route.js";

const pinIcon = L.divIcon({ className: "drag-pin", html: "<span></span>", iconSize: [26, 26], iconAnchor: [13, 26] });
const FULL_METRICS = ["n", "ratio", "avg_age", "first", "youth", "senior", "review"];

export default function MapPage({ params }) {
  const g = globals(params);
  delete g.part;
  const { data, error } = useApi("/api/stations", g);
  const [metric, setMetric] = useState(params.metric || "n");
  const [layer, setLayer] = useState(params.layer || "locality");
  const [edit, setEdit] = useState(null); // {part_no, lat, lng}
  const [msg, setMsg] = useState("");
  const [moved, setMoved] = useState({});
  const list = useMemo(() => (data || []).map((s) => ({ ...s, ...(moved[s.part_no] || {}) })), [data, moved]);
  const approx = list.filter((s) => s.geo_source === "approximate").length;
  const byPart = useMemo(() => new Map(list.map((s) => [s.part_no, s])), [list]);

  const save = async () => {
    try {
      const r = await postJSON(`/api/station/${edit.part_no}/pin`, { lat: edit.lat, lng: edit.lng });
      setMoved((m) => ({ ...m, [r.part_no]: { lat: r.lat, lng: r.lng, geo_source: "saved" } }));
      setMsg(SERVER ? `Saved the pin for PS ${r.part_no}. It is kept in data/station_geo.csv for future rebuilds.`
        : `Saved the pin for PS ${r.part_no} in this browser. Use “Download saved pins” and put the file in data/station_geo.csv to give everyone the same pins on the next build.`);
      setEdit(null);
    } catch (e) { setMsg(`Could not save: ${e.message}`); }
  };

  if (error) return <div className="error">{error}</div>;
  return (
    <div className="page map-page">
      <div className="page-title">
        <h2>Kukatpally constituency map</h2>
        <p>The red line is the official constituency border. Areas inside it are shaded by the measure you pick; hover for numbers, click to pin an area and drill down.</p>
      </div>
      <div className="toolbar">
        <label>Colour by
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {FULL_METRICS.map((k) => <option key={k} value={k}>{METRICS[k].label}</option>)}
          </select>
        </label>
        <label>Jump to station
          <select value="" onChange={(e) => e.target.value && go("/map", { ...params, focus: e.target.value })}>
            <option value="">Choose…</option>
            {list.map((s) => <option key={s.part_no} value={s.part_no}>PS {s.part_no} · {s.locality}</option>)}
          </select>
        </label>
        <span className="grow" />
        {!SERVER && !edit && Object.keys(savedPins()).length > 0 && (
          <button type="button" className="btn" onClick={() => {
            const pins = savedPins();
            const csv = "part_no,lat,lng,source\n" + Object.entries(pins).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k},${v.lat.toFixed(6)},${v.lng.toFixed(6)},saved`).join("\n") + "\n";
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            Object.assign(document.createElement("a"), { href: url, download: "station_geo.csv" }).click();
          }}>Download saved pins</button>
        )}
        {edit && (
          <>
            <span className="count">Drag the red pin for PS {edit.part_no} to its building, then save.</span>
            <button type="button" className="btn primary" onClick={save}>Save pin</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
          </>
        )}
      </div>
      {msg && <p className="callout ok" role="status">{msg}</p>}
      {!data ? <div className="loading">Loading stations…</div> : (
        <AtlasMap stations={list} params={params} layer={layer} onLayer={setLayer} metric={metric} height={640}
          focusPart={params.focus}
          extraActions={(sel, lyr) => (lyr !== "locality" && byPart.get(sel.key)
            ? <button type="button" className="btn" onClick={() => { const s = byPart.get(sel.key); setLayer("circles"); setEdit({ part_no: s.part_no, lat: s.lat, lng: s.lng }); }}>Move this pin</button>
            : null)}>
          {edit && (
            <Marker position={[edit.lat, edit.lng]} draggable icon={pinIcon}
              eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); setEdit((x) => ({ ...x, lat: p.lat, lng: p.lng })); } }} />
          )}
        </AtlasMap>
      )}
      {approx > 0 && (
        <p className="note">{approx} of {list.length} stations are placed near the centre of their locality (kept inside the border), so area shapes are estimates.
          Pin a station to its real building with “Move this pin”, or run <code>python3 scripts/geocode_stations.py</code>.
          {" "}<a href={link("/stations", params)}>Compare stations in a table</a>.</p>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BaseTiles from "../components/BaseTiles.jsx";
import { useApi, postJSON, SERVER } from "../lib/api.js";
import { savedPins } from "../data/client.js";
import { globals, link, go } from "../lib/route.js";
import { num, pct, ratio } from "../lib/format.js";
import { drill } from "../lib/drill.js";

const METRICS = {
  voters: { label: "Voters", v: (s) => s.voters, f: (x) => num(Math.round(x)) },
  ratio: { label: "Women per 1,000 men", v: (s) => (1000 * s.female) / (s.male || 1), f: (x) => Math.round(x) },
  avg_age: { label: "Average age", v: (s) => s.avg_age || 0, f: (x) => x.toFixed(1) },
  first: { label: "First-time voters (18–19) %", v: (s) => (100 * s.a18_19) / s.voters, f: (x) => `${x.toFixed(1)}%` },
  youth: { label: "Aged 18–29 %", v: (s) => (100 * (s.a18_19 + s.a20_29)) / s.voters, f: (x) => `${x.toFixed(1)}%` },
  senior: { label: "Aged 60+ %", v: (s) => (100 * (s.a60_69 + s.a70_79 + s.a80p)) / s.voters, f: (x) => `${x.toFixed(1)}%` },
  review: { label: "Entries to check %", v: (s) => (100 * s.review) / s.voters, f: (x) => `${x.toFixed(1)}%` },
};
// one-hue sequential ramp, light to dark (5 classes)
const RAMP = ["#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];

function quantiles(vals) {
  const s = [...vals].sort((a, b) => a - b);
  return [0.2, 0.4, 0.6, 0.8].map((q) => s[Math.floor(q * (s.length - 1))]);
}

function FitTo({ points, focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) { map.setView([focus.lat, focus.lng], 16, { animate: false }); return; }
    if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.08), { animate: false });
  }, [map, points.length, focus?.part_no]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const pinIcon = L.divIcon({ className: "drag-pin", html: "<span></span>", iconSize: [26, 26], iconAnchor: [13, 26] });

export default function MapPage({ params, meta }) {
  const g = globals(params);
  delete g.part;
  const { data, error } = useApi("/api/stations", g);
  const [metric, setMetric] = useState(params.metric || "voters");
  const [edit, setEdit] = useState(null); // {part_no, lat, lng}
  const [msg, setMsg] = useState("");
  const [moved, setMoved] = useState({});
  const dark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const list = useMemo(() => (data || []).map((s) => ({ ...s, ...(moved[s.part_no] || {}) })), [data, moved]);
  const M = METRICS[metric];
  const breaks = useMemo(() => quantiles(list.map(M.v)), [list, M]);
  const cls = (x) => breaks.filter((b) => x > b).length;
  const maxV = Math.max(1, ...list.map((s) => s.voters));
  const focus = params.focus ? list.find((s) => String(s.part_no) === String(params.focus)) : null;
  const approx = list.filter((s) => s.geo_source === "approximate").length;

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
        <h2>Map of polling stations</h2>
        <p>Circle size shows voters; colour shows the measure you pick. {g.gender || g.age_min ? "Sex and age filters do not change station colours." : ""}</p>
      </div>
      <div className="toolbar">
        <label>Colour by
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
        <div className="legend" aria-label={`Legend for ${M.label}`}>
          {RAMP.map((c, i) => (
            <span key={c}><i style={{ background: c }} />{i === 0 ? `≤ ${M.f(breaks[0] ?? 0)}` : i === 4 ? `> ${M.f(breaks[3] ?? 0)}` : `${M.f(breaks[i - 1] ?? 0)}–${M.f(breaks[i] ?? 0)}`}</span>
          ))}
        </div>
        <span className="grow" />
        {!SERVER && !edit && Object.keys(savedPins()).length > 0 && (
          <button type="button" className="btn" onClick={() => {
            const pins = savedPins();
            const csv = "part_no,lat,lng,source\n" + Object.entries(pins).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k},${v.lat.toFixed(6)},${v.lng.toFixed(6)},saved`).join("\n") + "\n";
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            Object.assign(document.createElement("a"), { href: url, download: "station_geo.csv" }).click();
          }}>Download saved pins</button>
        )}
        {edit ? (
          <>
            <span className="count">Drag the pin for PS {edit.part_no}, then save.</span>
            <button type="button" className="btn primary" onClick={save}>Save pin</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
          </>
        ) : null}
      </div>
      {approx > 0 && (
        <p className="callout">{approx} of {list.length} stations sit at the centre of their locality, not their exact building. To fix one, open its circle and choose “Move this pin”. To place them all at once, run <code>python3 scripts/geocode_stations.py</code> on a computer with internet.</p>
      )}
      {msg && <p className="callout ok" role="status">{msg}</p>}
      <div className="mapbox">
        {!data ? <div className="loading">Loading stations…</div> : (
          <MapContainer center={meta.centre} zoom={13} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
            <BaseTiles />
            <FitTo points={list} focus={focus} />
            {list.map((s) => {
              const val = M.v(s);
              const on = focus && focus.part_no === s.part_no;
              return (
                <CircleMarker key={s.part_no} center={[s.lat, s.lng]} radius={4 + 9 * Math.sqrt(s.voters / maxV)}
                  pathOptions={{ color: on ? "#d7262f" : dark ? "#13202f" : "#ffffff", weight: on ? 3 : 1.5, fillColor: RAMP[cls(val)], fillOpacity: 0.92, dashArray: s.geo_source === "approximate" ? "3 2" : null }}>
                  <Tooltip direction="top" offset={[0, -6]}>PS {s.part_no} · {s.locality} · {M.f(val)}</Tooltip>
                  <Popup>
                    <div className="pop">
                      <b>PS {s.part_no} · {s.locality}</b>
                      <span lang="te">{s.name}</span>
                      <span>{num(s.voters)} voters · {ratio(s.female, s.male)} women per 1,000 men</span>
                      <span>Average age {s.avg_age} · first-time {num(s.a18_19)} · 60+ {pct(s.a60_69 + s.a70_79 + s.a80p, s.voters)}</span>
                      <span>{num(s.families)} families · {num(s.households)} doors · {num(s.review)} to check</span>
                      <span className="pop-links">
                        <a href={drill(params, { part: s.part_no })}>Drill down</a>
                        <a href={link(`/stations/${s.part_no}`, params)}>Open station</a>
                        <a href={link("/search", params, { part: s.part_no })}>List voters</a>
                        <button type="button" onClick={() => setEdit({ part_no: s.part_no, lat: s.lat, lng: s.lng })}>Move this pin</button>
                      </span>
                      <small>{s.geo_source === "approximate" ? "Approximate position" : s.geo_source === "saved" ? "Position saved by you" : "Geocoded position"}</small>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
            {edit && (
              <Marker position={[edit.lat, edit.lng]} draggable icon={pinIcon}
                eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); setEdit((x) => ({ ...x, lat: p.lat, lng: p.lng })); } }} />
            )}
          </MapContainer>
        )}
      </div>
      <p className="note">Prefer a list? <a href={link("/stations", params)}>Compare stations in a table</a> · <button type="button" className="linkish" onClick={() => go("/map", { ...params, focus: "" })}>Show all stations</button></p>
    </div>
  );
}

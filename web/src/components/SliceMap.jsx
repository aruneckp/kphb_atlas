import React, { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BaseTiles from "./BaseTiles.jsx";
import { drill } from "../lib/drill.js";
import { link } from "../lib/route.js";
import { num, pct } from "../lib/format.js";

// one-hue sequential ramp, light to dark
export const RAMP = ["#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];

export function quantiles(vals) {
  const s = [...vals].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return [0, 0, 0, 0];
  return [0.2, 0.4, 0.6, 0.8].map((q) => s[Math.floor(q * (s.length - 1))]);
}

// Sections (streets) have no coordinates on the roll: place them on a small ring
// around their polling station, in section order. Approximate by design.
export function sectionPoint(st, secNo, nSec) {
  const n = Math.max(nSec, 1);
  const ang = ((secNo - 1) / n) * 2 * Math.PI + (st.part_no % 7) * 0.45;
  const r = 0.0011 + 0.00025 * ((secNo - 1) % 3);
  return [st.lat + r * Math.sin(ang), st.lng + (r * Math.cos(ang)) / Math.cos((st.lat * Math.PI) / 180)];
}

function Fit({ pts, sig }) {
  const map = useMap();
  useEffect(() => {
    if (!pts.length) return undefined;
    const fit = () => {
      map.invalidateSize();
      if (pts.length === 1) map.setView(pts[0], 16, { animate: false });
      else map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 17, animate: false });
    };
    fit();
    const t = setTimeout(fit, 250); // the box may still be sizing when the map first mounts
    return () => clearTimeout(t);
  }, [map, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Bubble map of one slice of voters.
 * stations: all stations (lat, lng, voters, locality, name)
 * counts:   [{part_no, n, male, female, avg_age}] for the slice
 * sections: [{part_no, section_no, n, male, female}] for the slice
 * secInfo:  [{part_no, section_no, name, voters}] for names
 */
export default function SliceMap({ stations, counts, sections, secInfo, params, layer = "stations", colour = "share", height = 480 }) {
  const dark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const byPart = useMemo(() => new Map(stations.map((s) => [s.part_no, s])), [stations]);
  const secMeta = useMemo(() => {
    const m = new Map(), nsec = new Map();
    for (const x of secInfo || []) {
      m.set(`${x.part_no}-${x.section_no}`, x);
      nsec.set(x.part_no, Math.max(nsec.get(x.part_no) || 0, x.section_no));
    }
    return { m, nsec };
  }, [secInfo]);

  const pts = useMemo(() => {
    if (layer === "sections") {
      return (sections || []).map((x) => {
        const st = byPart.get(x.part_no);
        if (!st) return null;
        const info = secMeta.m.get(`${x.part_no}-${x.section_no}`);
        const base = info?.voters || x.n;
        return { key: `${x.part_no}-${x.section_no}`, st, sec: x.section_no, name: info?.name, n: x.n, male: x.male, female: x.female,
          share: (100 * x.n) / (base || 1), base, pos: sectionPoint(st, x.section_no, secMeta.nsec.get(x.part_no) || 3) };
      }).filter(Boolean);
    }
    return (counts || []).map((x) => {
      const st = byPart.get(x.part_no);
      if (!st) return null;
      return { key: String(x.part_no), st, n: x.n, male: x.male, female: x.female, avg_age: x.avg_age,
        share: (100 * x.n) / (st.voters || 1), base: st.voters, pos: [st.lat, st.lng] };
    }).filter(Boolean);
  }, [layer, sections, counts, byPart, secMeta]);

  const val = (p) => (colour === "count" ? p.n : p.share);
  const breaks = useMemo(() => quantiles(pts.map(val)), [pts, colour]); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = new Set(pts.map((p) => Math.round(val(p) * 10))).size <= 1;  // every point has the same value
  const cls = (x) => (flat ? 2 : breaks.filter((b) => x > b).length);
  const maxN = Math.max(1, ...pts.map((p) => p.n));
  const fmt = (x) => (colour === "count" ? num(Math.round(x)) : `${x.toFixed(1)}%`);
  const sig = `${layer}:${pts.length}:${pts.slice(0, 3).map((p) => p.key).join(",")}`;

  return (
    <div className="slicemap">
      <div className="legend" aria-label="Map legend">
        <span className="legend-title">{colour === "count" ? "Voters in this slice" : "Share of the station's voters"}</span>
        {flat
          ? <span><i style={{ background: RAMP[2] }} />{pts[0] ? `${fmt(val(pts[0]))} everywhere` : "–"}</span>
          : RAMP.map((c, i) => (
            <span key={c}><i style={{ background: c }} />{i === 0 ? `≤ ${fmt(breaks[0])}` : i === 4 ? `> ${fmt(breaks[3])}` : `${fmt(breaks[i - 1])}–${fmt(breaks[i])}`}</span>
          ))}
      </div>
      <div className="mapbox" style={{ height }}>
        <MapContainer center={[17.476, 78.428]} zoom={13} zoomSnap={0.25} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <BaseTiles />
          <Fit pts={pts.map((p) => p.pos)} sig={sig} />
          {pts.map((p) => (
            <CircleMarker key={p.key} center={p.pos} radius={(layer === "sections" ? 3 : 3.5) + (pts.length > 150 ? 6 : layer === "sections" ? 8 : 11) * Math.sqrt(p.n / maxN)}
              pathOptions={{ color: dark ? "#13202f" : "#ffffff", weight: 1.5, fillColor: RAMP[cls(val(p))], fillOpacity: 0.9 }}>
              <Tooltip direction="top" offset={[0, -6]}>
                {layer === "sections" ? `PS ${p.st.part_no} · section ${p.sec}` : `PS ${p.st.part_no} · ${p.st.locality}`}: {num(p.n)} ({p.share.toFixed(1)}%)
              </Tooltip>
              <Popup>
                <div className="pop">
                  <b>{layer === "sections" ? `PS ${p.st.part_no}, section ${p.sec}` : `PS ${p.st.part_no} · ${p.st.locality}`}</b>
                  <span lang="te">{layer === "sections" ? p.name : p.st.name}</span>
                  <span>{num(p.n)} voters in this slice · {pct(p.n, p.base)} of {num(p.base)}</span>
                  <span>{num(p.male)} men · {num(p.female)} women{p.avg_age ? ` · average age ${p.avg_age}` : ""}</span>
                  <span className="pop-links">
                    {layer === "sections"
                      ? <a href={drill(params, { part: p.st.part_no, sec: p.sec })}>Drill into this street</a>
                      : <a href={drill(params, { part: p.st.part_no, sec: "" })}>Drill into this station</a>}
                    <a href={link(`/stations/${p.st.part_no}`, params)}>Station page</a>
                  </span>
                  <small>{layer === "sections" ? "Street position is approximate (placed around its station)" : p.st.geo_source === "approximate" ? "Approximate position" : "Saved position"}</small>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

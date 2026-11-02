import React, { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Pane, Polygon, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BaseTiles from "./BaseTiles.jsx";
import { buildAreas, labelPoint, loadGeo } from "../lib/areas.js";
import { drill } from "../lib/drill.js";
import { link } from "../lib/route.js";
import { num, pct, ratio } from "../lib/format.js";
import { sectionPoint } from "./SliceMap.jsx";

// one-hue sequential ramp, light to dark
const RAMP = ["#c6dcf7", "#8fbbee", "#4f93e0", "#2269c2", "#123f80"];
const AGE_KEYS = [["a18_19", "18–19"], ["a20_29", "20–29"], ["a30_39", "30–39"], ["a40_49", "40–49"], ["a50_59", "50–59"], ["a60_69", "60–69"], ["a70_79", "70–79"], ["a80p", "80+"]];

export const METRICS = {
  n: { label: "Voters", fmt: (x) => num(Math.round(x)), v: (a) => a.n },
  share: { label: "Share of the area's voters", fmt: (x) => `${x.toFixed(1)}%`, v: (a) => (100 * a.n) / (a.base || 1), slice: true },
  ratio: { label: "Women per 1,000 men", fmt: (x) => String(Math.round(x)), v: (a) => (1000 * a.female) / (a.male || 1) },
  avg_age: { label: "Average age", fmt: (x) => x.toFixed(1), v: (a) => (a.ageN ? a.ageSum / a.ageN : NaN) },
  first: { label: "First-time voters %", fmt: (x) => `${x.toFixed(1)}%`, v: (a) => (100 * a.a18_19) / (a.n || 1), full: true },
  youth: { label: "Aged 18–29 %", fmt: (x) => `${x.toFixed(1)}%`, v: (a) => (100 * (a.a18_19 + a.a20_29)) / (a.n || 1), full: true },
  senior: { label: "Aged 60+ %", fmt: (x) => `${x.toFixed(1)}%`, v: (a) => (100 * (a.a60_69 + a.a70_79 + a.a80p)) / (a.n || 1), full: true },
  review: { label: "Entries to check %", fmt: (x) => `${x.toFixed(1)}%`, v: (a) => (100 * a.review) / (a.n || 1), full: true },
};

// area of a multipolygon's outer rings in square degrees
function areaOf(multi) {
  let t = 0;
  for (const poly of multi) {
    const r = poly[0];
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    t += Math.abs(a) / 2;
  }
  return t;
}

// Labels that fit: bigger areas first; skip any label that would sit on top of one already placed.
function placeLabels(feats, zoom) {
  const scale = Math.pow(2, zoom - 13);           // screen size grows 2x per zoom step
  const minArea = 0.000012 / (scale * scale);      // about the size of a small town block at zoom 13
  const minGap = 0.0045 / scale;                   // degrees between label centres
  const out = [];
  for (const f of [...feats].map((f) => ({ f, area: areaOf(f.geometry.coordinates) })).sort((a, b) => b.area - a.area)) {
    if (f.area < minArea) continue;
    const at = labelPoint(f.f.geometry.coordinates);
    if (!at || out.some((o) => Math.abs(o.at[0] - at[0]) < minGap * 0.55 && Math.abs(o.at[1] - at[1]) < minGap * 1.6)) continue;
    out.push({ key: f.f.properties.key, at });
  }
  return out;
}

function quantiles(vals) {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return [0, 0, 0, 0];
  return [0.2, 0.4, 0.6, 0.8].map((q) => s[Math.floor(q * (s.length - 1))]);
}

const blank = () => ({ n: 0, base: 0, male: 0, female: 0, ageSum: 0, ageN: 0, stations: 0, parts: [], families: 0, households: 0, review: 0,
  ...Object.fromEntries(AGE_KEYS.map(([k]) => [k, 0])) });

// add one station's numbers into an area total
function addStation(o, s, row) {
  o.stations++; o.parts.push(s.part_no); o.base += s.voters;
  if (row) {
    o.n += row.n; o.male += row.male; o.female += row.female;
    if (row.avg_age) { o.ageSum += row.avg_age * row.n; o.ageN += row.n; }
  } else {
    o.n += s.voters; o.male += s.male; o.female += s.female; o.ageSum += (s.avg_age || 0) * s.voters; o.ageN += s.avg_age ? s.voters : 0;
    o.families += s.families; o.households += s.households; o.review += s.review;
    for (const [k] of AGE_KEYS) o[k] += s[k] || 0;
  }
  return o;
}

function Fit({ bounds, sig }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return undefined;
    const go = () => { map.invalidateSize(); map.fitBounds(bounds, { padding: [16, 16], animate: false, maxZoom: 17 }); };
    go();
    const t = setTimeout(go, 200);
    return () => clearTimeout(t);
  }, [map, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ZoomClass({ onZoom }) {
  const map = useMap();
  useEffect(() => {
    const on = () => {
      const c = map.getContainer();
      c.classList.toggle("z-far", map.getZoom() < 12.5);
      onZoom?.(map.getZoom());
    };
    on();
    map.on("zoomend", on);
    return () => map.off("zoomend", on);
  }, [map]);
  return null;
}

function Controls({ border, full, setFull }) {
  const map = useMap();
  return (
    <div className="atlas-controls leaflet-top leaflet-right">
      <div className="leaflet-control">
        <button type="button" onClick={() => map.fitBounds(border, { padding: [16, 16] })} title="Show the whole constituency">Fit Kukatpally</button>
        <button type="button" onClick={() => setFull((f) => !f)} aria-pressed={full}>{full ? "Exit full screen" : "Full screen"}</button>
      </div>
    </div>
  );
}

/**
 * Constituency map with real border, approximate locality and polling-station areas.
 * stations: every station (lat, lng, stats); rows: Map part_no -> {n, male, female, avg_age} for a slice, or null for all voters
 * layer: "locality" | "station" | "circles" | "sections"; metric: key of METRICS
 */
export default function AtlasMap({ stations, rows = null, sections = null, secInfo = null, params = {}, layer = "locality", metric = "n",
  height = 560, children, onLayer, focusPart, panel = true, extraActions, apartments = null, aptRows = null }) {
  const [geo, setGeo] = useState(null);
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(13);
  useEffect(() => { loadGeo().then(setGeo).catch(() => setGeo(false)); }, []);
  const dark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const areas = useMemo(() => (geo && stations?.length ? buildAreas(stations, geo) : null), [geo, stations]);
  // age-band measures are only known per station, so apartments fall back to voter counts for those
  const M = (layer === "apartments" && METRICS[metric]?.full) ? METRICS.n : METRICS[metric] || METRICS.n;
  const byPart = useMemo(() => new Map((stations || []).map((s) => [s.part_no, s])), [stations]);

  // area totals for the active layer
  const totals = useMemo(() => {
    const m = new Map();
    if (!stations) return m;
    for (const s of stations) {
      const row = rows ? rows.get(s.part_no) : null;
      if (rows && !row) continue;
      const key = layer === "locality" ? s.locality : s.part_no;
      if (!m.has(key)) m.set(key, blank());
      addStation(m.get(key), s, row);
    }
    return m;
  }, [stations, rows, layer]);

  // apartments: one total per building (the slice's voters there, or everyone)
  const aptTotals = useMemo(() => {
    const m = new Map();
    if (layer !== "apartments" || !apartments) return m;
    for (const ap of apartments) {
      const r = aptRows ? aptRows.get(ap.id) : null;
      if (aptRows && !r) continue;
      const o = blank();
      o.base = ap.voters; o.stations = 0; o.doors = ap.doors; o.apt = ap;
      if (r) { o.n = r.n; o.male = r.male; o.female = r.female; if (r.avg_age) { o.ageSum = r.avg_age * r.n; o.ageN = r.n; } }
      else { o.n = ap.voters; o.male = ap.male; o.female = ap.female; if (ap.avg_age) { o.ageSum = ap.avg_age * ap.voters; o.ageN = ap.voters; } }
      m.set(ap.id, o);
    }
    return m;
  }, [layer, apartments, aptRows]);

  const values = useMemo(() => [...(layer === "apartments" ? aptTotals : totals).values()].map((a) => M.v(a)), [totals, aptTotals, layer, M]);
  const breaks = useMemo(() => quantiles(values), [values]);
  const flat = new Set(values.filter(Number.isFinite).map((v) => Math.round(v * 10))).size <= 1;
  const color = (v) => (!Number.isFinite(v) ? (dark ? "#2a3747" : "#e4e8ee") : RAMP[flat ? 2 : breaks.filter((b) => v > b).length]);

  const features = useMemo(() => {
    if (!areas || layer === "circles" || layer === "sections") return null;
    const src = layer === "locality" || layer === "apartments" ? areas.localities : areas.cells;
    const feats = [];
    for (const [key, multi] of src) {
      const a = layer === "apartments" ? null : totals.get(key);
      feats.push({ type: "Feature", properties: { key, label: layer === "locality" || layer === "apartments" ? key : `PS ${key}`, a: a || null },
        geometry: { type: "MultiPolygon", coordinates: multi } });
    }
    return { type: "FeatureCollection", features: feats };
  }, [areas, layer, totals]);

  const mask = useMemo(() => {
    if (!areas) return null;
    const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    return [world, ...areas.border.map((poly) => poly[0].map(([x, y]) => [y, x]))];
  }, [areas]);
  const borderLines = useMemo(() => (areas ? areas.border.map((poly) => poly[0].map(([x, y]) => [y, x])) : []), [areas]);
  const bounds = useMemo(() => {
    if (focusPart && byPart.get(+focusPart)) { const s = byPart.get(+focusPart); return L.latLng(s.lat, s.lng).toBounds(900); }
    if (rows && rows.size && rows.size < (stations?.length || 0) / 3) {
      return L.latLngBounds([...rows.keys()].map((p) => byPart.get(p)).filter(Boolean).map((s) => [s.lat, s.lng])).pad(0.25);
    }
    return borderLines.length ? L.latLngBounds(borderLines.flat()) : null;
  }, [borderLines, rows, byPart, stations, focusPart]);

  const info = sel || hover; // a pinned area stays in the panel; hovering only previews when nothing is pinned
  const style = (f) => {
    if (layer === "apartments") {   // localities as a quiet backdrop behind the apartment markers
      return { pane: "areas", weight: 0.8, color: dark ? "#3a4a5e" : "#b8c3d0", fillColor: dark ? "#1b2838" : "#e9eef4", fillOpacity: 0.55, interactive: false };
    }
    const a = f.properties.a;
    const on = sel && sel.key === f.properties.key;
    return { pane: "areas", weight: on ? 3 : 1, color: on ? "#d7262f" : dark ? "#0e1722" : "#ffffff", opacity: 1,
      fillColor: color(a ? M.v(a) : NaN), fillOpacity: a ? 0.82 : 0.35 };
  };
  const featKey = `${layer}:${metric}:${rows ? rows.size : "all"}:${sel?.key ?? ""}:${breaks.join(",")}:${dark}`;
  const onEach = (f, lyr) => {
    const p = f.properties;
    if (layer === "apartments") { lyr.bindTooltip(p.label, { sticky: true, className: "atlas-tip" }); return; }
    lyr.on({
      mouseover: (e) => { e.target.setStyle({ weight: 3, color: dark ? "#ffffff" : "#14233a" }); e.target.bringToFront(); setHover({ key: p.key, label: p.label, a: p.a }); },
      mouseout: (e) => { e.target.setStyle(style(f)); setHover(null); },
      click: () => setSel({ key: p.key, label: p.label, a: p.a }),
    });
    lyr.bindTooltip(`<b>${p.label}</b><br>${p.a ? `${M.label}: ${M.fmt(M.v(p.a))}` : "No voters in this view"}`, { sticky: true, className: "atlas-tip" });
  };

  const maxN = Math.max(1, ...[...totals.values()].map((a) => a.n));
  const drillPatch = (s) => (layer === "locality" ? { locality: s.key, part: "", sec: "" } : { part: s.key, sec: "" });

  return (
    <div className={`atlas ${full ? "atlas-full" : ""} ${panel ? "" : "no-panel"}`}>
      <div className="atlas-map" style={{ height: full ? "100%" : height }}>
        {geo === false && <p className="callout">The constituency border could not be loaded; showing stations only.</p>}
        <MapContainer center={[17.462, 78.42]} zoom={13} zoomSnap={0.25} scrollWheelZoom style={{ height: "100%", width: "100%" }} attributionControl>
          <BaseTiles muted />
          <ZoomClass onZoom={setZoom} />
          <Pane name="mask" style={{ zIndex: 380 }} />
          <Pane name="areas" style={{ zIndex: 400 }} />
          <Pane name="border" style={{ zIndex: 450, pointerEvents: "none" }} />
          <Pane name="dots" style={{ zIndex: 500 }} />
          {bounds && <Fit bounds={bounds} sig={`${layer}:${rows ? [...rows.keys()].slice(0, 5).join(",") + rows.size : "all"}:${focusPart || ""}`} />}
          {areas && <Controls border={L.latLngBounds(borderLines.flat())} full={full} setFull={setFull} />}
          {mask && <Polygon positions={mask} pane="mask" interactive={false} pathOptions={{ stroke: false, fillColor: dark ? "#0b121b" : "#f4f6f8", fillOpacity: 0.72 }} />}
          {areas && areas.neighbours.map((f) => (
            <GeoJSON key={f.properties.ac_no} data={f} pane="mask" interactive={false}
              style={{ color: dark ? "#6b7c90" : "#7a8798", weight: 1.2, dashArray: "4 4", fill: false }} />
          ))}
          {areas && areas.neighbours.map((f) => (
            <CircleMarker key={`l${f.properties.ac_no}`} center={f.properties.label} radius={0} pane="mask" interactive={false}>
              <Tooltip permanent direction="center" className="ac-label">{f.properties.name}</Tooltip>
            </CircleMarker>
          ))}
          {features && <GeoJSON key={featKey} data={features} style={style} onEachFeature={onEach} />}
          {features && (layer === "locality" || layer === "apartments") && placeLabels(features.features, zoom).map(({ key, at }) => (
            <CircleMarker key={`t${key}:${zoom}`} center={at} radius={0} pane="border" interactive={false}>
              <Tooltip permanent direction="center" className="loc-label">{key}</Tooltip>
            </CircleMarker>
          ))}
          {borderLines.map((line, i) => (
            <React.Fragment key={i}>
              <Polyline positions={line} pane="border" interactive={false} pathOptions={{ color: dark ? "#0e1722" : "#ffffff", weight: 7, opacity: 0.9 }} />
              <Polyline positions={line} pane="border" interactive={false} pathOptions={{ color: "#d7262f", weight: 3.2 }} />
            </React.Fragment>
          ))}
          {layer === "circles" && stations.map((s) => {
            const a = totals.get(s.part_no);
            if (!a) return null;
            const circles = layer === "circles";
            return (
              <CircleMarker key={`c${s.part_no}`} center={[s.lat, s.lng]} pane="dots"
                radius={circles ? 3.5 + 8 * Math.sqrt(a.n / maxN) : 2.5}
                pathOptions={circles
                  ? { color: dark ? "#0e1722" : "#fff", weight: 1.2, fillColor: color(M.v(a)), fillOpacity: 0.92, dashArray: s.geo_source === "approximate" ? "3 2" : null }
                  : { color: dark ? "#e8eef4" : "#14233a", weight: 1, fillColor: dark ? "#e8eef4" : "#14233a", fillOpacity: 0.9 }}
                eventHandlers={{ click: () => setSel({ key: s.part_no, label: `PS ${s.part_no}`, a }) }}>
                {circles && <Tooltip direction="top" offset={[0, -4]} className="atlas-tip">PS {s.part_no} · {s.locality}: {M.fmt(M.v(a))}</Tooltip>}
              </CircleMarker>
            );
          })}
          {layer === "sections" && sections && secInfo && (() => {
            const nsec = new Map();
            for (const x of secInfo) nsec.set(x.part_no, Math.max(nsec.get(x.part_no) || 0, x.section_no));
            const smax = Math.max(1, ...sections.map((x) => x.n));
            return sections.map((x) => {
              const s = byPart.get(x.part_no);
              if (!s) return null;
              return (
                <CircleMarker key={`s${x.part_no}-${x.section_no}`} center={sectionPoint(s, x.section_no, nsec.get(x.part_no) || 3)} pane="dots"
                  radius={3 + 7 * Math.sqrt(x.n / smax)} pathOptions={{ color: dark ? "#0e1722" : "#fff", weight: 1, fillColor: "#2269c2", fillOpacity: 0.9 }}>
                  <Tooltip direction="top" className="atlas-tip">PS {x.part_no} · section {x.section_no}: {num(x.n)} voters</Tooltip>
                </CircleMarker>
              );
            });
          })()}
          {layer === "apartments" && apartments && (() => {
            const amax = Math.max(1, ...[...aptTotals.values()].map((a) => a.n));
            const big = new Set([...aptTotals.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, zoom >= 15 ? 60 : zoom >= 14 ? 25 : 10).map(([id]) => id));
            return apartments.map((ap) => {
              const a = aptTotals.get(ap.id);
              if (!a) return null;
              const on = sel && sel.key === `apt${ap.id}`;
              return (
                <CircleMarker key={`a${ap.id}`} center={[ap.lat, ap.lng]} pane="dots" radius={4 + 13 * Math.sqrt(a.n / amax)}
                  pathOptions={{ color: on ? "#d7262f" : dark ? "#e8eef4" : "#14233a", weight: on ? 3 : 1.4, fillColor: color(M.v(a)), fillOpacity: 0.9 }}
                  eventHandlers={{ click: () => setSel({ key: `apt${ap.id}`, label: ap.name, a, apt: ap }),
                    mouseover: () => !sel && setHover({ key: `apt${ap.id}`, label: ap.name, a, apt: ap }), mouseout: () => setHover(null) }}>
                  <Tooltip direction="top" offset={[0, -6]} className={big.has(ap.id) ? "apt-label" : "atlas-tip"} permanent={big.has(ap.id)}>
                    {big.has(ap.id) ? ap.name.replace(/^Apartment block /, "Block ") : `${ap.name} · ${num(a.n)} voters`}
                  </Tooltip>
                </CircleMarker>
              );
            });
          })()}
          {children}
        </MapContainer>
        <div className="atlas-legend" aria-label={`Legend: ${M.label}`}>
          <b>{M.label}</b>
          <div className="atlas-ramp">
            {flat ? <span><i style={{ background: RAMP[2] }} />{values.length ? `${M.fmt(values[0])} everywhere` : "–"}</span>
              : RAMP.map((c, i) => (
                <span key={c}><i style={{ background: c }} />{i === 0 ? `≤ ${M.fmt(breaks[0])}` : i === 4 ? `> ${M.fmt(breaks[3])}` : `${M.fmt(breaks[i - 1])}–${M.fmt(breaks[i])}`}</span>
              ))}
          </div>
          <small><i className="lg-border" /> Constituency border (official) · areas inside are estimated from polling-station positions</small>
        </div>
      </div>

      {panel && (
        <aside className="atlas-panel" aria-live="polite">
          {onLayer && (
            <div className="seg-toggle atlas-layers" role="radiogroup" aria-label="Show areas as">
              {[["locality", "Localities"], ["station", "Station areas"], ["circles", "Station circles"], ...(apartments ? [["apartments", "Apartments"]] : []), ...(sections ? [["sections", "Streets"]] : [])].map(([k, l]) => (
                <div key={k}><button type="button" role="radio" aria-checked={layer === k} className={layer === k ? "on" : ""} onClick={() => { setSel(null); onLayer(k); }}>{l}</button></div>
              ))}
            </div>
          )}
          {!info && layer === "apartments" ? (
            <div className="atlas-empty">
              <h3>Apartments &amp; communities</h3>
              <p>{num(aptTotals.size)} found · {num([...aptTotals.values()].reduce((t, a) => t + a.n, 0))} voters. Circle size shows voters; click one to pin it here.</p>
              <ol className="apt-top">
                {[...aptTotals.values()].sort((x, y) => y.n - x.n).slice(0, 12).map((a) => (
                  <li key={a.apt.id}><button type="button" className="linkish" onClick={() => setSel({ key: `apt${a.apt.id}`, label: a.apt.name, a, apt: a.apt })}>{a.apt.name}</button>
                    <span>{num(a.n)}</span></li>
                ))}
              </ol>
              <p className="note">Found from building names and flat numbers in the roll; positions are near the polling station their residents use.</p>
            </div>
          ) : !info ? (
            <div className="atlas-empty">
              <h3>Kukatpally (AC 46)</h3>
              <p>Hover over an area to see its numbers; click to pin it here and drill down.</p>
              <AreaStats a={[...totals.values()].reduce((o, a) => {
                for (const k of Object.keys(o)) if (typeof o[k] === "number") o[k] += a[k] || 0;
                return o;
              }, blank())} rows={rows} />
            </div>
          ) : (
            <div>
              <p className="atlas-kicker">{sel ? "Selected" : "Under the pointer"}</p>
              <h3>{info.label}{layer === "station" || layer === "circles" ? <small> · {byPart.get(info.key)?.locality}</small> : null}</h3>
              {info.apt ? (
                <p className="atlas-sub">{info.apt.kind === "Apartment block" ? `Flats numbered ${info.apt.door}-…` : info.apt.kind} · {info.apt.locality} · votes at PS {info.apt.part_no} · {num(info.apt.doors)} flats/doors</p>
              ) : layer !== "locality" && <p className="atlas-sub" lang="te">{byPart.get(info.key)?.name}</p>}
              {info.a ? <AreaStats a={info.a} rows={rows || info.apt ? rows || true : null} /> : <p>No voters from this view here.</p>}
              {sel && info.a && (
                <div className="atlas-actions">
                  <a className="btn primary" href={drill(params, info.apt ? { apt: info.apt.id, apt_name: info.apt.name, part: "", sec: "" } : drillPatch(info))}>Drill down</a>
                  {info.apt ? <a className="btn" href={link(`/stations/${info.apt.part_no}`, params)}>Station page</a>
                    : layer !== "locality" && <a className="btn" href={link(`/stations/${info.key}`, params)}>Station page</a>}
                  {extraActions && extraActions(info, layer)}
                  <button type="button" className="btn" onClick={() => setSel(null)}>Clear</button>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function AreaStats({ a, rows }) {
  const age = AGE_KEYS.map(([k, l]) => [l, a[k] || 0]);
  const ageMax = Math.max(1, ...age.map(([, v]) => v));
  return (
    <>
      <dl className="atlas-stats">
        <div><dt>{rows && rows !== true ? "Voters in this view" : "Voters"}</dt><dd>{num(a.n)}</dd></div>
        {rows && rows !== true && <div><dt>Share of all voters here</dt><dd>{pct(a.n, a.base)}</dd></div>}
        <div><dt>Women per 1,000 men</dt><dd>{ratio(a.female, a.male)}</dd></div>
        <div><dt>Average age</dt><dd>{a.ageN ? (a.ageSum / a.ageN).toFixed(1) : "–"}</dd></div>
        {a.stations > 0 && <div><dt>Polling stations</dt><dd>{num(a.stations)}</dd></div>}
        {!rows && a.families > 0 && <div><dt>Families</dt><dd>{num(a.families)}</dd></div>}
        {a.doors > 0 && <div><dt>Flats / doors</dt><dd>{num(a.doors)}</dd></div>}
      </dl>
      <div className="gbar-track atlas-g" aria-label={`${num(a.male)} men, ${num(a.female)} women`}>
        <span className="gbar-m" style={{ width: `${(100 * a.male) / (a.male + a.female || 1)}%` }} />
        <span className="gbar-f" style={{ width: `${(100 * a.female) / (a.male + a.female || 1)}%` }} />
      </div>
      <p className="atlas-glabel"><span><i className="sw sw-m" />Men {num(a.male)}</span><span><i className="sw sw-f" />Women {num(a.female)}</span></p>
      {!rows && a.n > 0 && (
        <div className="atlas-ages">
          <h4>Age bands</h4>
          {age.map(([l, v]) => (
            <div key={l} className="atlas-age"><span>{l}</span><span className="hbar-track"><span className="hbar-fill" style={{ width: `${(100 * v) / ageMax}%`, background: "var(--series-seq)" }} /></span><span>{num(v)} <small>({pct(v, a.n)})</small></span></div>
          ))}
        </div>
      )}
    </>
  );
}

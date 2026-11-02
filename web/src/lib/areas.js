// Area shapes for the map. The roll has no boundaries below the constituency, so each polling
// station gets the land closest to it (a Voronoi cell), clipped to the official Kukatpally border.
// Localities are the union of their stations' cells. Approximate by design, and labelled so.
import { Delaunay } from "d3-delaunay";
import pc from "polygon-clipping";

let geoPromise = null;
export function loadGeo() {
  if (!geoPromise) geoPromise = fetch(`${import.meta.env.BASE_URL}geo/constituencies.geojson`).then((r) => r.json());
  return geoPromise;
}

const asMulti = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

const cache = new Map();
export function buildAreas(stations, geo) {
  const main = geo.features.find((f) => f.properties.main);
  const sig = stations.map((s) => `${s.part_no}:${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
  if (cache.has(sig)) return cache.get(sig);
  const border = asMulti(main.geometry);
  const lat0 = 17.47, k = Math.cos((lat0 * Math.PI) / 180);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of border) for (const [x, y] of poly[0]) {
    x0 = Math.min(x0, x * k); x1 = Math.max(x1, x * k); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = 0.01;
  const pts = stations.map((s) => [s.lng * k, s.lat]);
  const vor = Delaunay.from(pts).voronoi([Math.min(x0, ...pts.map((p) => p[0])) - pad, Math.min(y0, ...pts.map((p) => p[1])) - pad,
    Math.max(x1, ...pts.map((p) => p[0])) + pad, Math.max(y1, ...pts.map((p) => p[1])) + pad]);
  const cells = new Map();
  stations.forEach((s, i) => {
    const ring = vor.cellPolygon(i);
    if (!ring) return;
    try {
      const clipped = pc.intersection([ring.map(([x, y]) => [x / k, y])], border);
      if (clipped.length) cells.set(s.part_no, clipped);
    } catch { /* degenerate cell: skip */ }
  });
  const groups = new Map();
  for (const s of stations) {
    if (!cells.has(s.part_no)) continue;
    if (!groups.has(s.locality)) groups.set(s.locality, []);
    groups.get(s.locality).push(cells.get(s.part_no));
  }
  const localities = new Map();
  for (const [name, list] of groups) {
    try { localities.set(name, pc.union(...list)); } catch { localities.set(name, list.flat()); }
  }
  const out = { cells, localities, border, main, neighbours: geo.features.filter((f) => !f.properties.main) };
  cache.set(sig, out);
  return out;
}

// label point: centre of the largest ring's bounding box, nudged to the ring's vertex average
export function labelPoint(multi) {
  let best = null, area = -1;
  for (const poly of multi) {
    const r = poly[0];
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    if (Math.abs(a) > area) { area = Math.abs(a); best = r; }
  }
  if (!best) return null;
  let cx = 0, cy = 0;
  for (const [x, y] of best) { cx += x; cy += y; }
  return [cy / best.length, cx / best.length];
}

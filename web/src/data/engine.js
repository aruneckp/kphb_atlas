// In-browser data engine: answers the same questions the Python API used to, from the
// compact voter columns. Runs inside a Web Worker (see worker.js), so pages stay smooth.
import { houseKey, key as soundKey, readable, squashQuery, TELUGU } from "../lib/telugu.js";

const REL_NAME = { F: "Father", H: "Husband", M: "Mother", O: "Other", "-": "" };
const REL_CODE = { Father: "F", Husband: "H", Mother: "M", Other: "O" };
const HOW_NAME = { h: "same house", s: "similar name in house", b: "same building", n: "same name in station", g: "not on roll", "-": "" };
const AGE_PYRAMID = [[18, 19], ...Array.from({ length: 13 }, (_, i) => [20 + 5 * i, 24 + 5 * i]), [85, 200]];
const BANDS = AGE_PYRAMID.map(([lo, hi]) => (hi < 200 ? `${lo}-${hi}` : `${lo}+`));
const r1 = (x) => Math.round(x * 10) / 10;

export class Engine {
  constructor(summary) {
    this.meta = summary.meta;
    this.reasons = summary.reasons;
    this.stations = summary.stations.map((s) => ({ ...s }));
    this.sections = summary.sections;
    this.byPart = new Map(this.stations.map((s) => [s.part_no, s]));
    this.secByKey = new Map(this.sections.map((x) => [`${x.part_no}-${x.section_no}`, x]));
    this.ready = false;
    this.cache = new Map();
    this.pre = summary.pre || null;
    this.apartments = (summary.apartments || []).map((a) => ({ ...a, partsW: Object.entries(JSON.parse(a.parts || "{}")).map(([p, n]) => [+p, n]) }));
    this.aptById = new Map(this.apartments.map((a) => [a.id, a])); // overview numbers worked out when the data was packed
  }

  // Keep estimated station positions inside the official constituency border:
  // a station that falls outside is walked toward the middle of Kukatpally until it is inside.
  fitInside(fc) {
    const main = fc?.features?.find((f) => f.properties.main);
    if (!main) return;
    const polys = main.geometry.type === "Polygon" ? [main.geometry.coordinates] : main.geometry.coordinates;
    const inside = (lat, lng) => polys.some((poly) => {
      const ring = poly[0];
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    });
    const [clat, clng] = main.properties.label;
    this.boundaryMoved = 0;
    for (const s of this.stations) {
      if (s.geo_source === "saved" || inside(s.lat, s.lng)) continue;
      let t = 0;
      while (t < 1 && !inside(s.lat + (clat - s.lat) * t, s.lng + (clng - s.lng) * t)) t += 0.02;
      t = Math.min(1, t + 0.04); // a little margin inside the border
      s.lat += (clat - s.lat) * t; s.lng += (clng - s.lng) * t;
      this.boundaryMoved++;
    }
  }

  applyPins(pins) {
    for (const [part, p] of Object.entries(pins || {})) {
      const s = this.byPart.get(+part);
      if (s) Object.assign(s, { lat: p.lat, lng: p.lng, geo_source: "saved" });
    }
  }

  // ---------------------------------------------------------------- loading
  loadVoters(d, progress = () => {}) {
    const c = d.cols;
    const n = (this.n = d.n);
    const I = (a) => Int32Array.from(a);
    this.part = I(c.part); this.serial = I(c.serial); this.sec = I(c.sec); this.page = I(c.page);
    this.age = I(c.age); this.fam = I(c.fam); this.hh = I(c.hh); this.gen = I(c.gen); this.link = I(c.link);
    this.flags = I(c.flags); this.ocr = I(c.ocr); this.reason = I(c.reason);
    this.apt = c.apt ? I(c.apt) : new Int32Array(d.n);
    this.epic = c.epic; this.name = c.name; this.rname = c.rname; this.house = c.house;
    this.g = d.g; this.rel = d.rel; this.how = d.how; this.extra = d.extra || {};
    progress("Preparing search");
    this.nkey = new Array(n); this.rkey = new Array(n); this.hkey = new Array(n);
    for (let i = 0; i < n; i++) {
      this.nkey[i] = soundKey(this.name[i]);
      this.rkey[i] = soundKey(this.rname[i]);
      this.hkey[i] = houseKey(this.house[i]);
    }
    progress("Linking families");
    // voters of one polling station sit together; remember each station's range
    this.range = new Map();
    for (let i = 0; i < n; i++) {
      const p = this.part[i];
      const r = this.range.get(p);
      if (r) r[1] = i + 1; else this.range.set(p, [i, i + 1]);
    }
    // order by station then serial number
    const parts = [...this.range.keys()].sort((a, b) => a - b);
    this.order = new Int32Array(n);
    let k = 0;
    for (const p of parts) {
      const [a, b] = this.range.get(p);
      const idx = Array.from({ length: b - a }, (_, j) => a + j).sort((x, y) => this.serial[x] - this.serial[y]);
      for (const i of idx) this.order[k++] = i;
    }
    this.buildFamilies();
    this.buildHouseholds();
    this.ready = true;
    this.cache.clear();
  }

  csr(ids, max) {
    const off = new Int32Array(max + 2);
    for (let i = 0; i < this.n; i++) off[ids[i] + 1]++;
    for (let j = 1; j < off.length; j++) off[j] += off[j - 1];
    const pos = off.slice(), list = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) list[pos[ids[i]]++] = i;
    return { off, list };
  }

  buildFamilies() {
    let F = 0;
    for (let i = 0; i < this.n; i++) if (this.fam[i] > F) F = this.fam[i];
    this.F = F;
    const { off, list } = this.csr(this.fam, F);
    this.famOff = off; this.famList = list;
    const size = new Int32Array(F + 1), male = new Int32Array(F + 1), female = new Int32Array(F + 1),
      gens = new Int32Array(F + 1), maxAge = new Int32Array(F + 1), fpart = new Int32Array(F + 1), ghosts = new Int32Array(F + 1);
    for (let f = 1; f <= F; f++) {
      const a = off[f], b = off[f + 1];
      size[f] = b - a;
      let g = 0, mx = 0, m = 0, w = 0;
      const gh = new Set();
      for (let j = a; j < b; j++) {
        const i = list[j];
        if (this.gen[i] > g) g = this.gen[i];
        if (this.age[i] > mx) mx = this.age[i];
        const s = this.g[i];
        if (s === "M") m++; else if (s === "F") w++;
        if (this.link[i] < 0) gh.add(this.link[i]);
      }
      gens[f] = b > a ? g + 1 : 0; maxAge[f] = mx; male[f] = m; female[f] = w; ghosts[f] = gh.size;
      fpart[f] = b > a ? this.part[list[a]] : 0;
    }
    Object.assign(this, { fSize: size, fMale: male, fFemale: female, fGens: gens, fMaxAge: maxAge, fPart: fpart, fGhosts: ghosts });
  }

  buildHouseholds() {
    let H = 0;
    for (let i = 0; i < this.n; i++) if (this.hh[i] > H) H = this.hh[i];
    this.H = H;
    const { off, list } = this.csr(this.hh, H);
    this.hhOff = off; this.hhList = list;
    const size = new Int32Array(H + 1);
    for (let h = 1; h <= H; h++) size[h] = off[h + 1] - off[h];
    this.hSize = size;
  }

  // ---------------------------------------------------------------- rows
  vrow(i) {
    const s = this.byPart.get(this.part[i]);
    const rc = this.rel[i];
    return {
      id: i + 1, part_no: this.part[i], serial_no: this.serial[i], section_no: this.sec[i], epic: this.epic[i],
      name: this.name[i], name_en: readable(this.name[i]), rel_type: REL_NAME[rc], rel_name: this.rname[i],
      rel_name_en: readable(this.rname[i]), house: this.house[i], age: this.age[i] || null, gender: this.g[i],
      needs_review: this.flags[i] & 1, review_reason: this.reasons[this.reason[i] - 1] || "",
      family_id: this.fam[i], household_id: this.hh[i], link_how: HOW_NAME[this.how[i]], locality: s?.locality,
      apt_id: this.apt?.[i] || 0, apartment: this.aptById.get(this.apt?.[i])?.name || "",
    };
  }

  ghostRow(i) {
    // a relative named by voter i who is not on the roll
    const rc = this.rel[i];
    return { id: `g${-this.link[i]}`, name: this.rname[i], name_en: readable(this.rname[i]),
      gender: rc === "F" || rc === "H" ? "M" : rc === "M" ? "F" : "?", ghost: 1 };
  }

  famRow(f) {
    const a = this.famOff[f], b = this.famOff[f + 1];
    if (!(f >= 1 && f <= this.F) || b <= a) return null;
    const mem = Array.from(this.famList.subarray(a, b));
    const roots = mem.filter((i) => this.link[i] <= 0);
    const head = (roots.length ? roots : mem).sort((x, y) => (this.g[x] !== "M") - (this.g[y] !== "M") || this.age[y] - this.age[x])[0];
    const ages = mem.map((i) => this.age[i]).filter(Boolean);
    const houses = new Map();
    for (const i of mem) if (this.hkey[i]) houses.set(this.hkey[i], (houses.get(this.hkey[i]) || 0) + 1);
    const s = this.byPart.get(this.fPart[f]);
    return {
      id: f, part_no: this.fPart[f], section_no: this.sec[head], size: b - a, ghosts: this.fGhosts[f], gens: this.fGens[f],
      houses: houses.size, male: this.fMale[f], female: this.fFemale[f], head_id: head + 1, head_name: this.name[head],
      head_name_en: readable(this.name[head]), house_key: [...houses].sort((x, y) => y[1] - x[1])[0]?.[0] || "",
      avg_age: ages.length ? r1(ages.reduce((x, y) => x + y, 0) / ages.length) : null,
      min_age: ages.length ? Math.min(...ages) : null, max_age: ages.length ? Math.max(...ages) : null,
      locality: s?.locality, station_name: s?.name,
    };
  }

  hhRow(h) {
    if (!(h >= 1 && h <= this.H)) return null;
    const a = this.hhOff[h], b = this.hhOff[h + 1];
    const mem = this.hhList.subarray(a, b);
    let m = 0, w = 0;
    const fams = new Set();
    for (const i of mem) { if (this.g[i] === "M") m++; else if (this.g[i] === "F") w++; fams.add(this.fam[i]); }
    const i0 = mem[0], s = this.byPart.get(this.part[i0]);
    return { id: h, part_no: this.part[i0], section_no: this.sec[i0], house: this.house[i0], house_key: this.hkey[i0],
      size: b - a, families: fams.size, male: m, female: w, locality: s?.locality, station_name: s?.name };
  }

  // ---------------------------------------------------------------- filters
  partsFor(p) {
    const want = (p.part || "").split(/[,\s]+/).filter((x) => /^\d+$/.test(x)).map(Number);
    let list = want.length ? want : this.stations.map((s) => s.part_no);
    list = list.filter((pn) => {
      const s = this.byPart.get(pn);
      if (!s) return false;
      return (!p.locality || s.locality === p.locality) && (!p.police || s.police_en === p.police) &&
        (!p.mandal || s.mandal_en === p.mandal) && (!p.pin || s.pin === p.pin);
    });
    return list;
  }

  searchTest(q, field = "any") {
    q = (q || "").trim();
    if (!q) return null;
    const parts = q.split(/[\s,;]+/).filter(Boolean);
    const m = /^(\d{1,3})\s*[/:]\s*(\d{1,4})$/.exec(q);
    if (m && (field === "any" || field === "sn")) { const a = +m[1], b = +m[2]; return (i) => this.part[i] === a && this.serial[i] === b; }
    if (field === "sn") {
      const rng = /^(\d+)\s*[-–]\s*(\d+)$/.exec(q);
      if (rng) { const a = Math.min(+rng[1], +rng[2]), b = Math.max(+rng[1], +rng[2]); return (i) => this.serial[i] >= a && this.serial[i] <= b; }
      const nums = new Set(parts.filter((x) => /^\d+$/.test(x)).map(Number));
      return (i) => nums.has(this.serial[i]);
    }
    const epics = parts.map((x) => x.toUpperCase()).filter((x) => /^[A-Z]{2,4}\d{3,}$/.test(x));
    if (field === "epic" || (field === "any" && epics.length && epics.length === parts.length)) {
      const lst = epics.length ? epics : parts.map((x) => x.toUpperCase());
      if (lst.every((e) => /^[A-Z]{3}\d{7}$/.test(e))) { const set = new Set(lst); return (i) => set.has(this.epic[i]); }
      return (i) => lst.some((e) => this.epic[i].includes(e));
    }
    if (field === "house" || (field === "any" && /\d/.test(q) && !TELUGU.test(q) && /^[\dA-Za-z/\-. ]+$/.test(q))) {
      const hk = squashQuery(q);
      if (!hk) return () => false;
      if (field === "any" && /^\d+$/.test(hk)) { const n = +hk, pre = hk + "-"; return (i) => this.serial[i] === n || this.hkey[i].startsWith(pre); }
      return (i) => this.hkey[i].includes(hk);
    }
    const keys = parts.map(soundKey).filter(Boolean);
    if (!keys.length) return () => false;
    if (field === "name") return (i) => keys.every((k) => this.nkey[i].includes(k));
    if (field === "rel") return (i) => keys.every((k) => this.rkey[i].includes(k));
    return (i) => keys.every((k) => this.nkey[i].includes(k) || this.rkey[i].includes(k));
  }

  // returns { parts, test } where test(i) says whether voter i is in the slice
  where(p) {
    const parts = this.partsFor(p);
    const tests = [];
    const one = (p.part || "").split(/[,\s]+/).filter(Boolean);
    if (p.sec && one.length) { const s = +p.sec; tests.push((i) => this.sec[i] === s); }
    if (["M", "F", "T", "?"].includes(p.gender)) { const g = p.gender; tests.push((i) => this.g[i] === g); }
    if (/^\d+$/.test(p.age_min || "")) { const a = +p.age_min; tests.push((i) => this.age[i] > 0 && this.age[i] >= a); }
    if (/^\d+$/.test(p.age_max || "")) { const a = +p.age_max; tests.push((i) => this.age[i] > 0 && this.age[i] <= a); }
    if (p.rel) { const c = REL_CODE[p.rel] || "?"; tests.push((i) => this.rel[i] === c); }
    if (p.review === "1") tests.push((i) => this.flags[i] & 1);
    if (p.reason) {
      const ok = new Set(this.reasons.map((r, j) => (r.includes(p.reason) ? j + 1 : 0)).filter(Boolean));
      tests.push((i) => ok.has(this.reason[i]));
    }
    if (p.dup === "1") tests.push((i) => this.flags[i] & 2);
    if (/^\d+$/.test(p.apt || "")) { const a = +p.apt; tests.push((i) => this.apt[i] === a); }
    if (p.in_apt === "1") tests.push((i) => this.apt[i] > 0);
    if (p.deleted === "1") tests.push((i) => this.flags[i] & 4);
    if (p.nohouse === "1") tests.push((i) => !this.house[i]);
    if (p.linked === "1") tests.push((i) => this.link[i] > 0);
    else if (p.linked === "0") tests.push((i) => this.link[i] <= 0);
    for (const [k, arr, ids] of [["fam_size", "fSize", "fam"], ["hh_size", "hSize", "hh"]]) {
      const m = /^(\d+)(\+?)$/.exec(p[k] || "");
      if (m) {
        const n = +m[1], plus = !!m[2], sz = this[arr], id = this[ids];
        tests.push((i) => id[i] > 0 && (plus ? sz[id[i]] >= n : sz[id[i]] === n));
      }
    }
    if (/^\d+$/.test(p.ocr || "")) { const lo = +p.ocr * 10, hi = lo + 50; tests.push((i) => this.ocr[i] > 0 && this.ocr[i] >= lo && this.ocr[i] < hi); }
    const st = this.searchTest(p.q, p.field || "any");
    if (st) tests.push(st);
    const test = tests.length === 0 ? () => true : tests.length === 1 ? tests[0] : (i) => tests.every((t) => t(i));
    return { parts, test };
  }

  // every matching voter index, in station + serial order
  matches(p) {
    const ck = "m:" + JSON.stringify(this.keyOf(p));
    if (this.cache.has(ck)) return this.cache.get(ck);
    const { parts, test } = this.where(p);
    const out = [];
    const all = parts.length === this.stations.length;
    if (all) {
      for (let k = 0; k < this.n; k++) { const i = this.order[k]; if (test(i)) out.push(i); }
    } else {
      for (const pn of [...parts].sort((a, b) => a - b)) {
        const r = this.range.get(pn);
        if (!r) continue;
        const idx = [];
        for (let i = r[0]; i < r[1]; i++) if (test(i)) idx.push(i);
        idx.sort((x, y) => this.serial[x] - this.serial[y]);
        for (const i of idx) out.push(i);
      }
    }
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(ck, out);
    return out;
  }

  keyOf(p) {
    const o = {};
    for (const k of Object.keys(p).sort()) if (!["page", "size", "sort", "dir"].includes(k) && p[k] !== "" && p[k] != null) o[k] = p[k];
    return o;
  }

  // ---------------------------------------------------------------- endpoints
  getMeta() {
    const uniq = (f) => [...new Set(this.stations.map(f))].sort();
    return {
      ...this.meta,
      stations: this.stations.map((s) => ({ part_no: s.part_no, name: s.name, locality: s.locality, police_en: s.police_en, mandal_en: s.mandal_en, pin: s.pin, voters: s.voters })),
      localities: uniq((s) => s.locality), police: uniq((s) => s.police_en), mandals: uniq((s) => s.mandal_en), pins: uniq((s) => s.pin),
      reasons: this.reasons, auth: false, static: true, apartments_count: this.apartments.length,
      tiles: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", dark: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', invert_dark: true },
    };
  }

  summary(p) {
    const idx = this.matches(p);
    let male = 0, female = 0, third = 0, ageSum = 0, ageN = 0, first = 0, senior = 0, over80 = 0, youth = 0, review = 0, linked = 0;
    const pyr = BANDS.map((band) => ({ band, male: 0, female: 0, other: 0 }));
    const unknown = { band: "unknown", male: 0, female: 0, other: 0 };
    const rel = new Map(), famN = new Map(), hhN = new Map(), parts = new Set();
    for (const i of idx) {
      const g = this.g[i], a = this.age[i];
      if (g === "M") male++; else if (g === "F") female++; else if (g === "T") third++;
      if (a) {
        ageSum += a; ageN++;
        if (a <= 19) first++;
        if (a <= 29) youth++;
        if (a >= 60) senior++;
        if (a >= 80) over80++;
      }
      let row = unknown;
      if (a >= 18) { const b = a <= 19 ? 0 : a >= 85 ? BANDS.length - 1 : 1 + Math.floor((a - 20) / 5); row = pyr[b]; }
      if (g === "M") row.male++; else if (g === "F") row.female++; else row.other++;
      if (this.flags[i] & 1) review++;
      if (this.link[i] > 0) linked++;
      const r = REL_NAME[this.rel[i]] || "Not read";
      rel.set(r, (rel.get(r) || 0) + 1);
      famN.set(this.fam[i], (famN.get(this.fam[i]) || 0) + 1);
      if (this.hh[i] > 0) hhN.set(this.hh[i], (hhN.get(this.hh[i]) || 0) + 1);
      parts.add(this.part[i]);
    }
    const hist = (m, cap) => {
      const h = new Map();
      for (const v of m.values()) { const s = Math.min(v, cap); h.set(s, (h.get(s) || 0) + 1); }
      return [...h].sort((a, b) => a[0] - b[0]);
    };
    const pyramid = pyr.filter((r) => r.male + r.female + r.other > 0);
    if (unknown.male + unknown.female + unknown.other) pyramid.push(unknown);
    return {
      totals: { voters: idx.length, male, female, third, avg_age: ageN ? r1(ageSum / ageN) : null, first_time: first, senior, over80,
        youth, review, families: famN.size, households: hhN.size, linked, stations: parts.size },
      pyramid,
      relations: [...rel].map(([r, n]) => ({ rel: r, n })).sort((a, b) => b.n - a.n),
      family_sizes: hist(famN, 10).map(([size, families]) => ({ size, families })),
      household_sizes: hist(hhN, 15).map(([size, households]) => ({ size, households })),
    };
  }

  voters(p) {
    const page = Math.max(+p.page || 1, 1), size = Math.min(Math.max(+p.size || 50, 1), 500);
    let idx = this.matches(p);
    const cmp = {
      name: (x, y) => readable(this.name[x]).localeCompare(readable(this.name[y])),
      age: (x, y) => this.age[x] - this.age[y],
      house: (x, y) => (this.hkey[x] < this.hkey[y] ? -1 : this.hkey[x] > this.hkey[y] ? 1 : 0),
      family: (x, y) => this.fam[x] - this.fam[y] || this.gen[x] - this.gen[y],
    }[p.sort];
    if (cmp) {
      const ck = "s:" + p.sort + JSON.stringify(this.keyOf(p));
      let sorted = this.cache.get(ck);
      if (!sorted) { sorted = [...idx].sort(cmp); this.cache.set(ck, sorted); }
      idx = sorted;
    }
    const start = (page - 1) * size;
    const pick = p.dir === "desc"
      ? Array.from({ length: Math.max(0, Math.min(size, idx.length - start)) }, (_, k) => idx[idx.length - 1 - start - k])
      : idx.slice(start, start + size);
    return { total: idx.length, page, size, rows: pick.map((i) => this.vrow(i)) };
  }

  family(f) {
    const fam = this.famRow(f);
    if (!fam) return null;
    const mem = Array.from(this.famList.subarray(this.famOff[f], this.famOff[f + 1]));
    mem.sort((x, y) => this.gen[x] - this.gen[y] || (this.age[y] || -1) - (this.age[x] || -1));
    const ghosts = new Map();
    for (const i of mem) if (this.link[i] < 0 && !ghosts.has(this.link[i])) ghosts.set(this.link[i], this.ghostRow(i));
    const s = this.byPart.get(fam.part_no);
    fam.station = { part_no: s.part_no, name: s.name, locality: s.locality };
    return {
      family: fam,
      members: mem.map((i) => ({ ...this.vrow(i), gen: this.gen[i], link_to: this.link[i] > 0 ? String(this.link[i]) : this.link[i] < 0 ? `g${-this.link[i]}` : "" })),
      ghosts: [...ghosts.values()],
    };
  }

  voter(id) {
    const i = id - 1;
    if (!(i >= 0 && i < this.n)) return null;
    const s = this.byPart.get(this.part[i]);
    const v = this.vrow(i);
    const ex = this.extra[id] || ["", ""];
    Object.assign(v, {
      page_no: this.page[i], status: this.flags[i] & 4 ? "Deleted" : "Active", deletion_code: ex[1],
      epic_dup: ex[0] && ex[0].includes(" @ ") ? ex[0] : "", name_dup: ex[0] && !ex[0].includes(" @ ") ? ex[0] : "",
      ocr_conf: this.ocr[i] ? this.ocr[i] / 10 : null, gen: this.gen[i],
      link_to: this.link[i] > 0 ? String(this.link[i]) : this.link[i] < 0 ? `g${-this.link[i]}` : "",
      house_key: this.hkey[i], station_name: s.name, station_address: s.address, police_en: s.police_en, mandal_en: s.mandal_en, pin: s.pin,
      section_name: this.secByKey.get(`${this.part[i]}-${this.sec[i]}`)?.name,
    });
    v.linked = this.link[i] > 0 ? this.vrow(this.link[i] - 1) : this.link[i] < 0 ? this.ghostRow(i) : null;
    v.household = this.hh[i] ? Array.from(this.hhList.subarray(this.hhOff[this.hh[i]], this.hhOff[this.hh[i] + 1]))
      .sort((x, y) => this.serial[x] - this.serial[y]).map((j) => this.vrow(j)) : [];
    v.family = this.family(this.fam[i]);
    return v;
  }

  families(p) {
    const parts = new Set(this.partsFor(p));
    const min = /^\d+$/.test(p.min_size || "") ? +p.min_size : 0;
    const gens = /^\d+$/.test(p.gens || "") ? +p.gens : 0;
    let only = null;
    if (p.q) {
      const k = soundKey(p.q);
      if (k) {
        only = new Set();
        for (const pn of parts) {
          const r = this.range.get(pn);
          for (let i = r[0]; i < r[1]; i++) if (this.nkey[i].includes(k) || this.rkey[i].includes(k)) only.add(this.fam[i]);
        }
      }
    }
    const list = [];
    for (let f = 1; f <= this.F; f++) {
      if (!this.fSize[f] || this.fSize[f] < min || this.fGens[f] < gens || !parts.has(this.fPart[f])) continue;
      if (only && !only.has(f)) continue;
      list.push(f);
    }
    const sorts = {
      size: (a, b) => this.fSize[b] - this.fSize[a] || this.fGens[b] - this.fGens[a] || a - b,
      gens: (a, b) => this.fGens[b] - this.fGens[a] || this.fSize[b] - this.fSize[a] || a - b,
      part: (a, b) => this.fPart[a] - this.fPart[b] || this.fSize[b] - this.fSize[a] || a - b,
      age: (a, b) => this.fMaxAge[b] - this.fMaxAge[a] || a - b,
    };
    list.sort(sorts[p.sort] || sorts.size);
    const page = Math.max(+p.page || 1, 1), size = Math.min(+p.size || 50, 200);
    return { total: list.length, page, size, rows: list.slice((page - 1) * size, page * size).map((f) => this.famRow(f)) };
  }

  households(p) {
    const parts = new Set(this.partsFor(p));
    const min = /^\d+$/.test(p.min_size || "") ? +p.min_size : 0;
    const hk = p.q ? squashQuery(p.q) : "";
    const list = [];
    for (let h = 1; h <= this.H; h++) {
      if (this.hSize[h] < min || !this.hSize[h]) continue;
      const i0 = this.hhList[this.hhOff[h]];
      if (!parts.has(this.part[i0])) continue;
      if (hk && !this.hkey[i0].includes(hk)) continue;
      list.push(h);
    }
    list.sort((a, b) => this.hSize[b] - this.hSize[a] || this.part[this.hhList[this.hhOff[a]]] - this.part[this.hhList[this.hhOff[b]]] || a - b);
    const page = Math.max(+p.page || 1, 1), size = Math.min(+p.size || 50, 200);
    return { total: list.length, page, size, rows: list.slice((page - 1) * size, page * size).map((h) => this.hhRow(h)) };
  }

  household(h) {
    const row = this.hhRow(h);
    if (!row) return null;
    row.members = Array.from(this.hhList.subarray(this.hhOff[h], this.hhOff[h + 1]))
      .sort((x, y) => this.fam[x] - this.fam[y] || (this.age[y] || -1) - (this.age[x] || -1)).map((i) => this.vrow(i));
    return row;
  }

  stationsList(p) {
    return this.stations.filter((s) => (!p.locality || s.locality === p.locality) && (!p.police || s.police_en === p.police) &&
      (!p.mandal || s.mandal_en === p.mandal) && (!p.pin || s.pin === p.pin));
  }

  station(part) {
    const s = this.byPart.get(part);
    if (!s) return null;
    const out = { ...s, sections_list: this.sections.filter((x) => x.part_no === part), neighbours: [part - 1, part + 1].map((x) => this.byPart.get(x)).filter(Boolean).map((x) => ({ part_no: x.part_no, name: x.name, voters: x.voters })) };
    if (this.ready) {
      const fams = [], hhs = new Set();
      const r = this.range.get(part);
      const seen = new Set();
      for (let i = r[0]; i < r[1]; i++) {
        if (!seen.has(this.fam[i])) { seen.add(this.fam[i]); fams.push(this.fam[i]); }
        if (this.hh[i]) hhs.add(this.hh[i]);
      }
      fams.sort((a, b) => this.fSize[b] - this.fSize[a] || this.fGens[b] - this.fGens[a] || a - b);
      out.top_families = fams.slice(0, 12).map((f) => this.famRow(f));
      out.top_households = [...hhs].sort((a, b) => this.hSize[b] - this.hSize[a] || a - b).slice(0, 12).map((h) => this.hhRow(h));
    } else { out.top_families = []; out.top_households = []; }
    return out;
  }

  areas(p) {
    const level = p.level || "locality";
    if (level === "section") {
      const want = new Set((p.part || "").split(/[,\s]+/).filter(Boolean).map(Number));
      return this.sections.filter((x) => (!want.size || want.has(x.part_no)) && (!p.locality || x.locality === p.locality))
        .map((x) => ({ ...x, area: `${x.part_no}-${x.section_no}` })).sort((a, b) => b.voters - a.voters).slice(0, 2000);
    }
    const col = { locality: "locality", police: "police_en", mandal: "mandal_en", pin: "pin" }[level] || "locality";
    const q = { ...p };
    delete q[level];
    const m = new Map();
    for (const s of this.stationsList(q)) {
      const k = s[col];
      const o = m.get(k) || { area: k, stations: 0, voters: 0, male: 0, female: 0, third: 0, ageW: 0, first_time: 0, youth: 0, senior: 0, over80: 0, families: 0, households: 0, review: 0, sections: 0, lat: 0, lng: 0, parts: [] };
      o.stations++; o.voters += s.voters; o.male += s.male; o.female += s.female; o.third += s.third; o.ageW += (s.avg_age || 0) * s.voters;
      o.first_time += s.a18_19; o.youth += s.a18_19 + s.a20_29; o.senior += s.a60_69 + s.a70_79 + s.a80p; o.over80 += s.a80p;
      o.families += s.families; o.households += s.households; o.review += s.review; o.sections += s.sections; o.lat += s.lat; o.lng += s.lng;
      o.parts.push(s.part_no);
      m.set(k, o);
    }
    return [...m.values()].map((o) => ({ ...o, avg_age: o.voters ? r1(o.ageW / o.voters) : null, lat: o.lat / o.stations, lng: o.lng / o.stations, parts: o.parts.join(",") }))
      .sort((a, b) => b.voters - a.voters);
  }

  quality(p) {
    const idx = this.matches(p);
    const reasons = new Map(), ocr = new Map();
    let epic = 0, name = 0, deleted = 0, noHouse = 0, noAge = 0;
    for (const i of idx) {
      if (this.reason[i]) { const r = this.reasons[this.reason[i] - 1]; reasons.set(r, (reasons.get(r) || 0) + 1); }
      if (this.ocr[i]) { const b = Math.floor(this.ocr[i] / 50) * 5; ocr.set(b, (ocr.get(b) || 0) + 1); }
      if (this.flags[i] & 2) { const t = (this.extra[i + 1] || [""])[0]; if (t.includes(" @ ")) epic++; else name++; }
      if (this.flags[i] & 4) deleted++;
      if (!this.house[i]) noHouse++;
      if (!this.age[i]) noAge++;
    }
    return {
      reasons: [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
      ocr: [...ocr].map(([band, n]) => ({ band, n })).sort((a, b) => a.band - b.band),
      epic_dups: epic, name_dups: name, deleted, no_house: noHouse, no_age: noAge,
      cover: this.stations.filter((s) => s.cover_total != null && s.voters !== s.cover_total)
        .map((s) => ({ part_no: s.part_no, name: s.name, locality: s.locality, voters: s.voters, cover_total: s.cover_total, diff: s.voters - s.cover_total, review: s.review }))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
      worst: this.stations.map((s) => ({ part_no: s.part_no, name: s.name, locality: s.locality, voters: s.voters, review: s.review, pct: r1((100 * s.review) / s.voters) }))
        .sort((a, b) => b.pct - a.pct).slice(0, 15),
    };
  }

  breakdown(p) {
    const idx = this.matches(p);
    const st = new Map(), sec = new Map(), apt = new Map();
    for (const i of idx) {
      const pn = this.part[i];
      const ap = this.apt[i];
      if (ap) {
        let a = apt.get(ap);
        if (!a) apt.set(ap, (a = { apt: ap, n: 0, male: 0, female: 0, ageSum: 0, ageN: 0 }));
        a.n++; if (this.g[i] === "M") a.male++; else if (this.g[i] === "F") a.female++;
        if (this.age[i]) { a.ageSum += this.age[i]; a.ageN++; }
      }
      let o = st.get(pn);
      if (!o) st.set(pn, (o = { part_no: pn, n: 0, male: 0, female: 0, ageSum: 0, ageN: 0 }));
      o.n++; if (this.g[i] === "M") o.male++; else if (this.g[i] === "F") o.female++;
      if (this.age[i]) { o.ageSum += this.age[i]; o.ageN++; }
      const k = pn * 1000 + this.sec[i];
      let x = sec.get(k);
      if (!x) sec.set(k, (x = { part_no: pn, section_no: this.sec[i], n: 0, male: 0, female: 0 }));
      x.n++; if (this.g[i] === "M") x.male++; else if (this.g[i] === "F") x.female++;
    }
    return {
      stations: [...st.values()].map(({ ageSum, ageN, ...o }) => ({ ...o, avg_age: ageN ? r1(ageSum / ageN) : null })),
      sections: [...sec.values()],
      apartments: [...apt.values()].map(({ ageSum, ageN, ...o }) => ({ ...o, avg_age: ageN ? r1(ageSum / ageN) : null })),
    };
  }

  // Apartments and gated communities, placed near the polling stations their voters use.
  apartmentsList(p = {}) {
    const parts = new Set(this.partsFor({ ...p, part: "" }));
    const slot = new Map();
    return this.apartments.filter((a) => parts.has(a.part_no) && (!p.part || String(a.part_no) === String(p.part))).map((a) => {
      let lat = 0, lng = 0, w = 0;
      for (const [pn, n] of a.partsW) { const s = this.byPart.get(pn); if (s) { lat += s.lat * n; lng += s.lng * n; w += n; } }
      lat /= w || 1; lng /= w || 1;
      const k = slot.get(a.part_no) || 0;
      slot.set(a.part_no, k + 1);
      const ang = (k + 1) * 2.39996, r = 0.00045 * Math.sqrt(k + 1); // spread blocks of one station so they don't overlap
      return { ...a, partsW: undefined, lat: lat + r * Math.sin(ang), lng: lng + r * Math.cos(ang),
        station: this.byPart.get(a.part_no)?.name };
    });
  }

  sectionsAll() {
    return this.sections.map(({ part_no, section_no, name, place, locality, voters }) => ({ part_no, section_no, name, place, locality, voters }));
  }

  exportCsv(p) {
    const idx = this.matches(p);
    const head = ["part_no", "serial_no", "section_no", "epic", "name", "name_en", "rel_type", "rel_name", "rel_name_en", "house", "age", "gender", "locality", "station", "family_id", "household_id", "needs_review", "review_reason"];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = ["﻿" + head.join(",")];
    for (const i of idx.slice(0, 400000)) {
      const v = this.vrow(i), s = this.byPart.get(v.part_no);
      lines.push([v.part_no, v.serial_no, v.section_no, v.epic, v.name, v.name_en, v.rel_type, v.rel_name, v.rel_name_en, v.house, v.age, v.gender, v.locality, s?.name, v.family_id, v.household_id, v.needs_review, v.review_reason].map(esc).join(","));
    }
    return lines.join("\n");
  }

  // ---------------------------------------------------------------- router
  needsVoters(path, p = {}) {
    if (/^\/api\/(meta|stations|areas|sections|apartments)$/.test(path)) return false;
    // the whole-constituency overview is pre-computed, so it shows before the voter list arrives
    return !(this.pre && Object.keys(p).length === 0 && (path === "/api/summary" || path === "/api/breakdown"));
  }

  handle(path, p) {
    let m;
    if (path === "/api/meta") return this.getMeta();
    if (path === "/api/stations") return this.stationsList(p);
    if (path === "/api/areas") return this.areas(p);
    if (path === "/api/sections") return this.sectionsAll();
    if (path === "/api/apartments") return this.apartmentsList(p);
    if ((m = /^\/api\/station\/(\d+)$/.exec(path))) return this.station(+m[1]);
    if (!this.ready && this.pre && Object.keys(p).length === 0) {
      if (path === "/api/summary") return this.pre.summary;
      if (path === "/api/breakdown") return this.pre.breakdown;
    }
    if (path === "/api/summary") return this.summary(p);
    if (path === "/api/voters") return this.voters(p);
    if ((m = /^\/api\/voter\/(\d+)$/.exec(path))) return this.voter(+m[1]);
    if (path === "/api/families") return this.families(p);
    if ((m = /^\/api\/family\/(\d+)$/.exec(path))) return this.family(+m[1]);
    if (path === "/api/households") return this.households(p);
    if ((m = /^\/api\/household\/(\d+)$/.exec(path))) return this.household(+m[1]);
    if (path === "/api/quality") return this.quality(p);
    if (path === "/api/breakdown") return this.breakdown(p);
    if (path === "/api/export.csv") return this.exportCsv(p);
    throw new Error(`Unknown data request ${path}`);
  }
}

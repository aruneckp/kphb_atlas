// Drill-down links: every chart element opens /drill with the slice it stands for.
import { href, GLOBAL } from "./route.js";

export const SEGMENT = ["apt", "in_apt", "rel", "review", "reason", "dup", "linked", "fam_size", "hh_size", "ocr", "deleted", "nohouse", "sec", "q", "field"];
export const ALL_KEYS = [...GLOBAL, ...SEGMENT, "apt_name"];

export const slice = (params) => Object.fromEntries(ALL_KEYS.filter((k) => params[k]).map((k) => [k, params[k]]));

// keep the current slice and add `patch`; drop the page number
export const drill = (params, patch = {}) => href("/drill", { ...slice(params), ...patch });

// "40-44" -> {age_min:40, age_max:44}; "85+" -> {age_min:85}
export function bandAges(band) {
  const m = /^(\d+)(?:-(\d+)|\+)$/.exec(band || "");
  return m ? { age_min: m[1], age_max: m[2] || "" } : {};
}

const GENDER = { F: "Women", M: "Men", T: "Third gender", "?": "Sex not read" };
const REL = { Father: "who name their father", Husband: "who name their husband", Mother: "who name their mother", Other: "who name another relative" };

// One chip per active filter: [{key, label}]
export function chips(params, meta) {
  const out = [];
  const add = (key, label) => out.push({ key, label });
  if (params.gender) add("gender", GENDER[params.gender] || params.gender);
  if (params.age_min || params.age_max) add("age", params.age_max ? `Age ${params.age_min || 18}–${params.age_max}` : `Age ${params.age_min}+`);
  if (params.mandal) add("mandal", `${params.mandal} mandal`);
  if (params.police) add("police", `${params.police} police station`);
  if (params.locality) add("locality", params.locality);
  if (params.pin) add("pin", `PIN ${params.pin}`);
  if (params.part) {
    const s = meta?.stations.find((x) => String(x.part_no) === String(params.part));
    add("part", `PS ${params.part}${s ? ` · ${s.locality}` : ""}`);
  }
  if (params.sec) add("sec", `Section ${params.sec}`);
  if (params.apt) add("apt", `Apartment: ${params.apt_name || "#" + params.apt}`);
  if (params.in_apt === "1") add("in_apt", "Living in apartments");
  if (params.rel) add("rel", REL[params.rel] || params.rel);
  if (params.review === "1") add("review", "Entries to check");
  if (params.reason) add("reason", `Reason: ${params.reason}`);
  if (params.dup === "1") add("dup", "Possible duplicates");
  if (params.linked === "1") add("linked", "Linked to a relative on the roll");
  if (params.linked === "0") add("linked", "No relative on the roll");
  if (params.fam_size) add("fam_size", `Family of ${params.fam_size} voters`);
  if (params.hh_size) add("hh_size", `${params.hh_size} voters at the door`);
  if (params.ocr) add("ocr", `Reading confidence ${params.ocr}–${+params.ocr + 5}%`);
  if (params.deleted === "1") add("deleted", "Marked deleted");
  if (params.nohouse === "1") add("nohouse", "No house number");
  if (params.q) add("q", `Search: ${params.q}`);
  return out;
}

export function without(params, key) {
  const p = { ...slice(params) };
  if (key === "age") { delete p.age_min; delete p.age_max; } else delete p[key];
  if (key === "apt") delete p.apt_name;
  if (key === "part") delete p.sec;
  if (key === "q") delete p.field;
  if (key === "review") delete p.reason;
  return p;
}

export const describe = (params, meta) => {
  // a station already names its locality, so leave the wider areas out of the title
  const c = chips(params, meta).filter((x) => !(params.part && ["locality", "police", "mandal", "pin"].includes(x.key)));
  return c.length ? c.map((x) => x.label).join(" · ") : "All voters";
};

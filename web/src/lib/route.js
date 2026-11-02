// Hash router: "#/stations/258?gender=F" -> { parts: ["stations","258"], params: {gender:"F"} }
import { useEffect, useState } from "react";

export const GLOBAL = ["locality", "police", "mandal", "pin", "part", "gender", "age_min", "age_max"];

export function parse() {
  const h = decodeURI(window.location.hash.replace(/^#/, "")) || "/";
  const [p, q = ""] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(q));
  return { path: p, parts: p.split("/").filter(Boolean), params };
}

export function href(path, params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, v);
  const s = u.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export const globals = (params) => Object.fromEntries(GLOBAL.filter((k) => params[k]).map((k) => [k, params[k]]));

// link that keeps the area/gender/age filters the person picked
export const link = (path, params = {}, extra = {}) => href(path, { ...globals(params), ...extra });

export function go(path, params) {
  window.location.hash = href(path, params).slice(1);
}

export function useRoute() {
  const [r, set] = useState(parse);
  useEffect(() => {
    const on = () => { set(parse()); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

// change the address without adding a Back step (used while typing)
export function replace(path, params) {
  window.history.replaceState(null, "", href(path, params));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

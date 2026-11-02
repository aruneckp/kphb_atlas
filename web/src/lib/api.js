// Small fetch layer: caches GET responses for the session and cancels stale requests.
import { useEffect, useRef, useState } from "react";
import { request, savePin } from "../data/client.js";

// Plain React (static) build answers every request inside the browser.
// Set VITE_DATA=server to use the optional Python server instead.
export const SERVER = import.meta.env.VITE_DATA === "server";
const clean = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));

const cache = new Map();
const MAX = 300;

export function qs(params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

export async function getJSON(path, params, signal) {
  const url = path + qs(params);
  if (cache.has(url)) return cache.get(url);
  let data;
  if (!SERVER) {
    data = await request(path, clean(params));
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  } else {
    const r = await fetch(url, { signal });
    if (!r.ok) {
      let msg = `Request failed (${r.status})`;
      try { msg = (await r.json()).error || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    data = await r.json();
  }
  if (data === null) throw new Error("Not found");
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  cache.set(url, data);
  return data;
}

export async function postJSON(path, body) {
  let data;
  if (!SERVER) {
    const part = +/\/station\/(\d+)\/pin/.exec(path)[1];
    if (!(body.lat > 17 && body.lat < 18 && body.lng > 78 && body.lng < 79)) throw new Error("pin is outside Hyderabad");
    savePin(part, body.lat, body.lng);
    data = { ok: true, part_no: part, lat: body.lat, lng: body.lng };
  } else {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    data = await r.json();
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  }
  for (const k of [...cache.keys()]) if (k.startsWith("/api/stations") || k.startsWith("/api/station/") || k.startsWith("/api/areas") || k.startsWith("/api/meta")) cache.delete(k);
  return data;
}

// useApi("/api/summary", {locality}) -> { data, error, loading }
export function useApi(path, params, deps) {
  const key = path ? path + qs(params) : null;
  const [state, set] = useState(() => ({ data: key && cache.get(key), error: null, loading: !!key && !cache.has(key) }));
  const last = useRef(null);
  useEffect(() => {
    if (!key) { set({ data: null, error: null, loading: false }); return; }
    if (cache.has(key)) { set({ data: cache.get(key), error: null, loading: false }); return; }
    const ac = new AbortController();
    last.current = key;
    set((s) => ({ data: s.data, error: null, loading: true }));
    getJSON(path, params, ac.signal)
      .then((data) => last.current === key && set({ data, error: null, loading: false }))
      .catch((e) => e.name !== "AbortError" && set({ data: null, error: e.message, loading: false }));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [key]);
  return state;
}

// Save a CSV of the voters matching `params`.
export async function downloadCsv(params, filename = "kphb_voters.csv") {
  if (SERVER) { window.location.href = "/api/export.csv" + qs(params); return; }
  const text = await request("/api/export.csv", clean(params));
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

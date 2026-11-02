// Main-thread side of the data worker: open the data, send requests, follow loading progress.
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let seq = 0;
const waiting = new Map();
const listeners = new Set();
export const state = { phase: "idle", step: "", fraction: 0, mb: 0, error: "" };

const emit = () => listeners.forEach((f) => f({ ...state }));
export const onState = (f) => { listeners.add(f); f({ ...state }); return () => listeners.delete(f); };

let openResolve = null;
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "res") {
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (w) (m.error ? w.reject(new Error(m.error)) : w.resolve(m.data));
  } else if (m.type === "opened") {
    Object.assign(state, { phase: "loading", step: "Downloading voter list", error: "" }); emit();
    openResolve?.({ ok: true });
  } else if (m.type === "open-failed") {
    Object.assign(state, { phase: m.code === "locked" || m.code === "wrong" ? "locked" : "failed", error: m.error }); emit();
    openResolve?.({ ok: false, code: m.code, error: m.error });
  } else if (m.type === "progress") {
    Object.assign(state, { step: m.step, fraction: m.fraction, mb: m.mb ?? state.mb }); emit();
  } else if (m.type === "ready") {
    Object.assign(state, { phase: "ready", step: "", fraction: 1 }); emit();
  } else if (m.type === "fatal") {
    Object.assign(state, { phase: "failed", error: m.error }); emit();
  }
};

export const PIN_KEY = "kphb-pins";
export function savedPins() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY) || "{}"); } catch { return {}; }
}

export function open(password) {
  Object.assign(state, { phase: "opening", error: "" }); emit();
  return new Promise((resolve) => {
    openResolve = resolve;
    worker.postMessage({ type: "open", password, base: import.meta.env.BASE_URL, pins: savedPins() });
  });
}

export function request(path, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ type: "req", id, path, params });
  });
}

export function savePin(part, lat, lng) {
  const pins = savedPins();
  pins[part] = { lat, lng };
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch { /* storage blocked: pin lasts this visit */ }
  worker.postMessage({ type: "pin", part, lat, lng });
  return pins;
}

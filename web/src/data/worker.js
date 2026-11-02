// Web Worker: downloads the encrypted data files, unlocks them with the password,
// and answers data requests from the pages through the Engine.
import { Engine } from "./engine.js";

let engine = null;
let password = "";
let votersReady = null;

async function fetchBytes(name, onProgress) {
  const r = await fetch(`${self.KPHB_BASE || ""}data/${name}`, { cache: "default" });
  if (!r.ok) throw new Error(`Could not download ${name} (${r.status}). Was the data packed? Run: cd web && npm run pack`);
  const total = +r.headers.get("Content-Length") || 0;
  if (!r.body || !onProgress) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(total ? got / total : 0, got);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const MAGIC_PLAIN = "KPHB0", MAGIC_LOCKED = "KPHB1";
const head = (b) => String.fromCharCode(...b.subarray(0, 5));

async function unlock(bytes) {
  const tag = head(bytes);
  let gz;
  if (tag === MAGIC_PLAIN) gz = bytes.subarray(5);
  else if (tag === MAGIC_LOCKED) {
    if (!password) throw Object.assign(new Error("Password needed"), { code: "locked" });
    if (!self.crypto?.subtle) throw new Error("This browser can only unlock the data over https:// or on localhost.");
    const salt = bytes.subarray(5, 21), iv = bytes.subarray(21, 33), body = bytes.subarray(33);
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, base,
      { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    try {
      gz = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body));
    } catch {
      throw Object.assign(new Error("Wrong password"), { code: "wrong" });
    }
  } else throw new Error("The data file is damaged or from another app. Pack it again.");
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

const post = (msg) => self.postMessage(msg);

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "open") {
    password = m.password || "";
    self.KPHB_BASE = m.base || "";
    try {
      const summary = await unlock(await fetchBytes("summary.bin"));
      engine = new Engine(summary);
      engine.applyPins(m.pins);
      post({ type: "opened", locked: !!password });
      votersReady = (async () => {
        const bytes = await fetchBytes("voters.bin", (f, got) => post({ type: "progress", step: "Downloading voter list", fraction: f, mb: got / 1e6 }));
        post({ type: "progress", step: "Unlocking voter list", fraction: 1 });
        const d = await unlock(bytes);
        engine.loadVoters(d, (step) => post({ type: "progress", step, fraction: 1 }));
        post({ type: "ready" });
      })();
      votersReady.catch((err) => post({ type: "fatal", error: err.message }));
    } catch (err) {
      post({ type: "open-failed", code: err.code || "error", error: err.message });
    }
    return;
  }
  if (m.type === "pin") {
    engine?.applyPins({ [m.part]: { lat: m.lat, lng: m.lng } });
    return;
  }
  if (m.type === "req") {
    try {
      if (!engine) throw new Error("Data is not open yet");
      if (engine.needsVoters(m.path, m.params || {})) await votersReady;
      post({ type: "res", id: m.id, data: engine.handle(m.path, m.params || {}) });
    } catch (err) {
      post({ type: "res", id: m.id, error: err.message });
    }
  }
};

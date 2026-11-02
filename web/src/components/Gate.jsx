import React, { useEffect, useRef, useState } from "react";
import { SERVER } from "../lib/api.js";
import { onState, open } from "../data/client.js";

const KEY = "kphb-pass";
const remembered = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };

// Opens the encrypted voter data. Shows a password box when the data is locked.
export default function Gate({ children }) {
  const [st, setSt] = useState({ phase: SERVER ? "ready" : "idle" });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const box = useRef(null);
  useEffect(() => (SERVER ? undefined : onState(setSt)), []);
  useEffect(() => { if (!SERVER) open(remembered()); }, []);
  useEffect(() => { if (st.phase === "locked") box.current?.focus(); }, [st.phase]);

  if (SERVER || ["loading", "ready"].includes(st.phase)) {
    return <>{children}{st.phase === "loading" && <LoadBar st={st} />}</>;
  }
  if (st.phase === "failed") {
    return <div className="gate"><div className="gate-card"><h1>Kukatpally voter atlas</h1><p className="error">{st.error}</p></div></div>;
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    const r = await open(pw);
    setBusy(false);
    if (r.ok) { try { sessionStorage.setItem(KEY, pw); } catch { /* private window */ } }
    else setMsg(r.code === "wrong" ? "That password does not open the data. Check it and try again." : r.error);
  };
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <svg viewBox="0 0 32 32" className="gate-logo" aria-hidden="true"><path d="M3 21h26" stroke="var(--metro)" strokeWidth="3" strokeLinecap="round" /><circle cx="16" cy="21" r="5" fill="var(--card)" stroke="var(--metro)" strokeWidth="3" /><path d="M6 6h5v9H6zM13 4h6v11h-6zM21 8h5v7h-5z" fill="var(--block)" /></svg>
        <h1>Kukatpally voter atlas</h1>
        {(st.phase === "idle" || (st.phase === "opening" && !pw)) ? <p>Opening…</p> : (
          <>
            <p>The voter list is encrypted. Enter the password to open it on this device.</p>
            <label htmlFor="pw">Password</label>
            <input id="pw" ref={box} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
            {msg && <p className="error" role="alert">{msg}</p>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Unlocking…" : "Open the voter list"}</button>
            <small>Nothing is sent anywhere: the password unlocks the data inside your browser.</small>
          </>
        )}
      </form>
    </div>
  );
}

function LoadBar({ st }) {
  const pct = Math.round((st.fraction || 0) * 100);
  return (
    <div className="loadbar" role="status" aria-live="polite">
      <span>{st.step}{st.step.startsWith("Downloading") ? ` · ${pct}%${st.mb ? ` (${st.mb.toFixed(1)} MB)` : ""}` : "…"}</span>
      <i style={{ width: `${st.step.startsWith("Downloading") ? pct : 100}%` }} />
    </div>
  );
}

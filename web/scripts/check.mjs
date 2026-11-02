#!/usr/bin/env node
// Self-check for the in-browser engine, run against the exported data:  npm run check
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/data/engine.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "static");
if (!existsSync(join(src, "voters.json"))) { console.error("Run python3 scripts/export_static.py first."); process.exit(1); }
const summary = JSON.parse(readFileSync(join(src, "summary.json"), "utf8"));
const e = new Engine(summary);
let t = Date.now();
e.loadVoters(JSON.parse(readFileSync(join(src, "voters.json"), "utf8")));
console.log(`loaded ${e.n.toLocaleString("en-IN")} voters in ${Date.now() - t} ms`);
let ok = 0, bad = 0;
const check = (name, cond, more = "") => { cond ? ok++ : bad++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${name} ${cond ? "" : more}`); };
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const all = e.handle("/api/summary", {});
check("voter count matches the database", all.totals.voters === summary.meta.voters, `${all.totals.voters} vs ${summary.meta.voters}`);
check("station totals add up", sum(e.stations, (s) => s.voters) === e.n);
check("families add up", sum(all.family_sizes, (r) => r.families) === summary.meta.families);
const unread = [...e.g].filter((c) => c === "?").length;
check("men + women + third gender + not read = voters", all.totals.male + all.totals.female + all.totals.third + unread === e.n);
const loc = e.handle("/api/summary", { locality: e.stations[0].locality });
check("locality filter narrows", loc.totals.voters > 0 && loc.totals.voters < e.n);
const i = 12345, epic = e.epic[i];
check("search by voter ID", e.handle("/api/voters", { q: epic }).rows.some((r) => r.id === i + 1));
check("search by station/serial", e.handle("/api/voters", { q: `${e.part[i]}/${e.serial[i]}` }).rows[0]?.id === i + 1);
check("search by Telugu name", e.handle("/api/voters", { q: e.name[i], part: String(e.part[i]) }).rows.some((r) => r.id === i + 1));
check("English spelling finds Telugu names", e.handle("/api/voters", { q: "lakshmi" }).total > 1000);
const f = e.handle("/api/family/" + e.fam[i]);
check("family contains the voter", f.members.some((m) => m.id === i + 1));
const br = e.handle("/api/breakdown", { gender: "F", age_min: "60" });
const s60 = e.handle("/api/summary", { gender: "F", age_min: "60" });
check("drill-down map counts add up", sum(br.stations, (x) => x.n) === s60.totals.voters && sum(br.sections, (x) => x.n) === s60.totals.voters);
check("families list", e.handle("/api/families", { min_size: "5" }).total > 0);
check("households list", e.handle("/api/households", { min_size: "10" }).total > 0);
check("CSV export", e.handle("/api/export.csv", { part: "258" }).split("\n").length > 100);
t = Date.now();
for (const p of [{ gender: "F" }, { q: "ramesh" }, { hh_size: "10+" }, { review: "1" }]) e.handle("/api/summary", p);
console.log(`  4 constituency-wide questions answered in ${Date.now() - t} ms`);
console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

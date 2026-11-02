#!/usr/bin/env node
// Compress and encrypt the exported voter data for the static (plain React) app.
//   npm run pack -- --password "your password"        (or set KPHB_PASS)
//   npm run pack -- --no-password                      (NOT for the internet: anyone could read it)
// Reads ../data/static/{summary,voters}.json (from scripts/export_static.py) and writes public/data/*.bin
import { gzipSync, constants } from "node:zlib";
import { randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "data", "static");
const out = join(here, "..", "public", "data");
const args = process.argv.slice(2);
const pi = args.indexOf("--password");
const password = pi >= 0 ? args[pi + 1] : process.env.KPHB_PASS || "";
const plain = args.includes("--no-password");

if (!plain && !password) {
  console.error("Choose a password: npm run pack -- --password \"...\"  (people type it to open the app)");
  process.exit(1);
}
if (password && password.length < 12) {
  console.error("Use a password of at least 12 characters (the encrypted files can be downloaded by anyone who finds the site or repo).");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

// work out the whole-constituency overview now, so the first page shows before the big file arrives
{
  const { Engine } = await import("../src/data/engine.js");
  const sfile = join(src, "summary.json"), vfile = join(src, "voters.json");
  if (existsSync(sfile) && existsSync(vfile)) {
    const summary = JSON.parse(readFileSync(sfile, "utf8"));
    delete summary.pre;
    const e = new Engine(summary);
    e.loadVoters(JSON.parse(readFileSync(vfile, "utf8")));
    summary.pre = { summary: e.summary({}), breakdown: e.breakdown({}) };
    writeFileSync(sfile, JSON.stringify(summary));
    console.log(`checked ${e.n.toLocaleString("en-IN")} voters and saved the overview numbers`);
  }
}

for (const name of ["summary", "voters"]) {
  const file = join(src, `${name}.json`);
  if (!existsSync(file)) { console.error(`Missing ${file}. Run: python3 scripts/export_static.py`); process.exit(1); }
  const gz = gzipSync(readFileSync(file), { level: constants.Z_BEST_COMPRESSION });
  let body;
  if (plain) {
    body = Buffer.concat([Buffer.from("KPHB0"), gz]);
  } else {
    const salt = randomBytes(16), iv = randomBytes(12);
    const key = pbkdf2Sync(password, salt, 210000, 32, "sha256");
    const c = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(gz), c.final(), c.getAuthTag()]);  // tag at the end, as WebCrypto expects
    body = Buffer.concat([Buffer.from("KPHB1"), salt, iv, enc]);
  }
  writeFileSync(join(out, `${name}.bin`), body);
  console.log(`${name}.bin  ${(body.length / 1e6).toFixed(1)} MB${plain ? "  (NOT encrypted)" : "  (encrypted)"}`);
}
console.log(`Packed into ${out}. Next: npm run build`);

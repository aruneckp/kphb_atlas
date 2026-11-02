#!/usr/bin/env node
// Encrypted backup of the raw roll inside the repo, so everything can be rebuilt from GitHub alone.
//   npm run backup  -- --password "..."   ../kkp_csv.zip       -> ../backup/kkp_csv.zip.enc
//   npm run restore -- --password "..."   ../backup/kkp_csv.zip.enc -> ../kkp_csv.zip
// Same format as the app data: "KPHB1" + salt + iv + AES-256-GCM (key from PBKDF2-SHA256, 210,000 rounds).
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const zip = join(root, "kkp_csv.zip"), enc = join(root, "backup", "kkp_csv.zip.enc");
const args = process.argv.slice(2);
const restore = args.includes("--restore");
const pi = args.indexOf("--password");
const password = pi >= 0 ? args[pi + 1] : process.env.KPHB_PASS || "";
if (password.length < 12) { console.error('Give the password (12+ characters): --password "..." or KPHB_PASS'); process.exit(1); }

if (!restore) {
  if (!existsSync(zip)) { console.error(`Missing ${zip}`); process.exit(1); }
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", pbkdf2Sync(password, salt, 210000, 32, "sha256"), iv);
  const body = Buffer.concat([c.update(readFileSync(zip)), c.final(), c.getAuthTag()]);
  mkdirSync(dirname(enc), { recursive: true });
  writeFileSync(enc, Buffer.concat([Buffer.from("KPHB1"), salt, iv, body]));
  console.log(`backup/kkp_csv.zip.enc  ${(body.length / 1e6).toFixed(1)} MB (encrypted) - safe to commit`);
} else {
  if (!existsSync(enc)) { console.error(`Missing ${enc}`); process.exit(1); }
  const b = readFileSync(enc);
  if (b.subarray(0, 5).toString() !== "KPHB1") { console.error("Not a KPHB backup file."); process.exit(1); }
  const salt = b.subarray(5, 21), iv = b.subarray(21, 33), data = b.subarray(33, b.length - 16), tag = b.subarray(b.length - 16);
  const d = createDecipheriv("aes-256-gcm", pbkdf2Sync(password, salt, 210000, 32, "sha256"), iv);
  d.setAuthTag(tag);
  try {
    writeFileSync(zip, Buffer.concat([d.update(data), d.final()]));
  } catch { console.error("Wrong password - kkp_csv.zip was not restored."); process.exit(1); }
  console.log("Restored kkp_csv.zip from backup/kkp_csv.zip.enc");
}

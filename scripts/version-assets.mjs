// Adds a content fingerprint to every css/ and js/ file the page loads, e.g. js/lobby.js?v=3f9a1c02be.
// Vercel runs this on every deploy (vercel.json "buildCommand"), so browsers can keep these files for a
// year: when a file changes, its fingerprint changes, and index.html (never cached) asks for the new name.
//
// It edits the files in place, so it only runs on Vercel (VERCEL is set there) or with --force.
// Run locally without --force to see what it would do:   node scripts/version-assets.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = !!process.env.VERCEL || process.argv.includes('--force');
const rel = f => path.join(root, f);
const read = f => fs.readFileSync(rel(f), 'utf8');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(rel(f))).digest('hex').slice(0, 10);
const fail = m => { console.error('version-assets: ' + m); process.exit(1); };
const exists = f => fs.existsSync(rel(f)) || fail('missing file ' + f);

// 1. The admin stub loads admin.js and admin-shell.js by name: tag those first, so the stub's own
//    fingerprint (taken next) reflects the new names.
const STUB = 'js/admin-stub.js';
let stub = read(STUB);
for (const f of ['js/admin.js', 'js/admin-shell.js']) {
  exists(f);
  const before = stub;
  stub = stub.split("'" + f + "'").join("'" + f + '?v=' + hash(f) + "'");
  if (stub === before) fail(f + ' is no longer loaded by ' + STUB + ' (update this script)');
}
if (write) fs.writeFileSync(rel(STUB), stub);

// 2. index.html: tag every local css/ and js/ reference
let html = read('index.html');
const tagged = [];
html = html.replace(/(\b(?:href|src)=")((?:css|js)\/[\w.-]+\.(?:css|js))(")/g, (m, a, f, z) => {
  exists(f);
  const h = (write || f !== STUB) ? hash(f) : crypto.createHash('sha256').update(stub).digest('hex').slice(0, 10);
  tagged.push(f + '?v=' + h);
  return a + f + '?v=' + h + z;
});
if (tagged.length < 10) fail('only ' + tagged.length + ' css/js references found in index.html; something is off');
if (write) fs.writeFileSync(rel('index.html'), html);

console.log((write ? 'Tagged ' : 'Would tag (dry run, nothing written) ') + tagged.length + ' files:\n  ' + tagged.join('\n  '));

// The page and the files, held to CLAIMS.md: P (no measured number typed into the page), the sections a stranger needs,
// the pins on everything vendored, SEAL 1 unchanged, the wire's promises visible in its own source, and the credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import W from '../src/wall.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(new URL(p, ROOT))).digest('hex');
const html = read('index.html'), app = read('app.mjs'), ask = read('tools/ask.mjs');
const visible = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/style="[^"]*"/g, '');

test('SEAL 1 is the claims as sealed, unchanged', () => {
  assert.equal(sha('CLAIMS.md'), '26f775b7d09029c1c90bf77cfd099a8b2f8b0746ea18addd8267c6a21a140db1');
});

test('the pins: every vendored file is the bytes it came as', () => {
  const pinned = new Map();
  for (const s of JSON.parse(read('vendor/SOURCES.json')).sources) for (const f of s.files) pinned.set(f.path, f.sha256);
  const files = [];
  (function walk(d) { for (const n of readdirSync(new URL(d, ROOT))) { const p = d + '/' + n; if (statSync(new URL(p, ROOT)).isDirectory()) walk(p); else files.push(p); } })('vendor');
  for (const f of files.filter((x) => x !== 'vendor/SOURCES.json')) { assert.ok(pinned.has(f), f + ' is not pinned'); assert.equal(sha(f), pinned.get(f), f + ' changed'); }
  assert.equal(pinned.size, 3);
});

test('P: no measured number is typed into the page', () => {
  const sim = JSON.parse(read('data/sim.json')), m = sim.measured, usd = (c) => '$' + (c / 100).toFixed(2);
  const forms = new Set([usd(m.k2.dearestDayCents), usd(m.k2.cheapestDemandCents), usd(m.k3.totalCents), usd(m.k4.tallyTotalCents), sim.ledger.sha256.slice(0, 12)]);
  for (const n of [m.k1.requestsWithoutEvidence, m.k2.refusedForDay, m.k3.refusedForStop, m.k4.entries, m.k4.calls, m.k4.refused]) if (n > 9) forms.add(String(n)), forms.add(n.toLocaleString('en-GB'));
  if (m.k3.firstOffDay) forms.add(m.k3.firstOffDay);
  for (const s of forms) assert.equal(visible.includes(s), false, 'the page has "' + s + '" typed in; it must come from the receipts');
  for (const s of [usd(sim.settings.dayCents), usd(sim.settings.stopCents)]) assert.equal(visible.includes(s), false, 'settings are read from the record too: ' + s);
  assert.match(app, /json\('data\/sim\.json'\)/);
  assert.match(app, /chip\(pass, 'HELD', 'FAILED'/);
  assert.match(app, /await checkP\(\)/, 'P is decided in the browser too');
  assert.match(app, /await checkR\(\)/, 'R is decided in the browser too');
  assert.match(app, /REAL\.calls === 0 \? '<span class="chip wait">NO CALL YET<\/span>'/,'the real ledger is never shown as held before it has a call');
  assert.equal(/\$\s?\d/.test(visible), false, 'no dollar figure typed into the page');
});

test('the page explains itself, talks only to itself, and carries its credits', () => {
  for (const id of ['result', 'watch', 'try', 'what', 'threat', 'words', 'start', 'how', 'blueprint', 'contract', 'adoption', 'pilot', 'paper', 'business']) assert.match(html, new RegExp('<section id="' + id + '"'), id);
  assert.match(html, /A claim that misses its bar is kept and shown as failed\./);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /Powered by the Konomi architecture, created by Thomas Frumkin/);
  assert.match(html, /Supplied by <a href="https:\/\/www\.ai-nativesolutions\.com"/);
  assert.equal(/£\s?\d|per seat|\/mo\b/i.test(visible), false, 'no price of ours on the page');
  assert.equal(/my-estate-graph|https?:\/\/(?!www\.ai-nativesolutions\.com|github\.com\/sjgant80-hub\/kar-spendwall)/.test(html.replace(/xmlns="[^"]*"|const svgNS = '[^']*'/g, '')), false, 'no address but the supplier and the source');
  assert.equal(W.findSecrets(html + app), 0);
  for (const f of ['CLAIMS.md', 'LICENSE', 'NOTICE', 'README.md', 'data/prices.json', 'data/sim.json', 'data/witness.json', 'data/proofs.json', 'data/real.json']) assert.ok(existsSync(new URL(f, ROOT)), f);
});

test('the wire keeps its promises in its own source: one address, no retry, the environment ignored', () => {
  assert.match(ask, /'https:\/\/api\.anthropic\.com'/);
  assert.match(ask, /'http:\/\/127\.0\.0\.1:' \+ port/);
  const addrs = ask.match(/https?:\/\/[^'"`\s]+/g) || [];
  assert.ok(addrs.every((a) => a === 'https://api.anthropic.com' || a === 'http://127.0.0.1:'), addrs.join(' '));
  assert.match(ask, /if \(k\.toUpperCase\(\)\.startsWith\('ANTHROPIC_'\)\) delete process\.env\[k\]/);
  assert.match(ask, /maxRetries: 0/);
  assert.match(ask, /const DIR = LOOP < 0 \? REAL_DIR : /, 'for real, the ledger is at its fixed place');
  assert.match(ask, /const HOME = userInfo\(\)\.homedir;/, 'the home folder the operating system reports, not HOME or USERPROFILE');
  assert.equal(/import \{[^}]*\bhomedir\b/.test(ask), false, 'os.homedir is not even imported');
  assert.match(read('tools/audit.mjs'), /const HOME = userInfo\(\)\.homedir;/, 'the audit reads the same fixed places');
  assert.match(ask, /const KEYFILE = LOOP < 0 \? REAL_KEY : /, 'for real, the key is at its fixed place');
  assert.match(ask, /same\(KEYFILE, REAL_KEY\) \|\| same\(DIR, REAL_DIR\)/, 'the test mode refuses the real key and the real ledger');
  assert.match(ask, /new Anthropic\(\{ apiKey: key, baseURL: endpoint, maxRetries: 0, timeout: 240000 \}\)/);
  const at = (s) => ask.indexOf(s);
  assert.ok(at('append(p.entry)') > 0 && at('append(p.entry)') < at('readFileSync(KEYFILE'), 'the plan is on disk before the key is read');
  assert.ok(at('readFileSync(KEYFILE') < at('client.messages.create'), 'the key is read just before the one request');
  assert.equal((ask.match(/messages\.create\(/g) || []).length, 1, 'one request site');
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['@anthropic-ai/sdk']);
  assert.match(pkg.dependencies['@anthropic-ai/sdk'], /^\d+\.\d+\.\d+$/, 'pinned to an exact version');
});

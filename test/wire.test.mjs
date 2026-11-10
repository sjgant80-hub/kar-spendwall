// The wire, end to end, with no money spent: tools/ask.mjs talks through the real SDK to a stand-in for the API on
// 127.0.0.1. The key is fake, built at run time (so no key-shaped string is ever committed), and decoy ANTHROPIC_*
// variables point at a second server that must never be called (K6). Every claim the wire carries is checked from the
// ledger it writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import W from '../src/wall.mjs';

const ASK = new URL('../tools/ask.mjs', import.meta.url);
const PRICES = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8'));
const KEY = ['sk', 'ant', 'api03'].join('-') + '-' + randomBytes(24).toString('hex');
const DECOY = ['sk', 'ant', 'api03'].join('-') + '-' + randomBytes(24).toString('hex');
const GOOD = { tier1: { asked: true, answered: false, what: 'the pattern library has no rule for fam' }, tier2: { tried: 3, passed: 0, model: 'qwen2.5:7b', dropped: [] } };
const PROMPT = 'Write up to 5 rules that pick out "fam" repositories.';

let api, decoy, hits = [], decoyHits = 0, mode = 'ok';
const listen = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s.address().port)));
let apiPort, decoyPort;

before(async () => {
  api = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      if (mode === 'error') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_test' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'WHEN alpha THEN fam\nWHEN beta AND gamma THEN fam' }],
        stop_reason: mode === 'refusal' ? 'refusal' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 812, output_tokens: 431, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    });
  });
  decoy = createServer((req, res) => { decoyHits++; res.writeHead(500); res.end(); });
  apiPort = await listen(api);
  decoyPort = await listen(decoy);
});
after(() => { api.close(); decoy.close(); });

const box = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kar-spendwall-'));
  const keyfile = join(dir, 'anthropic-api.key');
  writeFileSync(keyfile, KEY + '\n');
  return { dir, keyfile, api: join(dir, 'api') };
};
const ask = (b, req, extra = [], keyfile = b.keyfile) => new Promise((ok) => {
  const env = { ...process.env, KAR_SPENDWALL_DIR: b.api, KAR_SPENDWALL_KEYFILE: keyfile,
    ANTHROPIC_API_KEY: DECOY, ANTHROPIC_AUTH_TOKEN: DECOY, ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + decoyPort, ANTHROPIC_PROFILE: 'decoy' };
  const args = extra.includes('--loopback') ? extra : ['--loopback', String(apiPort), ...extra];
  const p = spawn(process.execPath, [fileURLToPath(ASK), ...args], { env });
  let stdout = '', stderr = '';
  p.stdout.on('data', (c) => (stdout += c));
  p.stderr.on('data', (c) => (stderr += c));
  p.on('close', (code) => {
    let o = null;
    try { o = JSON.parse(stdout.trim().split('\n').pop()); } catch {}
    ok({ code, stdout, stderr, o, ledger: existsSync(join(b.api, 'ledger.jsonl')) ? readFileSync(join(b.api, 'ledger.jsonl'), 'utf8') : '' });
  });
  p.stdin.end(JSON.stringify(req));
});
const entries = (text) => text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const noKey = (r) => {
  for (const [name, s] of [['stdout', r.stdout], ['stderr', r.stderr], ['ledger', r.ledger]]) {
    assert.equal(s.includes(KEY), false, 'the key is in ' + name);
    assert.equal(s.includes(DECOY), false, 'the decoy key is in ' + name);
  }
};

test('one call: reserved, made once through the SDK to the stand-in, settled, priced, and the key never seen', async () => {
  const b = box(); hits = []; decoyHits = 0; mode = 'ok';
  const r = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  const want = W.ceiling(W.rate(PRICES, 'claude-opus-5-5'), W.bytesOf(['', PROMPT]), W.DEFAULTS);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.o.ok, true);
  assert.equal(r.o.code, 'end_turn');
  assert.equal(r.o.text, 'WHEN alpha THEN fam\nWHEN beta AND gamma THEN fam');
  assert.equal(r.o.costCents, 2);
  assert.equal(r.o.ceilingCents, want);
  assert.equal(r.o.seq, 1);
  assert.match(r.o.brief, /^API tier: today \$0\.02 of \$2\.50 · \$0\.02 of the \$100\.00 credit spent/);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, 'POST');
  assert.equal(hits[0].url, '/v1/messages');
  assert.deepEqual(hits[0].body, { model: 'claude-opus-5-5', max_tokens: 6000, output_config: { effort: 'medium' }, messages: [{ role: 'user', content: PROMPT }] });
  const auth = String(hits[0].headers['x-api-key'] || '') + ' ' + String(hits[0].headers.authorization || '');
  assert.ok(auth.includes(KEY), 'the key from the file is what was sent');
  assert.equal(auth.includes(DECOY), false, 'no credential from the environment was sent');
  assert.equal(decoyHits, 0, 'nothing went to the endpoint in the environment');
  const L = entries(r.ledger);
  assert.deepEqual(L.map((e) => [e.seq, e.kind]), [[1, 'reserve'], [1, 'settle']]);
  assert.equal(L[0].ceilingCents, want);
  assert.deepEqual(L[0].evidence, GOOD);
  assert.deepEqual(L[1].tokens, { in: 812, out: 431, write: 0, read: 0 });
  assert.equal(L[1].priced, true);
  assert.equal(L[1].overrun, false);
  assert.ok(Date.parse(L[0].at) <= Date.parse(L[1].at));
  noKey(r);
  assert.equal(W.findSecrets(r.stdout + r.stderr + r.ledger), 0);
  assert.equal(existsSync(join(b.api, 'ledger.lock')), false);
  rmSync(b.dir, { recursive: true, force: true });
});

test('refusals go in the ledger and nothing goes out: no evidence, today\'s cap, no key, no size', async () => {
  const b = box(); hits = []; mode = 'ok';
  const t = await ask(b, { job: 'teacher', evidence: { ...GOOD, tier2: { tried: 0, passed: 0 } }, prompt: PROMPT });
  assert.equal(t.o.ok, false);
  assert.equal(t.o.code, 'tier');
  mkdirSync(b.api, { recursive: true });
  // a cap of 1 cent: this call's ceiling alone is more than a whole day's cap, so it is refused as too big
  writeFileSync(join(b.api, 'settings.json'), JSON.stringify({ dayCents: 1, stopCents: 9500 }));
  const big = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(big.o.code, 'big');
  // a cap that exactly fits the call, with one cent already spent today: refused for the day
  const want = W.ceiling(W.rate(PRICES, 'claude-opus-5-5'), W.bytesOf(['', PROMPT]), W.DEFAULTS), now = new Date().toISOString();
  writeFileSync(join(b.api, 'settings.json'), JSON.stringify({ dayCents: want, stopCents: 9500 }));
  writeFileSync(join(b.api, 'ledger.jsonl'), readFileSync(join(b.api, 'ledger.jsonl'), 'utf8') + JSON.stringify({ seq: 3, at: now, day: now.slice(0, 10), kind: 'reserve', job: 'earlier', ceilingCents: 1 }) + '\n');
  const d = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(d.o.code, 'day');
  writeFileSync(join(b.api, 'settings.json'), '{}');
  const k = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT }, [], join(b.dir, 'missing.key'));
  assert.equal(k.o.code, 'key');
  assert.match(k.o.why, /no API key is installed, so the API tier is off \(Simon puts it in .*missing\.key\)/);
  const z = await ask(b, { job: 'teacher', evidence: GOOD, prompt: '' });
  assert.equal(z.o.code, 'size');
  const g = await ask(b, 'not an object');
  assert.equal(g.o.code, 'size');
  assert.equal(hits.length, 0, 'no request went out for any refusal');
  const L = entries(g.ledger);
  assert.deepEqual(L.map((e) => [e.seq, e.kind, e.code]), [[1, 'refuse', 'tier'], [2, 'refuse', 'big'], [3, 'reserve', undefined], [4, 'refuse', 'day'], [5, 'refuse', 'key'], [6, 'refuse', 'size'], [7, 'refuse', 'size']]);
  for (const r of [t, big, d, k, z, g]) noKey(r);
  rmSync(b.dir, { recursive: true, force: true });
});

test('an API error is charged the whole ceiling and said; a refusal stop is priced and not ok', async () => {
  const b = box(); hits = []; mode = 'error';
  const e = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(e.o.ok, false);
  assert.equal(e.o.code, 'error');
  assert.ok(e.o.why.length > 0);
  assert.equal(hits.length, 1, 'no retry: one request under one reservation');
  const L = entries(e.ledger);
  assert.equal(L[1].kind, 'settle');
  assert.equal(L[1].costCents, L[0].ceilingCents);
  assert.equal(L[1].priced, false);
  assert.ok(typeof L[1].error === 'string' && L[1].error.length > 0);
  noKey(e);
  mode = 'refusal';
  const r = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(r.o.ok, false);
  assert.equal(r.o.code, 'refusal');
  assert.equal(r.o.costCents, 2);
  mode = 'ok';
  rmSync(b.dir, { recursive: true, force: true });
});

test('the lock: a live lock refuses, a lock older than ten minutes is cleared; a bad --loopback is refused', async () => {
  const b = box(); hits = []; mode = 'ok';
  mkdirSync(b.api, { recursive: true });
  const lock = join(b.api, 'ledger.lock');
  writeFileSync(lock, '');
  const busy = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(busy.o.code, 'busy');
  assert.equal(busy.ledger, '');
  const old = (Date.now() - 11 * 60000) / 1000;
  utimesSync(lock, old, old);
  const go = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(go.o.ok, true);
  assert.equal(existsSync(lock), false);
  const bad = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT }, ['--loopback', 'nope']);
  assert.equal(bad.o.code, 'args');
  // test mode never touches the real key or the real ledger: the real key can only ever go to Anthropic's API
  hits = [];
  const realKey = await ask(b, { job: 'teacher', evidence: GOOD, prompt: PROMPT }, [], join(homedir(), '.si-didy', 'keys', 'anthropic-api.key'));
  assert.equal(realKey.o.code, 'args');
  assert.match(realKey.o.why, /never the real ones/);
  const realDir = await ask({ ...b, api: join(homedir(), '.si-didy', 'api') }, { job: 'teacher', evidence: GOOD, prompt: PROMPT });
  assert.equal(realDir.o.code, 'args');
  assert.equal(hits.length, 0, 'nothing went out');
  rmSync(b.dir, { recursive: true, force: true });
});

#!/usr/bin/env node
// kar-spendwall · tools/ask.mjs — THE WIRE (glue; every decision is src/wall.mjs). One request in, as JSON on stdin:
//   { "job": "teacher", "evidence": { tier1, tier2 }, "system": "...", "prompt": "..." }
// one answer out, as one JSON line on stdout:
//   { ok, code, why, text, seq, model, costCents, ceilingCents, brief }
// In this order: hold the ledger's lock; read Simon's settings and the ledger; ask the law BEFORE anything goes out;
// append what it says and fsync; only on a reservation, read the key and make ONE request (no retries); append the
// settlement and fsync. The key is read here and nowhere else. It is sent only to https://api.anthropic.com (or, for
// this repository's own test, to 127.0.0.1 with --loopback PORT) and never printed, logged or saved. Every ANTHROPIC_*
// variable is removed from this process before the client exists, so no profile, token or endpoint in the environment
// can take part.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import W from '../src/wall.mjs';

for (const k of Object.keys(process.env)) if (k.toUpperCase().startsWith('ANTHROPIC_')) delete process.env[k];

// Two modes. For real: the ledger and the key are at their fixed places and the request goes to Anthropic; nothing in
// the environment can move them, so no variable can start a fresh, empty ledger or point the key somewhere else.
// For this repository's own test (--loopback PORT): the request goes to 127.0.0.1, the ledger and a FAKE key come from
// KAR_SPENDWALL_DIR and KAR_SPENDWALL_KEYFILE, and the real key file is refused, so the real key never leaves for a port.
const HOME = homedir();
const REAL_DIR = join(HOME, '.si-didy', 'api'), REAL_KEY = join(HOME, '.si-didy', 'keys', 'anthropic-api.key');
const LOOP = process.argv.indexOf('--loopback');
const endpoint = (() => {
  if (LOOP < 0) return 'https://api.anthropic.com';
  const port = Number(process.argv[LOOP + 1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? 'http://127.0.0.1:' + port : null;
})();
const DIR = LOOP < 0 ? REAL_DIR : process.env.KAR_SPENDWALL_DIR || '';
const KEYFILE = LOOP < 0 ? REAL_KEY : process.env.KAR_SPENDWALL_KEYFILE || '';
const LEDGER = join(DIR, 'ledger.jsonl'), SETTINGS = join(DIR, 'settings.json'), LOCK = join(DIR, 'ledger.lock');
const PRICES = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8'));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const rd = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const ledger = () => {
  let text = '';
  try { text = readFileSync(LEDGER, 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
};
const append = (e) => {
  const fd = openSync(LEDGER, 'a');
  try { writeSync(fd, JSON.stringify(e) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
};
// a lock older than ten minutes belongs to a process that died mid-call: its reservation is already on disk
const lock = () => {
  try { return openSync(LOCK, 'wx'); } catch {}
  try { if (Date.now() - statSync(LOCK).mtimeMs > 600000) { unlinkSync(LOCK); return openSync(LOCK, 'wx'); } } catch {}
  return null;
};
const scrub = (s, key) => (key ? String(s).split(key).join('[the key]') : String(s)).replace(W.KEY_SHAPE, '[a key]');

async function main() {
  if (endpoint === null) { out({ ok: false, code: 'args', why: '--loopback needs a port' }); process.exitCode = 2; return; }
  if (LOOP >= 0 && (!DIR || !KEYFILE || same(KEYFILE, REAL_KEY) || same(DIR, REAL_DIR))) {
    out({ ok: false, code: 'args', why: '--loopback is for the test: it needs its own ledger folder and a fake key, never the real ones' });
    process.exitCode = 2; return;
  }
  mkdirSync(DIR, { recursive: true });
  let req = null;
  try { req = JSON.parse(readFileSync(0, 'utf8')); } catch {}
  const fd = lock();
  if (fd === null) { out({ ok: false, code: 'busy', why: 'another call holds the ledger' }); process.exitCode = 1; return; }
  try {
    const settings = rd(SETTINGS, {});
    const prompt = req && typeof req.prompt === 'string' ? req.prompt : '';
    const system = req && typeof req.system === 'string' ? req.system : '';
    const at = new Date().toISOString();
    const p = W.plan(ledger(), { job: req && req.job, evidence: req && req.evidence, bytes: prompt ? W.bytesOf([system, prompt]) : null }, settings, PRICES, at, existsSync(KEYFILE));
    append(p.entry);
    if (!p.ok) {
      out({ ok: false, code: p.entry.code, why: p.entry.why + (p.entry.code === 'key' ? ' (Simon puts it in ' + KEYFILE + ')' : ''), seq: p.entry.seq, brief: W.brief(ledger(), settings, at) });
      return;
    }
    let key = '', reply = null, text = '', err = '';
    try {
      key = readFileSync(KEYFILE, 'utf8').trim();
      const client = new Anthropic({ apiKey: key, baseURL: endpoint, maxRetries: 0, timeout: 240000 });
      reply = await client.messages.create({
        model: p.cfg.model, max_tokens: p.cfg.maxTokens, output_config: { effort: p.cfg.effort },
        ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }],
      });
      for (const b of Array.isArray(reply && reply.content) ? reply.content : []) if (b && b.type === 'text') text += b.text;
    } catch (e) { err = scrub((e && e.message) || e, key).slice(0, 300); }
    const s = W.settle(p.entry, reply, PRICES, new Date().toISOString());
    append(err ? { ...s, error: err } : s);
    out({ ok: !err && reply !== null && reply.stop_reason !== 'refusal', code: err ? 'error' : s.stop, why: err, text, seq: s.seq, model: p.cfg.model, costCents: s.costCents, ceilingCents: p.entry.ceilingCents, brief: W.brief(ledger(), settings, s.at) });
  } finally {
    closeSync(fd);
    try { unlinkSync(LOCK); } catch {}
  }
}

main().catch((e) => { out({ ok: false, code: 'crash', why: String((e && e.message) || e).replace(W.KEY_SHAPE, '[a key]').slice(0, 300) }); process.exitCode = 1; });

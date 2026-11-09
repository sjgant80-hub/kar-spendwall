// The law, hand-worked. Every number below is worked by hand from data/prices.json (Opus 5.5: $4 in, $20 out, $5 cache
// write, $0.20 cache read per million tokens = 4000, 20000, 5000, 200 nano-dollars per token; 1 cent = 10,000,000).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import W, { DEFAULTS, EFFORTS, config, rate, cents, tokens, costCents, ceiling, bytesOf, dayOf, replay, isOff, check, escalate, plan, settle, brief, toTally, findSecrets } from '../src/wall.mjs';
import { verifyLedger } from '../vendor/kar-tally/kernel.mjs';

const PRICES = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8'));
const R = rate(PRICES, 'claude-opus-5-5');
const GOOD = { tier1: { asked: true, answered: false }, tier2: { tried: 2, passed: 0 } };
const AT = '2026-11-09T03:10:00.000Z';

test('the sealed settings', () => {
  assert.deepEqual({ ...DEFAULTS }, { dayCents: 250, stopCents: 9500, creditCents: 10000, model: 'claude-opus-5-5', effort: 'medium', maxTokens: 6000, frame: 256, perNight: 6 });
  assert.ok(Object.isFrozen(DEFAULTS) && Object.isFrozen(EFFORTS));
  assert.deepEqual([...EFFORTS], ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(W.NANO_PER_CENT, 10000000);
  assert.equal(PRICES.read, '2026-11-09');
  assert.deepEqual(PRICES.models['claude-opus-5-5'], { in: 4, out: 20, write: 5, read: 0.2 });
});

test('config: the defaults, Simon\'s overrides, and every setting that makes no sense refused', () => {
  assert.deepEqual(config(undefined), { ok: true, cfg: { ...DEFAULTS }, why: '' });
  assert.deepEqual(config([1, 2]).cfg, { ...DEFAULTS });
  assert.equal(config({ dayCents: 300 }).cfg.dayCents, 300);
  const ok = (o) => config(o).ok, why = (o) => config(o).why;
  assert.equal(ok({ dayCents: 1 }), true);
  assert.equal(ok({ dayCents: 0 }), false);
  assert.equal(ok({ dayCents: 2.5 }), false);
  assert.match(why({ dayCents: '250' }), /daily cap/);
  assert.equal(ok({ stopCents: 250 }), true);
  assert.equal(ok({ stopCents: 249 }), false);
  assert.match(why({ stopCents: 9.5 }), /stop must be/);
  assert.equal(ok({ creditCents: 9500 }), true);
  assert.equal(ok({ creditCents: 9499 }), false);
  assert.match(why({ creditCents: 'lots' }), /above the credit/);
  assert.equal(ok({ maxTokens: 1 }), true);
  assert.equal(ok({ maxTokens: 128000 }), true);
  assert.equal(ok({ maxTokens: 0 }), false);
  assert.equal(ok({ maxTokens: 128001 }), false);
  assert.match(why({ maxTokens: 1.5 }), /output limit/);
  assert.equal(ok({ frame: 0 }), true);
  assert.match(why({ frame: -1 }), /framing/);
  assert.equal(ok({ perNight: 0 }), true);
  assert.match(why({ perNight: -1 }), /calls a night/);
  for (const e of EFFORTS) assert.equal(ok({ effort: e }), true);
  assert.match(why({ effort: 'huge' }), /effort must be one of low, medium/);
  assert.match(why({ model: '' }), /model must be named/);
  assert.equal(ok({ model: 5 }), false);
  assert.equal(config({ dayCents: 0 }).cfg, null);
});

test('rate: printed dollars per million tokens become whole nano-dollars per token; the wall never guesses', () => {
  assert.deepEqual(R, { in: 4000, out: 20000, write: 5000, read: 200 });
  assert.deepEqual(rate(PRICES, 'claude-sonnet-5-5'), { in: 2000, out: 10000, write: 2500, read: 100 });
  assert.equal(rate(PRICES, 'claude-haiku-5-5'), null);
  assert.equal(rate(null, 'claude-opus-5-5'), null);
  assert.equal(rate({ models: [] }, 'x'), null);
  const m = (p) => rate({ models: { x: { in: 1, out: 1, write: 1, read: 1, ...p } } }, 'x');
  assert.deepEqual(m({ read: 0 }), { in: 1000, out: 1000, write: 1000, read: 0 });
  assert.equal(m({ read: -0.1 }), null);
  assert.equal(m({ out: NaN }), null);
  assert.equal(m({ write: Infinity }), null);
  assert.equal(m({ in: '4' }), null);
  assert.equal(rate({ models: { x: 4 } }, 'x'), null);
});

test('cents: always rounded up, never down', () => {
  assert.equal(cents(0), 0);
  assert.equal(cents(1), 1);
  assert.equal(cents(10000000), 1);
  assert.equal(cents(10000001), 2);
  assert.equal(cents(20000000), 2);
});

test('tokens: the four counts from a usage block, or nothing if any is unreadable', () => {
  assert.deepEqual(tokens({ input_tokens: 812, output_tokens: 431, cache_creation_input_tokens: 7, cache_read_input_tokens: 9 }), { in: 812, out: 431, write: 7, read: 9 });
  assert.deepEqual(tokens({ input_tokens: 1, output_tokens: 2 }), { in: 1, out: 2, write: 0, read: 0 });
  assert.deepEqual(tokens({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: null, cache_read_input_tokens: null }), { in: 1, out: 2, write: 0, read: 0 });
  const u = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 };
  assert.equal(tokens({ ...u, input_tokens: -1 }), null);
  assert.equal(tokens({ ...u, output_tokens: 1.5 }), null);
  assert.equal(tokens({ ...u, cache_creation_input_tokens: '3' }), null);
  assert.equal(tokens({ ...u, cache_read_input_tokens: -2 }), null);
  assert.equal(tokens(null), null);
  assert.equal(tokens([u]), null);
});

test('costCents: each kind of token at its own price, summed, rounded up', () => {
  const t = (o) => ({ in: 0, out: 0, write: 0, read: 0, ...o });
  assert.equal(costCents(R, t({})), 0);
  assert.equal(costCents(R, t({ in: 2500 })), 1);
  assert.equal(costCents(R, t({ in: 2501 })), 2);
  assert.equal(costCents(R, t({ write: 2000 })), 1);
  assert.equal(costCents(R, t({ write: 2001 })), 2);
  assert.equal(costCents(R, t({ read: 50000 })), 1);
  assert.equal(costCents(R, t({ read: 50001 })), 2);
  assert.equal(costCents(R, t({ out: 500 })), 1);
  assert.equal(costCents(R, t({ out: 501 })), 2);
  assert.equal(costCents(R, t({ in: 2500, write: 2000, read: 50000, out: 500 })), 4);
  // the wire's own test call: 812 in, 431 out = 3,248,000 + 8,620,000 nano-dollars = 2 cents
  assert.equal(costCents(R, t({ in: 812, out: 431 })), 2);
});

test('ceiling: every byte a token at the dearer input price, the framing allowance, the whole output limit', () => {
  const cfg = (o) => ({ ...DEFAULTS, ...o });
  // 0 bytes + 256 framing at $5 (write is dearer than $4 in) = 1,280,000 nano-dollars → 1 cent
  assert.equal(ceiling(R, 0, cfg({ maxTokens: 0 })), 1);
  assert.equal(ceiling(R, 0, cfg({ maxTokens: 0, frame: 0 })), 0);
  // 500 output tokens at $20 = 10,000,000 → 1 cent; one more → 2
  assert.equal(ceiling(R, 0, cfg({ maxTokens: 500, frame: 0 })), 1);
  assert.equal(ceiling(R, 0, cfg({ maxTokens: 501, frame: 0 })), 2);
  // the dearer of in and write, whichever it is
  assert.equal(ceiling({ in: 6000, write: 5000, out: 0, read: 0 }, 10000, cfg({ maxTokens: 0, frame: 0 })), 6);
  assert.equal(ceiling({ in: 4000, write: 5000, out: 0, read: 0 }, 10000, cfg({ maxTokens: 0, frame: 0 })), 5);
  // the defaults on a 3,000-byte prompt: 3,256 × 5,000 + 6,000 × 20,000 = 136,280,000 → 14 cents
  assert.equal(ceiling(R, 3000, cfg({})), 14);
});

test('bytesOf: UTF-8 bytes, strings only', () => {
  assert.equal(bytesOf('abc'), 3);
  assert.equal(bytesOf('é'), 2);
  assert.equal(bytesOf(['ab', 'é']), 4);
  assert.equal(bytesOf(['a', 5, null]), 1);
  assert.equal(bytesOf(''), 0);
  assert.equal(bytesOf(undefined), 0);
});

test('dayOf: the UTC day of a time', () => {
  assert.equal(dayOf('2026-11-09T23:30:00+01:00'), '2026-11-09');
  assert.equal(dayOf('2026-11-09T23:30:00-02:00'), '2026-11-10');
  assert.equal(dayOf('nonsense'), null);
  assert.equal(dayOf(5), null);
});

const res = (seq, ceilingCents, o = {}) => ({ seq, at: AT, day: '2026-11-09', kind: 'reserve', job: 'teacher', ceilingCents, ...o });
const set = (seq, costCents, o = {}) => ({ seq, at: AT, kind: 'settle', costCents, ...o });

test('replay: a call counts at its ceiling until it is settled, then at what it cost; garbage is counted, not thrown on', () => {
  const s = replay([
    res(1, 14), set(1, 3),
    res(2, 14),
    { seq: 3, kind: 'refuse', code: 'day', stopCents: 9500 },
    null, { seq: 0 }, { seq: 1.5 }, { seq: 4, kind: 'other' },
    res(5, 14, { day: '2026-11-10' }),
    res(1, 9),
    set(6, 2), set(1, 1), set(2, -1),
    res(7, 10, { job: '' }), res(8, 10, { job: 7 }), set(7, 10),
  ]);
  assert.equal(s.total, 3 + 14 + 10 + 10);
  assert.deepEqual(s.days, { '2026-11-09': 37 });
  assert.deepEqual(s.jobs, { teacher: 17, '?': 20 });
  assert.equal(s.calls, 4);
  assert.equal(s.settled, 2);
  assert.equal(s.refused, 1);
  assert.equal(s.skipped, 9);
  assert.equal(s.last, 8);
  assert.equal(s.overruns, 0);
  assert.deepEqual(s.open, [2, 8]);
  assert.equal(s.offAt, null);
  assert.deepEqual(s.charges, [{ seq: 1, job: 'teacher', day: '2026-11-09', cents: 3 }, { seq: 2, job: 'teacher', day: '2026-11-09', cents: 14 },
    { seq: 7, job: '?', day: '2026-11-09', cents: 10 }, { seq: 8, job: '?', day: '2026-11-09', cents: 10 }]);
  assert.equal(replay([res(1, 14), set(1, 15)]).overruns, 1);
  assert.equal(replay([res(1, 14), set(1, 15)]).total, 15);
  assert.equal(replay([res(1, 14), set(1, 14)]).overruns, 0);
  assert.deepEqual(replay('nope'), replay([]));
  assert.equal(replay([]).last, 0);
  // a seq that is not a whole number is garbage, whatever kind it claims to be: it neither counts nor moves the numbering
  assert.equal(replay([res(1.5, 14)]).calls, 0);
  assert.equal(replay([res(1.5, 14)]).total, 0);
  assert.equal(replay([res(1, 14), { seq: 99.5 }]).last, 1);
  assert.equal(replay([res(1, 14), { seq: 'z' }]).last, 1);
  assert.equal(plan([res(1, 14), { seq: 99.5, kind: 'refuse' }], { job: 'teacher', evidence: GOOD, bytes: 10 }, {}, PRICES, AT, true).entry.seq, 2);
});

test('replay: a refusal at the stop latches the tier off, at the highest stop it was refused at', () => {
  assert.equal(replay([{ seq: 1, kind: 'refuse', code: 'stop', stopCents: 9500 }]).offAt, 9500);
  assert.equal(replay([{ seq: 1, kind: 'refuse', code: 'stop', stopCents: 9500 }, { seq: 2, kind: 'refuse', code: 'off', stopCents: 9700 }, { seq: 3, kind: 'refuse', code: 'stop', stopCents: 9600 }]).offAt, 9700);
  assert.equal(replay([{ seq: 1, kind: 'refuse', code: 'off', stopCents: 9400 }]).offAt, 9400);
  assert.equal(replay([{ seq: 1, kind: 'refuse', code: 'stop' }]).offAt, null);
  assert.equal(replay([{ seq: 1, kind: 'refuse', code: 'day', stopCents: 9500 }]).offAt, null);
});

test('isOff and check: the stop first, then today\'s cap; exactly reaching a limit is allowed, passing it is not', () => {
  const cfg = { ...DEFAULTS };
  const st = (total, today, offAt = null) => ({ total, days: { '2026-11-09': today }, offAt });
  assert.equal(isOff(st(9500, 0), cfg), true);
  assert.equal(isOff(st(9499, 0), cfg), false);
  assert.equal(isOff(st(0, 0, 9500), cfg), true);
  assert.equal(isOff(st(0, 0, 9499), cfg), false);
  assert.equal(isOff(st(0, 0, null), cfg), false);
  assert.deepEqual(check(st(0, 236), '2026-11-09', 14, cfg), { ok: true, code: 'ok', why: '' });
  assert.equal(check(st(0, 237), '2026-11-09', 14, cfg).code, 'day');
  assert.match(check(st(0, 237), '2026-11-09', 14, cfg).why, /^API budget reached for today \(\$2\.50\)/);
  assert.equal(check(st(0, 0), '2026-11-10', 250, cfg).ok, true);
  assert.equal(check(st(9486, 0), '2026-11-09', 14, cfg).ok, true);
  assert.equal(check(st(9487, 0), '2026-11-09', 14, cfg).code, 'stop');
  assert.match(check(st(9487, 0), '2026-11-09', 14, cfg).why, /past Kar's stop at \$95\.00/);
  assert.equal(check(st(9487, 240), '2026-11-09', 14, cfg).code, 'stop');
  assert.equal(check(st(9500, 0), '2026-11-09', 1, cfg).code, 'off');
  assert.equal(check(st(10, 0, 9500), '2026-11-09', 1, cfg).code, 'off');
  assert.equal(check(st(1234, 0, 9500), '2026-11-09', 1, cfg).why, 'the API tier is off: $12.34 of the $100.00 credit is spent and Kar stops at $95.00, until Simon raises the stop');
  assert.equal(check(st(10, 0, 9500), '2026-11-09', 1, { ...cfg, stopCents: 9600 }).ok, true);
});

test('escalate (K1): only when tier 1 was asked and had no answer, and tier 2 tried with nothing passing', () => {
  assert.deepEqual(escalate(GOOD), { ok: true, why: '' });
  assert.equal(escalate({ tier1: { asked: true, answered: false }, tier2: { tried: 1, passed: 0 } }).ok, true);
  assert.match(escalate(null).why, /no evidence/);
  assert.equal(escalate({ tier1: GOOD.tier1 }).ok, false);
  assert.equal(escalate({ tier2: GOOD.tier2 }).ok, false);
  assert.match(escalate({ ...GOOD, tier1: { asked: 'yes', answered: false } }).why, /tier 1/);
  assert.equal(escalate({ ...GOOD, tier1: { asked: true, answered: true } }).ok, false);
  assert.equal(escalate({ ...GOOD, tier1: { asked: true } }).ok, false);
  assert.match(escalate({ ...GOOD, tier2: { tried: 0, passed: 0 } }).why, /tier 2/);
  assert.equal(escalate({ ...GOOD, tier2: { tried: 1.5, passed: 0 } }).ok, false);
  assert.equal(escalate({ ...GOOD, tier2: { tried: 3, passed: 1 } }).ok, false);
  assert.equal(escalate({ ...GOOD, tier2: { tried: 3 } }).ok, false);
});

test('plan: a reservation of the whole ceiling before anything goes out, or a refusal that says why', () => {
  const req = { job: 'teacher', evidence: GOOD, bytes: 3000 };
  const p = plan([res(4, 9)], req, {}, PRICES, AT, true);
  assert.equal(p.ok, true);
  assert.deepEqual(p.entry, { seq: 5, at: AT, day: '2026-11-09', job: 'teacher', spentToday: 9, spentTotal: 9, kind: 'reserve', model: 'claude-opus-5-5', effort: 'medium', maxTokens: 6000, bytes: 3000, ceilingCents: 14, dayCents: 250, stopCents: 9500, evidence: GOOD });
  assert.equal(plan([], req, { dayCents: 300, stopCents: 9000 }, PRICES, AT, true).entry.dayCents, 300);
  assert.equal(plan([], req, { dayCents: 300, stopCents: 9000 }, PRICES, AT, true).entry.stopCents, 9000);
  assert.equal(p.cfg.dayCents, 250);
  const no = (entries, r, s, at, key) => plan(entries, r, s, PRICES, at, key).entry;
  assert.deepEqual(no([], req, {}, 'never', true), { seq: 1, at: 'never', day: null, job: 'teacher', spentToday: 0, spentTotal: 0, kind: 'refuse', code: 'clock', why: 'no readable time for this call', stopCents: 9500 });
  const c = no([], req, { dayCents: 0 }, AT, true);
  assert.equal(c.code, 'config');
  assert.equal(c.stopCents, 9500);
  assert.match(c.why, /^the settings are refused: the daily cap/);
  assert.equal(no([], req, {}, AT, false).code, 'key');
  assert.equal(no([], req, {}, AT, 'yes').code, 'key');
  assert.equal(no([], req, { model: 'claude-haiku-5-5' }, AT, true).code, 'price');
  assert.equal(no([], { ...req, bytes: null }, {}, AT, true).code, 'size');
  assert.equal(no([], { ...req, bytes: -1 }, {}, AT, true).code, 'size');
  assert.equal(no([], null, {}, AT, true).code, 'size');
  assert.equal(no([], null, {}, AT, true).job, '?');
  assert.equal(no([], { ...req, job: '' }, {}, AT, true).job, '?');
  assert.equal(no([], { ...req, evidence: { ...GOOD, tier2: { tried: 0, passed: 0 } } }, {}, AT, true).code, 'tier');
  assert.equal(no([res(1, 237)], req, {}, AT, true).code, 'day');
  assert.equal(no([res(1, 237)], req, {}, AT, true).spentToday, 237);
  assert.equal(no([res(1, 236)], req, {}, AT, true).kind, 'reserve');
  const stop = no([res(1, 9487, { day: '2026-11-08', at: '2026-11-08T03:00:00Z' })], req, {}, AT, true);
  assert.equal(stop.code, 'stop');
  assert.equal(stop.stopCents, 9500);
  assert.equal(stop.spentToday, 0);
  assert.equal(no([{ seq: 1, kind: 'refuse', code: 'stop', stopCents: 9500 }], { ...req, bytes: 0 }, {}, AT, true).code, 'off');
  assert.equal(no([{ seq: 1, kind: 'refuse', code: 'stop', stopCents: 9500 }], req, { stopCents: 9600 }, AT, true).kind, 'reserve');
  assert.equal(no([], req, { stopCents: 9600 }, AT, false).stopCents, 9600);
});

test('settle: priced from the usage the API reported; anything unreadable is charged the whole ceiling', () => {
  const r = { seq: 5, job: 'teacher', model: 'claude-opus-5-5', ceilingCents: 14 };
  const reply = { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 812, output_tokens: 431 } };
  assert.deepEqual(settle(r, reply, PRICES, AT), { seq: 5, at: AT, kind: 'settle', job: 'teacher', model: 'claude-opus-5-5', tokens: { in: 812, out: 431, write: 0, read: 0 }, costCents: 2, priced: true, overrun: false, stop: 'end_turn' });
  const none = settle(r, null, PRICES, AT);
  assert.equal(none.costCents, 14);
  assert.equal(none.priced, false);
  assert.equal(none.stop, 'no reply');
  assert.equal(none.tokens, null);
  assert.equal(settle(r, { ...reply, usage: { input_tokens: 'x' } }, PRICES, AT).costCents, 14);
  assert.equal(settle(r, { ...reply, model: 'claude-sonnet-5-5' }, PRICES, AT).costCents, 14);
  assert.equal(settle({ ...r, model: 'nope' }, { ...reply, model: 'nope' }, PRICES, AT).costCents, 14);
  assert.equal(settle(r, { ...reply, stop_reason: 5 }, PRICES, AT).stop, 'no reply');
  assert.equal(settle(r, { ...reply, stop_reason: 'refusal' }, PRICES, AT).stop, 'refusal');
  const big = settle(r, { ...reply, usage: { input_tokens: 0, output_tokens: 7001 } }, PRICES, AT);
  assert.equal(big.costCents, 15);
  assert.equal(big.overrun, true);
  assert.equal(settle(r, { ...reply, usage: { input_tokens: 0, output_tokens: 7000 } }, PRICES, AT).overrun, false);
});

test('brief: the morning line, from the ledger alone', () => {
  const L = [res(1, 14), set(1, 3), res(2, 14), { seq: 3, kind: 'refuse', code: 'day', stopCents: 9500 }, res(4, 10, { job: 'cold-read' }), set(4, 2)];
  assert.equal(brief(L, {}, AT), 'API tier: today $0.19 of $2.50 · $0.19 of the $100.00 credit spent, $94.81 left before Kar stops at $95.00 · 3 calls, 1 refused · by job: cold-read $0.02, teacher $0.17 · 1 unsettled, counted at the ceiling');
  assert.equal(brief(L, {}, '2026-11-10T08:00:00Z').startsWith('API tier: today $0.00 of $2.50'), true);
  assert.equal(brief(L, {}, 'never').startsWith('API tier: today $0.00'), true);
  assert.equal(brief([], {}, AT), 'API tier: today $0.00 of $2.50 · $0.00 of the $100.00 credit spent, $95.00 left before Kar stops at $95.00 · 0 calls, 0 refused');
  assert.equal(brief([res(1, 9500)], {}, AT), 'API tier OFF: $95.00 of the $100.00 credit is spent (Kar stops at $95.00); Kar runs on the free tiers until Simon raises the stop · 1 calls, 0 refused · by job: teacher $95.00 · 1 unsettled, counted at the ceiling');
  assert.match(brief([{ seq: 1, kind: 'refuse', code: 'stop', stopCents: 9500 }], {}, AT), /^API tier OFF: \$0\.00/);
  assert.match(brief([res(1, 14), set(1, 15)], {}, AT), / · 1 OVERRUN$/);
  assert.equal(brief([], { dayCents: 0 }, AT), 'API tier: the settings are refused (the daily cap must be a whole number of cents, at least 1), so no call can be made');
});

test('toTally (K4): kar-tally\'s own kernel re-adds the ledger to the same total, and catches a wrong balance', async () => {
  const L = [res(1, 14), set(1, 3), { seq: 2, kind: 'refuse', code: 'tier' }, res(3, 14), set(3, 13), res(4, 14)];
  const t = toTally(L, {});
  assert.deepEqual(t, { cap: 95, startSeq: 1, entries: [
    { seq: 1, actor: 'kar', action: 'api:teacher#1', cost: 0.03, balance: 94.97 },
    { seq: 2, actor: 'kar', action: 'api:teacher#3', cost: 0.13, balance: 94.84 },
    { seq: 3, actor: 'kar', action: 'api:teacher#4', cost: 0.14, balance: 94.7 }] });
  const a = verifyLedger(t.cap, t.startSeq, t.entries);
  assert.equal(a.verdict, 'PASS');
  assert.equal(Math.round(a.totalSpent * 100), replay(L).total);
  const bad = structuredClone(t); bad.entries[1].balance = 94.9;
  assert.equal(verifyLedger(bad.cap, bad.startSeq, bad.entries).verdict, 'FAIL');
  assert.equal(toTally(L, { dayCents: 0 }).cap, 95);
  assert.equal(toTally(L, { stopCents: 9000 }).cap, 90);
  assert.deepEqual(toTally([res(9, 5), res(3, 7)], {}).entries.map((e) => e.action), ['api:teacher#3', 'api:teacher#9']);
});

test('findSecrets (K6): counts strings shaped like an Anthropic key', () => {
  const fake = ['sk', 'ant', 'api03'].join('-') + '-' + 'Ab9_'.repeat(6);
  assert.equal(findSecrets('x ' + fake + ' y'), 1);
  assert.equal(findSecrets(fake + '\n' + fake), 2);
  assert.equal(findSecrets('the key starts sk-ant- and is long'), 0);
  assert.equal(findSecrets(null), 0);
});

test('the default export carries every part', () => {
  for (const k of ['DEFAULTS', 'EFFORTS', 'NANO_PER_CENT', 'KEY_SHAPE', 'config', 'rate', 'cents', 'tokens', 'costCents', 'ceiling', 'bytesOf', 'dayOf', 'replay', 'isOff', 'check', 'escalate', 'plan', 'settle', 'brief', 'toTally', 'findSecrets'])
    assert.ok(k in W, k);
});

test('fuzz: the law never throws on garbage from outside', () => {
  const junk = [undefined, null, 0, -1, 1.5, NaN, '', 'x', [], [null], {}, { seq: 'a' }, { kind: 'reserve', seq: 1 }, { models: {} }, () => 1, Symbol.iterator];
  const reserve = { seq: 1, job: 'teacher', model: 'claude-opus-5-5', ceilingCents: 14 };
  for (const a of junk) for (const b of junk) {
    config(a); rate(a, b); tokens(a); bytesOf(a); dayOf(a); replay(a); replay([a, b]); escalate(a); findSecrets(a);
    plan(a, b, a, b, a, b); plan([a], { job: a, evidence: b, bytes: a }, {}, PRICES, AT, true);
    settle(reserve, a, b, AT); settle(reserve, { usage: a, model: b }, PRICES, AT);
    brief(a, b, a); brief([a, b], {}, AT); toTally(a, b); toTally([a, b], {});
  }
});

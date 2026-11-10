// The real-ledger audit: every claim's bar, and every way a ledger can break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import A, { audit } from '../src/audit.mjs';
import S from '../src/sim.mjs';
import { verifyLedger } from '../vendor/kar-tally/kernel.mjs';

const PRICES = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8'));
const GOOD = { tier1: { asked: true, answered: false }, tier2: { tried: 2, passed: 0 } };
const at = (d, h = 3) => '2026-11-' + d + 'T0' + h + ':00:00.000Z';
const res = (seq, cents, o = {}) => ({ seq, at: at(10), day: '2026-11-10', kind: 'reserve', job: 'teacher', ceilingCents: cents, dayCents: 250, stopCents: 9500, evidence: GOOD, ...o });
const set = (seq, cents) => ({ seq, at: at(10, 4), kind: 'settle', costCents: cents });
const rows = (L) => Object.fromEntries(audit(L, verifyLedger).rows.map((r) => [r.id, r]));
const pass = (L) => Object.fromEntries(audit(L, verifyLedger).rows.map((r) => [r.id, r.pass]));

test('an empty ledger and an honest one pass every row', () => {
  // nothing to judge is not a pass: with no call yet, the rows are undecided
  assert.deepEqual(pass([]), { K1: null, K2: null, K3: null, K4: null, O: null });
  assert.deepEqual(rows([]).K1.measured, 'no call yet');
  const refusalsOnly = audit([{ seq: 1, kind: 'refuse', code: 'key', job: 'teacher' }, { seq: 2, kind: 'refuse', code: 'key', job: 'teacher' }], verifyLedger);
  assert.deepEqual(refusalsOnly.rows.map((r) => [r.id, r.pass]), [['K1', null], ['K2', null], ['K3', null], ['K4', true], ['O', null]]);
  assert.equal(pass([null, 'junk']).K4, false, 'a ledger of nothing but garbage is not empty: K4 fails it');
  assert.equal(pass([{ seq: 1, kind: 'refuse', code: 'key' }, { seq: 3, kind: 'refuse', code: 'key' }]).K4, false, 'a gap among refusals fails too');
  const a = audit([res(1, 14), set(1, 3), { seq: 2, kind: 'refuse', code: 'day', stopCents: 9500 }, res(3, 14)], verifyLedger);
  assert.equal(a.calls, 2);
  assert.equal(a.refused, 1);
  assert.equal(a.totalCents, 17);
  assert.deepEqual(a.rows.map((r) => r.id), ['K1', 'K2', 'K3', 'K4', 'O']);
  assert.ok(a.rows.every((r) => r.pass));
  assert.deepEqual(a.rows.map((r) => r.measured), ['0 of 2 calls without the evidence', 'no day over its cap, 0 settled before reserved',
    '$0.17 charged, the stop $95.00, 0 calls after a refusal at the stop', 'kar-tally PASS, $0.17 re-added of $0.17, 0 unreadable lines', '0 overruns; no answered call yet to check the one-token-per-byte bound on']);
  const sim = S.run({ prices: PRICES, days: 45 });
  assert.ok(audit(sim.ledger, verifyLedger).rows.every((r) => r.pass), 'the simulated ledger passes the real audit too');
});

test('K1: a call without the evidence', () => {
  assert.equal(pass([res(1, 14, { evidence: null })]).K1, false);
  assert.equal(rows([res(1, 14, { evidence: null }), res(2, 14)]).K1.measured, '1 of 2 calls without the evidence');
});

test('K2: a day over the cap in force, or a settlement before its reservation', () => {
  assert.equal(pass([res(1, 200), res(2, 50)]).K2, true);
  assert.equal(pass([res(1, 200), res(2, 51)]).K2, false);
  assert.equal(rows([res(1, 200), res(2, 51)]).K2.measured, 'over the cap on 2026-11-10, 0 settled before reserved');
  assert.equal(pass([res(1, 200), res(2, 100, { dayCents: 300 })]).K2, true, 'Simon raised the cap that day');
  assert.equal(pass([res(1, 260, { dayCents: 'x' })]).K2, false);
  assert.equal(pass([set(1, 3), res(1, 14)]).K2, false);
  assert.equal(rows([set(1, 3), res(1, 14)]).K2.measured, 'no day over its cap, 1 settled before reserved');
  assert.equal(pass([res(1, 14), set(1, 3)]).K2, true);
  assert.equal(pass([res(1, 200), res(2, 51, { day: '2026-11-11', at: at(11) })]).K2, true);
});

test('K3: over the stop in force, or a call after a refusal at the stop unless the stop was raised since', () => {
  assert.equal(pass([res(1, 9500)]).K3, true);
  assert.equal(pass([res(1, 9501)]).K3, false);
  assert.equal(pass([res(1, 9501, { stopCents: 9600 })]).K3, true);
  const off = { seq: 2, kind: 'refuse', code: 'stop', stopCents: 9500 };
  assert.equal(pass([res(1, 10), off, res(3, 10)]).K3, false);
  assert.equal(rows([res(1, 10), off, res(3, 10)]).K3.measured, '$0.20 charged, the stop $95.00, 1 calls after a refusal at the stop');
  assert.equal(pass([res(1, 10), { ...off, code: 'off' }, res(3, 10)]).K3, false);
  assert.equal(pass([res(1, 10), off, res(3, 10, { stopCents: 9600 })]).K3, true);
  assert.equal(pass([res(1, 10), off, res(3, 10, { stopCents: 'x' })]).K3, false);
  assert.equal(pass([res(1, 10), { ...off, stopCents: 9400 }, { ...off, seq: 3, stopCents: 9300 }, res(4, 10, { stopCents: 9450 })]).K3, true);
  assert.equal(pass([res(1, 10), { ...off, stopCents: 9400 }, { ...off, seq: 3, stopCents: 9300 }, res(4, 10, { stopCents: 9400 })]).K3, false);
  assert.equal(pass([res(1, 10), { ...off, stopCents: null }, res(3, 10)]).K3, true);
  assert.equal(pass([res(1, 10), { ...off, code: 'day' }, res(3, 10)]).K3, true);
  assert.equal(pass([res(1, 10), { ...off, stopCents: 0 }, res(3, 10, { stopCents: 1 })]).K3, true);
});

test('K4 and O: an unreadable line, an overrun; kar-tally re-adds past a raised stop', () => {
  assert.equal(pass([res(1, 14), null]).K4, false);
  assert.equal(rows([res(1, 14), 'junk']).K4.measured, 'kar-tally PASS, $0.14 re-added of $0.14, 1 unreadable lines');
  assert.equal(pass([res(1, 14), set(1, 15)]).O, false);
  assert.equal(rows([res(1, 14), set(1, 15)]).O.measured, '1 overruns; no answered call yet to check the one-token-per-byte bound on');
  // the one assumption under the ceiling, checked on every answered call: input tokens never more than bytes + 256
  const tok = (n, frame) => [res(1, 14, { bytes: 100, ...(frame === undefined ? {} : { frame }) }), { ...set(1, 3), tokens: { in: n, out: 1, write: 0, read: 0 } }];
  assert.equal(pass(tok(356)).O, true);
  assert.equal(rows(tok(356)).O.measured, '0 overruns; 0 of 1 answered calls read more input tokens than bytes plus the allowance (the ceiling assumes none do)');
  assert.equal(pass(tok(357)).O, false);
  assert.equal(pass(tok(110, 10)).O, true, 'the allowance the call was reserved under is the one checked');
  assert.equal(pass(tok(111, 10)).O, false);
  assert.equal(pass([res(1, 14, { bytes: 100 }), { ...set(1, 3), tokens: { in: 300, out: 1, write: 50, read: 7 } }]).O, false, 'cache tokens count as input too');
  // a call with a size but no answer yet, or an answer but no size, is not an answered call to check the bound on
  assert.equal(rows([res(1, 14, { bytes: 100 })]).O.measured, '0 overruns; no answered call yet to check the one-token-per-byte bound on');
  assert.equal(pass([res(1, 14), { ...set(1, 3), tokens: { in: 900, out: 1, write: 0, read: 0 } }]).O, true);
  assert.equal(rows(tok(357)).O.measured, '0 overruns; 1 of 1 answered calls read more input tokens than bytes plus the allowance (the ceiling assumes none do)');
  // a line deleted from the ledger is a gap in the numbering, and kar-tally fails it
  assert.equal(pass([res(1, 14), { seq: 2, kind: 'refuse', code: 'day', stopCents: 9500 }, res(3, 14)]).K4, true);
  assert.equal(pass([res(1, 14), res(3, 14)]).K4, false);
  assert.match(rows([res(1, 14), res(3, 14)]).K4.measured, /^kar-tally FAIL/);
  const big = [res(1, 9000, { stopCents: 20000 }), res(2, 9000, { stopCents: 20000, day: '2026-11-11', at: at(11) })];
  assert.equal(pass(big).K4, true, 'kar-tally is given the stop in force as its cap');
  assert.equal(pass([res(1, 100, { stopCents: 'x' })]).K4, true);
  assert.equal(audit('nope', verifyLedger).calls, 0);
  assert.ok('audit' in A);
});

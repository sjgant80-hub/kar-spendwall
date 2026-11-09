// The proof harness: the simulated sixty days, pinned, and every verdict shown able to fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import S, { rng, run, measure, verdicts } from '../src/sim.mjs';
import W from '../src/wall.mjs';
import { verifyLedger } from '../vendor/kar-tally/kernel.mjs';

const PRICES = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url), 'utf8'));
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
// the sixty days are run once and shared: each run replays the ledger before every one of its thousands of requests
const SIM = run({ prices: PRICES }), M = measure(SIM, {}, verifyLedger);

test('rng: mulberry32, the estate\'s seeded generator', () => {
  const r = rng(2026), a = [r(), r(), r()], again = rng(2026);
  assert.deepEqual([again(), again(), again()], a);
  assert.equal(rng(1)(), 0.6270739405881613);
  assert.equal(rng(2026)(), 0.45540769933722913);
  assert.ok(a.every((x) => x >= 0 && x < 1));
  assert.notEqual(rng(7)(), rng(8)());
});

test('run: the simulated ledger is the same every time (pinned)', () => {
  const sim = SIM;
  assert.equal(sim.days.length, 60);
  assert.equal(sim.days[0].day, '2026-11-10');
  assert.equal(sim.days[59].day, '2027-01-08');
  assert.equal(sha(sim), '8d2f8eb5812872507b1ebd5df6430756e3b211bb63b968994d96771c2f4b370a');
  assert.equal(sha(run({ prices: PRICES, days: 3, seed: 5, settings: { dayCents: 100 } })), '87144e2450d130c997e267375b8481cb5ccdb729b9add042fce11a1cc83cd9a4');
  assert.ok(sim.ledger.every((e) => W.dayOf(e.at) !== null));
  assert.ok(sim.ledger.filter((e) => e.kind === 'reserve').every((e) => e.day === W.dayOf(e.at)));
  const s = W.replay(sim.ledger);
  assert.ok(s.open.length > 0, 'some calls never settle, as if the process died');
  assert.ok(sim.ledger.some((e) => e.kind === 'settle' && e.stop === 'no reply'), 'some answers come back unreadable');
  assert.ok(sim.days.every((d) => d.requests >= 50 && d.requests <= 80 && d.asked + d.noEvidence === d.requests));
});

test('measure + verdicts: every claim the simulation decides holds on the pinned run', () => {
  const m = M;
  const v = verdicts(m);
  assert.deepEqual(v.map((x) => x.id), ['K1', 'K2', 'K3', 'K4', 'O']);
  for (const x of v) assert.equal(x.pass, true, x.id + ' ' + x.what);
  assert.equal(sha(m), 'ed2b9bd17b76cc352951101c5705b28c861a865250ad6eeaec3f0146a746b41b');
  assert.ok(m.k2.refusedForDay > 0 && m.k3.refusedForStop > 0 && m.k1.requestsWithoutEvidence > 0);
  assert.equal(m.k3.callsAfterOff, 0);
  assert.equal(m.k4.tally, 'PASS');
});

test('verdicts: each one fails when its measurement is wrong', () => {
  const m = M;
  const fails = (id, edit) => { const c = structuredClone(m); edit(c); return verdicts(c).find((x) => x.id === id).pass === false; };
  assert.ok(fails('K1', (c) => { c.k1.requestsWithoutEvidence = 0; c.k1.refusedForTier = 0; }));
  assert.ok(fails('K1', (c) => { c.k1.reachedTheApi = 1; }));
  assert.ok(fails('K1', (c) => { c.k1.refusedForTier -= 1; }));
  assert.ok(fails('K2', (c) => { c.k2.dearestDayCents = c.k2.capCents + 1; }));
  assert.ok(!fails('K2', (c) => { c.k2.dearestDayCents = c.k2.capCents; }));
  assert.ok(fails('K2', (c) => { c.k2.cheapestDemandCents = 2 * c.k2.capCents - 1; }));
  assert.ok(!fails('K2', (c) => { c.k2.cheapestDemandCents = 2 * c.k2.capCents; }));
  assert.ok(fails('K2', (c) => { c.k2.refusedForDay = 0; }));
  assert.ok(fails('K2', (c) => { c.k2.settledBeforeReserved = 1; }));
  assert.ok(fails('K3', (c) => { c.k3.totalCents = c.k3.stopCents + 1; }));
  assert.ok(!fails('K3', (c) => { c.k3.totalCents = c.k3.stopCents; }));
  assert.ok(fails('K3', (c) => { c.k3.refusedForStop = 0; }));
  assert.ok(fails('K3', (c) => { c.k3.callsAfterOff = 1; }));
  assert.ok(fails('K4', (c) => { c.k4.skipped = 1; }));
  assert.ok(fails('K4', (c) => { c.k4.tally = 'FAIL'; }));
  assert.ok(fails('K4', (c) => { c.k4.tallyTotalCents += 1; }));
  assert.ok(fails('K4', (c) => { c.k4.calls += 1; }));
  assert.ok(fails('O', (c) => { c.o.overruns = 1; }));
});

test('measure reads the ledger, not the plan: an overrun, a settle before its reservation and a call after the stop all show', () => {
  const at = (h) => '2026-11-10T0' + h + ':00:00.000Z';
  const L = [
    { seq: 1, at: at(1), day: '2026-11-10', kind: 'reserve', job: 'teacher', ceilingCents: 10, evidence: { tier1: { asked: true, answered: false }, tier2: { tried: 1, passed: 0 } } },
    { seq: 1, at: at(1), kind: 'settle', costCents: 12 },
    { seq: 3, at: at(2), kind: 'settle', costCents: 1 },
    { seq: 2, at: at(2), day: '2026-11-10', kind: 'refuse', code: 'stop', stopCents: 9500 },
    { seq: 3, at: at(3), day: '2026-11-10', kind: 'reserve', job: 'teacher', ceilingCents: 10, evidence: null },
  ];
  const m = measure({ ledger: L, days: [{ day: '2026-11-10', requests: 3, asked: 2, noEvidence: 1, demandCents: 30 }] }, {}, verifyLedger);
  assert.equal(m.o.overruns, 1);
  assert.equal(m.k2.settledBeforeReserved, 1);
  assert.equal(m.k3.callsAfterOff, 1);
  assert.equal(m.k3.firstOffDay, '2026-11-10');
  assert.equal(m.k1.reachedTheApi, 1);
  assert.equal(m.k2.dearestDayCents, 22);
  assert.equal(m.k2.cheapestDemandCents, 30);
  assert.equal(m.days[0].calls, 2);
  assert.equal(m.days[0].refusedStop, 1);
  assert.equal(m.k4.skipped, 1);
  // the stop refused on the very first line: everything after it counts, and the day is read from that first line
  const first = measure({ ledger: [L[3], { ...L[4], seq: 5 }], days: [{ day: '2026-11-10', requests: 2, asked: 1, noEvidence: 1, demandCents: 10 }] }, {}, verifyLedger);
  assert.equal(first.k3.callsAfterOff, 1);
  assert.equal(first.k3.firstOffDay, '2026-11-10');
  const quiet = measure({ ledger: [L[0]], days: [{ day: '2026-11-10', requests: 1, asked: 1, noEvidence: 0, demandCents: 10 }] }, {}, verifyLedger);
  assert.equal(quiet.k3.firstOffDay, null);
  assert.equal(quiet.k3.callsAfterOff, 0);
  assert.equal(quiet.k4.unsettled, 1);
  assert.ok('rng' in S && 'run' in S && 'measure' in S && 'verdicts' in S);
});

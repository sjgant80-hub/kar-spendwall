// kar-spendwall · src/sim.mjs — THE PROOF HARNESS (pure; the page runs the same file in the browser). Sixty simulated
// days of demand well above the cap go through the law exactly as the wire would send them: plan before every request,
// append what plan says, settle after with usage a real API could report (never more input tokens than bytes, never
// more output than the limit). Some requests carry no evidence that the cheaper tiers were tried (K1); some calls never
// settle, as if the process died mid-call (the reservation must stand); some answers come back unreadable (charged the
// ceiling). The measurements are read back from the ledger alone, then the ledger is handed to kar-tally's own kernel.
import W from './wall.mjs';

/** rng(seed) → mulberry32, the estate's usual seeded generator. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// thresholds are whole percentages, so every boundary is a real case a test can see (r() never lands on 0.85 exactly)
const pct = (r) => Math.floor(r() * 100);
const GOOD = (r) => ({ tier1: { asked: true, answered: false }, tier2: { tried: 1 + Math.floor(r() * 5), passed: 0 } });
const BAD = [
  () => null,
  () => ({ tier1: { asked: true, answered: true }, tier2: { tried: 3, passed: 0 } }),
  () => ({ tier1: { asked: false, answered: false }, tier2: { tried: 3, passed: 0 } }),
  () => ({ tier1: { asked: true, answered: false }, tier2: { tried: 0, passed: 0 } }),
  () => ({ tier1: { asked: true, answered: false }, tier2: { tried: 4, passed: 1 } }),
];

/** run({ days, seed, settings, prices, start }) → { ledger, days: [...] }: the simulated ledger and each day's demand. */
export function run({ days = 60, seed = 2026, settings = {}, prices, start = '2026-11-10' } = {}) {
  const r = rng(seed), cfg = W.config(settings).cfg, rate = W.rate(prices, cfg ? cfg.model : '');
  const ledger = [], perDay = [];
  const t0 = Date.parse(start + 'T00:00:00Z');
  for (let d = 0; d < days; d++) {
    const n = 50 + Math.floor(r() * 31);
    let demand = 0, asked = 0, noEvidence = 0;
    for (let i = 0; i < n; i++) {
      const at = new Date(t0 + d * 86400000 + Math.floor(((i + r()) / n) * 86399000)).toISOString();
      const bytes = 1500 + Math.floor(r() * 6500);
      const good = pct(r) < 85;
      const evidence = good ? GOOD(r) : BAD[Math.floor(r() * BAD.length)]();
      if (good && rate && cfg) demand += W.ceiling(rate, bytes, cfg);
      if (good) asked++; else noEvidence++;
      const p = W.plan(ledger, { job: 'teacher', evidence, bytes }, settings, prices, at, true);
      ledger.push(p.entry);
      if (!p.ok) continue;
      const fate = pct(r);
      if (fate < 2) continue;
      const done = new Date(Date.parse(at) + 500).toISOString();
      const reply = fate < 4 ? null : {
        model: cfg.model, stop_reason: 'end_turn',
        usage: { input_tokens: Math.floor(bytes / (2.5 + r() * 2)), output_tokens: Math.floor(r() * (cfg.maxTokens + 1)), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
      ledger.push(W.settle(p.entry, reply, prices, done));
    }
    perDay.push({ day: new Date(t0 + d * 86400000).toISOString().slice(0, 10), requests: n, asked, noEvidence, demandCents: demand });
  }
  return { ledger, days: perDay };
}

/** measure(sim, settings, tally) → every claim the simulation can decide, read back from the ledger alone.
 *  tally = kar-tally's verifyLedger, injected so this file stays free of the auditor it is audited by. */
export function measure(sim, settings, tally) {
  const cfg = W.config(settings).cfg, L = sim.ledger, s = W.replay(L);
  const byDay = sim.days.map((x) => {
    const mine = L.filter((e) => e.day === x.day);
    const refused = (code) => mine.filter((e) => e.kind === 'refuse' && e.code === code).length;
    return { ...x, spentCents: s.days[x.day] || 0, calls: mine.filter((e) => e.kind === 'reserve').length, refusedDay: refused('day'), refusedTier: refused('tier'), refusedStop: refused('stop') + refused('off') };
  });
  const firstOff = L.findIndex((e) => e.kind === 'refuse' && (e.code === 'stop' || e.code === 'off'));
  const callsAfterOff = firstOff < 0 ? 0 : L.slice(firstOff).filter((e) => e.kind === 'reserve').length;
  const reserved = new Set();
  let settleBeforeReserve = 0;
  for (const e of L) {
    if (e.kind === 'reserve') reserved.add(e.seq);
    if (e.kind === 'settle' && !reserved.has(e.seq)) settleBeforeReserve++;
  }
  const noEvidenceCalled = L.filter((e) => e.kind === 'reserve' && !W.escalate(e.evidence).ok).length;
  const t = W.toTally(L, settings), audit = tally(t.cap, t.startSeq, t.entries);
  const maxDay = Math.max(...byDay.map((x) => x.spentCents));
  const minDemand = Math.min(...byDay.map((x) => x.demandCents));
  return {
    days: byDay,
    k1: { requestsWithoutEvidence: byDay.reduce((n, x) => n + x.noEvidence, 0), refusedForTier: byDay.reduce((n, x) => n + x.refusedTier, 0), reachedTheApi: noEvidenceCalled },
    k2: { capCents: cfg.dayCents, dearestDayCents: maxDay, cheapestDemandCents: minDemand, refusedForDay: byDay.reduce((n, x) => n + x.refusedDay, 0), settledBeforeReserved: settleBeforeReserve },
    k3: { stopCents: cfg.stopCents, totalCents: s.total, refusedForStop: byDay.reduce((n, x) => n + x.refusedStop, 0), firstOffDay: firstOff < 0 ? null : L[firstOff].day, callsAfterOff },
    k4: { entries: L.length, calls: s.calls, settled: s.settled, unsettled: s.open.length, refused: s.refused, skipped: s.skipped, tally: audit.verdict, tallyViolations: audit.violations.length, tallyTotalCents: Math.round(audit.totalSpent * 100), wallTotalCents: s.total },
    o: { overruns: s.overruns },
    brief: W.brief(L, settings, L[L.length - 1].at),
  };
}

/** verdicts(m) → each claim the simulation decides, held or FAILED, from the measurements alone. */
export function verdicts(m) {
  return [
    { id: 'K1', what: 'no request without evidence reaches the API', pass: m.k1.requestsWithoutEvidence > 0 && m.k1.reachedTheApi === 0 && m.k1.refusedForTier === m.k1.requestsWithoutEvidence },
    { id: 'K2', what: 'no day over the cap, the cap really bit, and nothing settled before it was reserved', pass: m.k2.dearestDayCents <= m.k2.capCents && m.k2.cheapestDemandCents >= 2 * m.k2.capCents && m.k2.refusedForDay > 0 && m.k2.settledBeforeReserved === 0 },
    { id: 'K3', what: 'the total stays under the stop, and nothing is called once the tier is off', pass: m.k3.totalCents <= m.k3.stopCents && m.k3.refusedForStop > 0 && m.k3.callsAfterOff === 0 },
    { id: 'K4', what: 'every attempt is in the ledger and kar-tally re-adds it to the same total', pass: m.k4.skipped === 0 && m.k4.tally === 'PASS' && m.k4.tallyTotalCents === m.k4.wallTotalCents && m.k4.calls === m.k4.settled + m.k4.unsettled },
    { id: 'O', what: 'no call cost more than its ceiling', pass: m.o.overruns === 0 },
  ];
}

export default { rng, run, measure, verdicts };

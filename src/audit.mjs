// kar-spendwall · src/audit.mjs — THE REAL LEDGER, judged by the claims' own bars (pure). The simulation proves the
// law; this judges what actually happened, every morning, from ~/.si-didy/api/ledger.jsonl alone. Each reservation
// carries the daily cap and the stop that were in force when it was made, so raising either later is judged fairly.
//   K1  every call carried the evidence that the cheaper tiers were tried and failed
//   K2  no UTC day's charged spend above the highest cap in force on that day; nothing settled before it was reserved
//   K3  the total never above the stop in force; no call after a refusal at the stop, unless the stop was raised since
//   K4  nothing unreadable in the ledger, and kar-tally (injected) re-adds the calls to the same total
//   O   no call cost more than its ceiling
import W from './wall.mjs';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const usd = (c) => '$' + (c / 100).toFixed(2);

/** audit(entries, tally) → { calls, refused, totalCents, rows: [{ id, pass, measured }] }. */
export function audit(entries, tally) {
  const L = (Array.isArray(entries) ? entries : []).filter(isObj), s = W.replay(entries);
  const reserves = L.filter((e) => e.kind === 'reserve');
  const noEvidence = reserves.filter((e) => !W.escalate(e.evidence).ok).length;
  const caps = {};
  for (const e of reserves) caps[e.day] = Math.max(caps[e.day] || 0, Number.isInteger(e.dayCents) ? e.dayCents : 0);
  const overDays = Object.keys(s.days).filter((d) => s.days[d] > (caps[d] || 0)).sort();
  const seen = new Set();
  let early = 0;
  for (const e of L) {
    if (e.kind === 'reserve') seen.add(e.seq);
    if (e.kind === 'settle' && !seen.has(e.seq)) early++;
  }
  const stopNow = reserves.reduce((m, e) => Math.max(m, Number.isInteger(e.stopCents) ? e.stopCents : 0), 0);
  let offAt = null, afterOff = 0;
  for (const e of L) {
    if (e.kind === 'refuse' && (e.code === 'stop' || e.code === 'off') && Number.isInteger(e.stopCents)) offAt = Math.max(offAt === null ? 0 : offAt, e.stopCents);
    if (e.kind === 'reserve' && offAt !== null && !(Number.isInteger(e.stopCents) && e.stopCents > offAt)) afterOff++;
  }
  const cap = Math.max(stopNow, W.DEFAULTS.dayCents), t = W.toTally(L, { stopCents: cap, creditCents: cap });
  const a = t.entries.length ? tally(t.cap, t.startSeq, t.entries) : { verdict: 'PASS', violations: [], totalSpent: 0 };
  const tallied = Math.round(a.totalSpent * 100);
  const sized = s.charges.filter((c) => c.bytes !== null && c.tokensIn !== null);
  const over = sized.filter((c) => c.tokensIn > c.bytes + W.DEFAULTS.frame).length;
  return {
    calls: s.calls, refused: s.refused, totalCents: s.total,
    rows: [
      { id: 'K1', pass: noEvidence === 0, measured: noEvidence + ' of ' + s.calls + ' calls without the evidence' },
      { id: 'K2', pass: overDays.length === 0 && early === 0, measured: (overDays.length ? 'over the cap on ' + overDays.join(', ') : 'no day over its cap') + ', ' + early + ' settled before reserved' },
      { id: 'K3', pass: s.total <= stopNow && afterOff === 0, measured: usd(s.total) + ' charged, the stop ' + usd(stopNow) + ', ' + afterOff + ' calls after a refusal at the stop' },
      { id: 'K4', pass: s.skipped === 0 && a.verdict === 'PASS' && tallied === s.total, measured: 'kar-tally ' + a.verdict + ', ' + usd(tallied) + ' re-added of ' + usd(s.total) + ', ' + s.skipped + ' unreadable lines' },
      { id: 'O', pass: s.overruns === 0 && over === 0, measured: s.overruns + ' overruns; ' + (sized.length ? over + ' of ' + sized.length + ' answered calls read more input tokens than bytes plus the allowance (the ceiling assumes none do)' : 'no answered call yet to check the one-token-per-byte bound on') },
    ],
  };
}

export default { audit };

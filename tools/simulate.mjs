#!/usr/bin/env node
// kar-spendwall · tools/simulate.mjs — writes data/sim.json: sixty simulated days through the law (src/sim.mjs), the
// claims they decide (K1, K2, K3, K4, O), and the real-ledger audit (src/audit.mjs) run over the same ledger.
// `--check` re-derives it byte for byte (R, in CI). Spends nothing: no request goes anywhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import S from '../src/sim.mjs';
import A from '../src/audit.mjs';
import W from '../src/wall.mjs';
import { verifyLedger } from '../vendor/kar-tally/kernel.mjs';

const ROOT = new URL('../', import.meta.url);
const prices = JSON.parse(readFileSync(new URL('data/prices.json', ROOT), 'utf8'));
const settings = {}, seed = 2026, days = 60, start = '2026-11-10';
const sim = S.run({ prices, settings, seed, days, start });
const m = S.measure(sim, settings, verifyLedger);
const text = sim.ledger.map((e) => JSON.stringify(e)).join('\n') + '\n';
const out = JSON.stringify({
  what: 'Sixty simulated days of demand well above the cap, sent through the law exactly as the wire sends a real request: plan before every request, settle after. Nothing was spent.',
  settings: W.config(settings).cfg, prices: { source: prices.source, read: prices.read }, seed, days, start,
  ledger: { entries: sim.ledger.length, sha256: createHash('sha256').update(text).digest('hex') },
  measured: m, verdicts: S.verdicts(m), audit: A.audit(sim.ledger, verifyLedger),
}, null, 1) + '\n';
const file = new URL('data/sim.json', ROOT);
if (process.argv.includes('--check')) {
  const same = readFileSync(file, 'utf8') === out;
  console.log(same ? 'SIMULATION REPRODUCED' : 'SIMULATION DIFFERS');
  process.exit(same ? 0 : 1);
}
writeFileSync(file, out);
for (const v of S.verdicts(m)) console.log((v.pass ? '  held   ' : '  FAILED ') + v.id + ' · ' + v.what);
console.log('  ' + m.brief);

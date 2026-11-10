#!/usr/bin/env node
// kar-spendwall · tools/audit.mjs — the real ledger (~/.si-didy/api/ledger.jsonl, or a path given), judged by the claims'
// own bars and re-added by kar-tally, plus the morning line. Local only: it reads one file and prints.
//   node tools/audit.mjs [ledger.jsonl] [--json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import A from '../src/audit.mjs';
import W from '../src/wall.mjs';
import { verifyLedger } from '../vendor/kar-tally/kernel.mjs';

const DIR = process.env.KAR_SPENDWALL_DIR || join(homedir(), '.si-didy', 'api');
const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(DIR, 'ledger.jsonl');
let L = [];
try { L = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }); } catch {}
let settings = {};
try { settings = JSON.parse(readFileSync(join(DIR, 'settings.json'), 'utf8')); } catch {}
const a = A.audit(L, verifyLedger), line = W.brief(L, settings, new Date().toISOString());
// --write: the receipt the page shows (data/real.json): counts, totals and each row's verdict; never a prompt, an
// answer, the evidence or the key, which the ledger keeps on this machine only
if (process.argv.includes('--write')) {
  const out = { at: new Date().toISOString().slice(0, 10), present: existsSync(file), calls: a.calls, refused: a.refused, totalCents: a.totalCents, rows: a.rows };
  writeFileSync(new URL('../data/real.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ file, brief: line, ...a }));
else {
  console.log(line);
  for (const r of a.rows) console.log((r.pass ? '  held   ' : '  FAILED ') + r.id + ' · ' + r.measured);
}
process.exitCode = a.rows.every((r) => r.pass) ? 0 : 1;

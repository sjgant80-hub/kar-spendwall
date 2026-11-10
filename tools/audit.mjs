#!/usr/bin/env node
// kar-spendwall · tools/audit.mjs — the real ledger (~/.si-didy/api/ledger.jsonl, or a path given), judged by the claims'
// own bars and re-added by kar-tally, plus the morning line. Local only: it reads files and prints.
//   node tools/audit.mjs [ledger.jsonl] [--json] [--write]
// --write is run by hand and its receipt committed by hand: data/real.json is only as fresh as the date it carries.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import A from '../src/audit.mjs';
import W from '../src/wall.mjs';
import { verifyLedger } from '../vendor/kar-tally/kernel.mjs';

// the same fixed places the wire uses, under the home folder the operating system reports (not HOME / USERPROFILE)
const HOME = userInfo().homedir;
const DIR = join(HOME, '.si-didy', 'api'), KEY = join(HOME, '.si-didy', 'keys', 'anthropic-api.key');
const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(DIR, 'ledger.jsonl');
let L = [];
try { L = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }); } catch {}
let settings = {};
try { settings = JSON.parse(readFileSync(join(DIR, 'settings.json'), 'utf8')); } catch {}
const a = A.audit(L, verifyLedger), line = W.brief(L, settings, new Date().toISOString());
// --write: the receipt the page shows (data/real.json): whether a ledger and a key file exist, counts, totals and each
// row's verdict; never a prompt, an answer, the evidence or the key itself, which stay on this machine only
if (process.argv.includes('--write')) {
  const out = { at: new Date().toISOString().slice(0, 10), present: existsSync(file), keyInstalled: existsSync(KEY), calls: a.calls, refused: a.refused, totalCents: a.totalCents, rows: a.rows };
  writeFileSync(new URL('../data/real.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
}
const word = (p) => (p === true ? '  held      ' : p === false ? '  FAILED    ' : '  undecided ');
if (process.argv.includes('--json')) console.log(JSON.stringify({ file, brief: line, ...a }));
else {
  console.log(line);
  for (const r of a.rows) console.log(word(r.pass) + r.id + ' · ' + r.measured);
}
// only a row that failed fails the run; an undecided row (no call yet) is not a failure, and not a pass either
process.exitCode = a.rows.some((r) => r.pass === false) ? 1 : 0;

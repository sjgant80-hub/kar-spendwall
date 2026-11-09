#!/usr/bin/env node
// kar-spendwall · tools/receipts.mjs — writes data/proofs.json, the receipts the page shows for K5, K6 and C:
//   wire     test/wire.test.mjs (the wire end to end against a stand-in API, a fake key, decoy credentials)
//   scan     tools/scan.mjs's count of key-shaped strings in the tracked files
//   teacher  si-didy/patlib-teach.test.mjs, run on Kar's machine (si-didy is not a repository, so CI cannot run it:
//            the receipt says where and when it ran, and is kept as it is wherever si-didy is absent)
// `--check` (CI) re-runs the wire test and the scan and fails if either differs from the committed receipt.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import W from '../src/wall.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILE = new URL('../data/proofs.json', import.meta.url);
const TEACH = 'C:/Users/sjgan/si-didy/patlib-teach.test.mjs';
const count = (out, what) => Number((String(out).match(new RegExp('^# ' + what + ' (\\d+)$', 'm')) || [])[1] ?? NaN);
const run = (file, cwd) => {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { cwd, encoding: 'utf8', timeout: 600000 });
  return { tests: count(r.stdout, 'tests'), pass: count(r.stdout, 'pass') };
};
const scan = () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  return { files: files.length, hits: files.reduce((n, f) => n + W.findSecrets(readFileSync(ROOT + f, 'latin1')), 0) };
};
const day = new Date().toISOString().slice(0, 10);
const old = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const wire = { file: 'test/wire.test.mjs', ...run('test/wire.test.mjs', ROOT), ran: day, where: 'this repository; CI re-runs it on every push' };
const sc = { ...scan(), ran: day, where: 'every tracked file; CI re-runs it on every push' };
if (process.argv.includes('--check')) {
  const same = old.wire && old.wire.tests === wire.tests && old.wire.pass === wire.pass && old.scan && old.scan.hits === sc.hits && wire.pass === wire.tests && sc.hits === 0;
  console.log(same ? 'RECEIPTS REPRODUCED: wire ' + wire.pass + '/' + wire.tests + ', ' + sc.hits + ' key-shaped strings' : 'RECEIPTS DIFFER: wire ' + wire.pass + '/' + wire.tests + ', ' + sc.hits + ' key-shaped strings');
  process.exit(same ? 0 : 1);
}
const teacher = existsSync(TEACH)
  ? { file: 'si-didy/patlib-teach.test.mjs', ...run(TEACH, 'C:/Users/sjgan/si-didy'), ran: day, where: 'Kar\'s machine' }
  : old.teacher || null;
const out = { wire, scan: sc, teacher };
writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out));

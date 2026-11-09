#!/usr/bin/env node
// kar-spendwall · tools/scan.mjs — K6 in CI: no tracked file holds a string shaped like an Anthropic key. The live page
// is served from these same tracked files, so this covers it too. Exits 1 on any hit, naming the file, never the string.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import W from '../src/wall.mjs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
let hits = 0;
for (const f of files) {
  const n = W.findSecrets(readFileSync(f, 'latin1'));
  if (n) { console.error('::error::' + f + ' holds ' + n + ' string(s) shaped like an Anthropic key'); hits += n; }
}
console.log(hits ? 'KEY-SHAPED STRINGS FOUND: ' + hits : 'no key-shaped string in ' + files.length + ' tracked files');
process.exit(hits ? 1 : 0);

// The one job's law: which families may go to the API tonight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import T, { FRESH_HOURS, labelOf, evidenceFor, pick } from '../src/teach.mjs';

const AT = '2026-11-09T03:00:00.000Z';
const night = (o = {}) => ({
  kind: 'pattern-night', at: AT, dry: false, model: 'qwen2.5:7b', targets: ['gtm', 'showcase', 'factory', 'kar-body'],
  dropped: [
    { rule: 'copy=>gtm', source: '7b', why: 'held-out: covers 1, needs 5' },
    { rule: 'fall+line=>gtm', source: '7b', why: 'held-out: right 0 of 10, needs 0.8' },
    { rule: 'site=>gtm', source: 'mined', why: 'held-out: covers 2, needs 5' },
    { rule: 'quine=>showcase', source: '7b', why: 'held-out: covers 0, needs 5' },
    { rule: 'kar=>kar-body', source: '7b', why: 'held-out: right 2 of 7, needs 0.8' },
  ],
  promoted: [{ rule: 'kernel=>kar-body', source: '7b', receipt: 'abc' }],
  ...o,
});

test('labelOf: the label a rule key names', () => {
  assert.equal(labelOf('copy=>gtm'), 'gtm');
  assert.equal(labelOf('fall+line=>gtm'), 'gtm');
  assert.equal(labelOf('=>gtm'), 'gtm');
  assert.equal(labelOf('a=>b=>c'), 'c');
  assert.equal(labelOf('a=>'), null);
  assert.equal(labelOf('no label'), null);
  assert.equal(labelOf(7), null);
  assert.equal(FRESH_HOURS, 12);
});

test('evidenceFor: what tier 1 and tier 2 did about one family tonight', () => {
  assert.deepEqual(evidenceFor('gtm', night(), []), {
    tier1: { asked: true, answered: false, what: 'the pattern library has no rule for gtm' },
    tier2: { tried: 2, passed: 0, model: 'qwen2.5:7b', dropped: ['copy=>gtm: held-out: covers 1, needs 5', 'fall+line=>gtm: held-out: right 0 of 10, needs 0.8'] },
  });
  const kb = evidenceFor('kar-body', night(), [{ when: ['firms'], then: 'verticals' }]);
  assert.equal(kb.tier1.answered, false);
  assert.equal(kb.tier2.tried, 2);
  assert.equal(kb.tier2.passed, 1);
  const lib = evidenceFor('gtm', night(), [{ when: ['x'], then: 'gtm' }, null]);
  assert.equal(lib.tier1.answered, true);
  assert.equal(lib.tier1.what, 'the pattern library has a rule for gtm');
  const many = night({ dropped: Array.from({ length: 7 }, (_, i) => ({ rule: 't' + i + '=>gtm', source: '7b', why: 'w' })) });
  assert.equal(evidenceFor('gtm', many, []).tier2.tried, 7);
  assert.equal(evidenceFor('gtm', many, []).tier2.dropped.length, 5);
  assert.equal(evidenceFor('gtm', night({ model: 7 }), []).tier2.model, null);
  assert.deepEqual(evidenceFor('gtm', null, null).tier2, { tried: 0, passed: 0, model: null, dropped: [] });
  assert.equal(evidenceFor('gtm', night({ dropped: 'x', promoted: [null] }), []).tier2.tried, 0);
});

test('pick: only families the library could not answer and the 7B failed tonight, in the night\'s order, at most perNight', () => {
  const p = pick(night(), [], 6, '2026-11-09T03:30:00Z');
  assert.equal(p.ok, true);
  assert.equal(p.why, '');
  assert.deepEqual(p.picks.map((x) => x.label), ['gtm', 'showcase']);
  assert.deepEqual(p.picks[0].evidence, evidenceFor('gtm', night(), []));
  assert.deepEqual(pick(night(), [], 1, AT).picks.map((x) => x.label), ['gtm']);
  assert.deepEqual(pick(night(), [], 0, AT).picks, []);
  assert.deepEqual(pick(night(), [{ when: ['x'], then: 'gtm' }], 6, AT).picks.map((x) => x.label), ['showcase']);
  const none = pick(night({ targets: ['factory', 'kar-body'] }), [], 6, AT);
  assert.equal(none.ok, true);
  assert.deepEqual(none.picks, []);
  assert.match(none.why, /^no family qualified/);
  assert.deepEqual(pick(night({ targets: 'gtm' }), [], 6, AT).picks, []);
});

test('pick: a real night from the last twelve hours, or nothing', () => {
  assert.equal(pick(night(), [], 6, '2026-11-09T15:00:00.000Z').ok, true);
  assert.equal(pick(night(), [], 6, '2026-11-09T15:00:00.001Z').ok, false);
  assert.match(pick(night(), [], 6, '2026-11-09T15:00:00.001Z').why, /not from the last 12 hours/);
  assert.equal(pick(night(), [], 6, '2026-11-09T02:59:59.999Z').ok, false);
  assert.equal(pick(night(), [], 6, 'never').ok, false);
  assert.equal(pick(night({ at: 'never' }), [], 6, AT).ok, false);
  assert.match(pick(night({ kind: 'pattern-teach' }), [], 6, AT).why, /no real night/);
  assert.equal(pick(night({ dry: true }), [], 6, AT).ok, false);
  assert.equal(pick(night({ dry: 'yes' }), [], 6, AT).ok, true);
  assert.equal(pick(null, [], 6, AT).ok, false);
  assert.deepEqual(pick(null, [], 6, AT).picks, []);
});

test('the default export carries every part; fuzz never throws', () => {
  for (const k of ['FRESH_HOURS', 'labelOf', 'evidenceFor', 'pick']) assert.ok(k in T, k);
  const junk = [undefined, null, 0, 'x', [], [null], {}, { kind: 'pattern-night' }, { targets: [null, 5], dropped: [{}], promoted: {} }];
  for (const a of junk) for (const b of junk) { labelOf(a); evidenceFor(a, b, a); pick(a, b, 3, AT); pick(night({ targets: a, dropped: b }), a, 3, AT); }
});

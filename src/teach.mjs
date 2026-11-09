// kar-spendwall · src/teach.mjs — THE ONE JOB'S LAW: the pattern library's nightly teacher. Which families may go to the
// API tonight, and with what evidence. Pure: it reads last night's ledger entry and the library, and decides nothing the
// wall has not already ruled on (every pick must pass wall.mjs's escalate, K1). Rule keys are patlib.mjs's own form:
// "token=>label" or "a+b=>label".
import { escalate } from './wall.mjs';

export const FRESH_HOURS = 12;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);

/** labelOf(key) → the label a rule key names, or null. */
export function labelOf(key) {
  if (typeof key !== 'string') return null;
  const i = key.lastIndexOf('=>');
  return i < 0 ? null : key.slice(i + 2) || null;
}

/** evidenceFor(label, night, library) → what tier 1 and tier 2 did about this family. */
export function evidenceFor(label, night, library) {
  const answered = arr(library).some((r) => isObj(r) && r.then === label);
  const mine = (xs) => arr(xs).filter((x) => isObj(x) && x.source === '7b' && labelOf(x.rule) === label);
  const dropped = mine(isObj(night) ? night.dropped : null), passed = mine(isObj(night) ? night.promoted : null);
  return {
    tier1: { asked: true, answered, what: 'the pattern library has ' + (answered ? 'a rule' : 'no rule') + ' for ' + label },
    tier2: { tried: dropped.length + passed.length, passed: passed.length, model: isObj(night) && typeof night.model === 'string' ? night.model : null,
      dropped: dropped.slice(0, 5).map((d) => d.rule + ': ' + d.why) },
  };
}

/** pick(night, library, perNight, now) → { ok, why, picks: [{ label, evidence }] }: at most perNight families, in the
 *  night's own target order, each one the library could not answer and the 7B tried tonight with nothing passing. */
export function pick(night, library, perNight, now) {
  if (!isObj(night) || night.kind !== 'pattern-night' || night.dry === true) return { ok: false, why: 'no real night of the pattern library to learn from', picks: [] };
  const age = Date.parse(now) - Date.parse(night.at);
  if (!Number.isFinite(age) || age < 0 || age > FRESH_HOURS * 3600000) return { ok: false, why: 'the last night of the pattern library is not from the last ' + FRESH_HOURS + ' hours', picks: [] };
  const picks = [];
  for (const label of arr(night.targets)) {
    if (picks.length >= perNight) break;
    const evidence = evidenceFor(label, night, library);
    if (escalate(evidence).ok) picks.push({ label, evidence });
  }
  return { ok: true, why: picks.length ? '' : 'no family qualified: each was answered by the library, or not tried by the 7B tonight', picks };
}

export default { FRESH_HOURS, labelOf, evidenceFor, pick };

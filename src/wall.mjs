// kar-spendwall · src/wall.mjs — THE LAW. Every decision the wall makes is here, and nothing else is: no clock, no disk,
// no network, no key. The wire (tools/ask.mjs) only reads the ledger, asks this law, writes what it says, and makes the
// one request the law allowed. Sealed first: CLAIMS.md (SEAL 1, e530394).
//
//   config   Simon's settings over the defaults; a setting that makes no sense is refused, never repaired
//   rate     a model's printed prices ($ per million tokens) as whole nano-dollars per token
//   ceiling  the most one call can cost, in whole cents, rounded UP: every input byte priced as a token at the dearer
//            input price, plus a framing allowance, plus every output token the limit allows
//   replay   what the ledger proves: spend per UTC day, in total and per job (a call counts at its ceiling until settled)
//   check    the wallet's own canDo, twice: once against today's cap, once against Kar's stop; the stop latches OFF
//   escalate K1: the API only after tier 1 was asked without an answer and tier 2 was tried with nothing passing
//   plan     the entry to append BEFORE a request goes out: a reservation of the whole ceiling, or a refusal and why
//   settle   the entry to append after: the call priced from the usage the API reported, rounded UP to the cent
//   brief    the morning line, from the ledger alone
//   toTally  the ledger in kar-tally's own input form, so an independent auditor re-adds it
import { canDo } from '../vendor/wallet/wallet.mjs';

export const DEFAULTS = Object.freeze({
  dayCents: 250, stopCents: 9500, creditCents: 10000,
  model: 'claude-opus-5-5', effort: 'medium', maxTokens: 6000, frame: 256, perNight: 6,
});
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const NANO_PER_CENT = 10000000;
export const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]{16,}/g;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const nat = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
const money = (c) => '$' + (c / 100).toFixed(2);

/** config(over) → { ok, cfg, why }: the defaults, overlaid by Simon's settings file. */
export function config(over) {
  const cfg = { ...DEFAULTS, ...(isObj(over) ? over : {}) };
  const no = (why) => ({ ok: false, cfg: null, why });
  if (!Number.isInteger(cfg.dayCents) || cfg.dayCents < 1) return no('the daily cap must be a whole number of cents, at least 1');
  if (!Number.isInteger(cfg.stopCents) || cfg.stopCents < cfg.dayCents) return no('the stop must be a whole number of cents, no lower than the daily cap');
  if (!Number.isInteger(cfg.creditCents) || cfg.creditCents < cfg.stopCents) return no('the stop cannot be above the credit');
  if (!Number.isInteger(cfg.maxTokens) || cfg.maxTokens < 1 || cfg.maxTokens > 128000) return no('the output limit must be 1 to 128,000 tokens');
  if (nat(cfg.frame) === null) return no('the framing allowance must be a whole number of tokens');
  if (nat(cfg.perNight) === null) return no('the calls a night must be a whole number');
  if (!EFFORTS.includes(cfg.effort)) return no('effort must be one of ' + EFFORTS.join(', '));
  if (typeof cfg.model !== 'string' || cfg.model.length === 0) return no('a model must be named');
  return { ok: true, cfg, why: '' };
}

/** rate(prices, model) → { in, out, write, read } in nano-dollars per token, or null: the wall never guesses a price. */
export function rate(prices, model) {
  const p = isObj(prices) && isObj(prices.models) ? prices.models[model] : null;
  if (!isObj(p)) return null;
  const r = {};
  for (const k of ['in', 'out', 'write', 'read']) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    r[k] = Math.round(v * 1000);
  }
  return r;
}

/** cents(nano) → whole cents, rounded UP. */
export const cents = (nano) => Math.ceil(nano / NANO_PER_CENT);

/** tokens(usage) → { in, out, write, read } from the API's usage block, or null if any count is unreadable. */
export function tokens(u) {
  if (!isObj(u)) return null;
  const t = { in: nat(u.input_tokens), out: nat(u.output_tokens), write: nat(u.cache_creation_input_tokens ?? 0), read: nat(u.cache_read_input_tokens ?? 0) };
  return t.in === null || t.out === null || t.write === null || t.read === null ? null : t;
}

/** costCents(r, t) → what the API charges for those tokens, rounded UP to the cent. */
export function costCents(r, t) {
  return cents(t.in * r.in + t.write * r.write + t.read * r.read + t.out * r.out);
}

/** ceiling(r, bytes, cfg) → the most the call can cost, in whole cents (a token is never shorter than one byte). */
export function ceiling(r, bytes, cfg) {
  return cents((bytes + cfg.frame) * Math.max(r.in, r.write) + cfg.maxTokens * r.out);
}

/** bytesOf(parts) → the UTF-8 size of the request's text. */
export function bytesOf(parts) {
  let n = 0;
  for (const p of Array.isArray(parts) ? parts : [parts]) if (typeof p === 'string') n += new TextEncoder().encode(p).length;
  return n;
}

/** dayOf(iso) → the UTC day of a time, or null. Remembered per string: replay asks it of every reservation, every time. */
const DAYS = new Map();
export function dayOf(iso) {
  if (typeof iso !== 'string') return null;
  let d = DAYS.get(iso);
  if (d === undefined) {
    const t = Date.parse(iso);
    d = Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
    DAYS.set(iso, d);
  }
  return d;
}

/** replay(entries) → what the ledger proves. Every reservation and every refusal owns one seq; a settlement shares its
 *  reservation's. Garbage lines, and a second line claiming a seq already taken, are counted and skipped, never thrown on.
 *  rows lists every seq the ledger accounts for, in order, so a deleted line shows as a gap. */
export function replay(entries) {
  const s = { days: {}, jobs: {}, total: 0, calls: 0, settled: 0, refused: 0, overruns: 0, skipped: 0, last: 0, open: [], offAt: null, charges: [], rows: [] };
  const res = new Map(), refs = new Map(), offs = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isObj(e) || !Number.isInteger(e.seq) || e.seq < 1) { s.skipped++; continue; }
    s.last = Math.max(s.last, e.seq);
    const taken = res.has(e.seq) || refs.has(e.seq);
    if (e.kind === 'reserve' && nat(e.ceilingCents) !== null && dayOf(e.at) === e.day && !taken) {
      res.set(e.seq, { e, cost: e.ceilingCents, done: false, tokensIn: null });
      s.calls++;
    } else if (e.kind === 'settle' && res.has(e.seq) && !res.get(e.seq).done && nat(e.costCents) !== null) {
      const r = res.get(e.seq);
      r.cost = e.costCents; r.done = true; s.settled++;
      const k = isObj(e.tokens) ? [nat(e.tokens.in), nat(e.tokens.write), nat(e.tokens.read)] : [null];
      r.tokensIn = k.includes(null) ? null : k[0] + k[1] + k[2];
      if (e.costCents > r.e.ceilingCents) s.overruns++;
    } else if (e.kind === 'refuse' && !taken) {
      refs.set(e.seq, { seq: e.seq, kind: 'refused', job: typeof e.job === 'string' && e.job ? e.job : '?', code: typeof e.code === 'string' ? e.code : '?', cents: 0 });
      s.refused++;
      if ((e.code === 'stop' || e.code === 'off') && Number.isInteger(e.stopCents)) offs.push(e.stopCents);
    } else s.skipped++;
  }
  for (const { e, cost, done, tokensIn } of res.values()) {
    const job = typeof e.job === 'string' && e.job ? e.job : '?';
    s.days[e.day] = (s.days[e.day] || 0) + cost;
    s.jobs[job] = (s.jobs[job] || 0) + cost;
    s.total += cost;
    s.charges.push({ seq: e.seq, job, day: e.day, cents: cost, bytes: nat(e.bytes), frame: nat(e.frame), tokensIn });
    s.rows.push({ seq: e.seq, kind: 'call', job, code: done ? 'settled' : 'unsettled', cents: cost });
    if (!done) s.open.push(e.seq);
  }
  for (const r of refs.values()) s.rows.push(r);
  s.rows.sort((a, b) => a.seq - b.seq);
  s.offAt = offs.length ? Math.max(...offs) : null;
  return s;
}

/** isOff(s, cfg) → the stop is reached, or a call was refused at this stop (it latches until the stop is raised). */
export function isOff(s, cfg) {
  return s.total >= cfg.stopCents || (s.offAt !== null && s.offAt >= cfg.stopCents);
}

/** check(s, day, need, cfg) → { ok, code, why }: the wallet's own canDo decides. */
export function check(s, day, need, cfg) {
  const act = { type: 'api', cost: need };
  if (need > cfg.dayCents) return { ok: false, code: 'big', why: 'this one call could cost ' + money(need) + ', more than a whole day\'s cap of ' + money(cfg.dayCents) + ': send a smaller request or a lower output limit' };
  if (isOff(s, cfg)) return { ok: false, code: 'off', why: 'the API tier is off: ' + money(s.total) + ' of the ' + money(cfg.creditCents) + ' credit is spent and the stop is ' + money(cfg.stopCents) + ', until the stop is raised' };
  if (!canDo({ caps: ['api'], budget: { total: cfg.stopCents, spent: s.total } }, act).ok) return { ok: false, code: 'stop', why: 'the API tier is off: this call could take the total past the stop at ' + money(cfg.stopCents) };
  if (!canDo({ caps: ['api'], budget: { total: cfg.dayCents, spent: s.days[day] || 0 } }, act).ok) return { ok: false, code: 'day', why: 'API budget reached for today (' + money(cfg.dayCents) + '): the local tiers carry on, and the API is back tomorrow' };
  return { ok: true, code: 'ok', why: '' };
}

/** cleanEvidence(ev) → the evidence in its known shape only, for the ledger: nothing else a caller sends is kept. */
export function cleanEvidence(ev) {
  const t1 = isObj(ev) && isObj(ev.tier1) ? ev.tier1 : {}, t2 = isObj(ev) && isObj(ev.tier2) ? ev.tier2 : {};
  const cut = (x) => (typeof x === 'string' ? x.slice(0, 200) : null);
  return {
    tier1: { asked: t1.asked === true, answered: t1.answered === true, what: cut(t1.what) },
    tier2: { tried: nat(t2.tried), passed: nat(t2.passed), model: cut(t2.model), dropped: (Array.isArray(t2.dropped) ? t2.dropped : []).filter((d) => typeof d === 'string').slice(0, 5).map(cut) },
  };
}

/** escalate(ev) → K1: may this job leave the free tiers at all? */
export function escalate(ev) {
  if (!isObj(ev) || !isObj(ev.tier1) || !isObj(ev.tier2)) return { ok: false, why: 'no evidence that the cheaper tiers were tried' };
  if (ev.tier1.asked !== true || ev.tier1.answered !== false) return { ok: false, why: 'tier 1 (the tools and the pattern library) was not asked, or it had an answer' };
  if (!Number.isInteger(ev.tier2.tried) || ev.tier2.tried < 1 || ev.tier2.passed !== 0) return { ok: false, why: 'tier 2 (the local 7B) was not tried, or something it wrote passed the gate' };
  return { ok: true, why: '' };
}

/** plan(entries, req, settings, prices, at, haveKey) → { ok, entry, cfg }: what to append BEFORE anything goes out.
 *  req = { job, evidence, bytes }. ok → a reservation of the call's whole ceiling; otherwise a refusal saying why. */
export function plan(entries, req, settings, prices, at, haveKey) {
  const s = replay(entries), seq = s.last + 1, day = dayOf(at);
  const c = config(settings), cfg = c.ok ? c.cfg : DEFAULTS;
  const job = isObj(req) && typeof req.job === 'string' && req.job ? req.job : '?';
  const base = { seq, at, day, job, spentToday: day ? s.days[day] || 0 : 0, spentTotal: s.total };
  const no = (code, why) => ({ ok: false, cfg, entry: { ...base, kind: 'refuse', code, why, stopCents: cfg.stopCents } });
  if (!day) return no('clock', 'no readable time for this call');
  if (!c.ok) return no('config', 'the settings are refused: ' + c.why);
  if (haveKey !== true) return no('key', 'no API key is installed, so the API tier is off');
  const r = rate(prices, cfg.model);
  if (r === null) return no('price', 'no price for ' + cfg.model + ', and the wall will not guess one');
  if (!isObj(req) || nat(req.bytes) === null) return no('size', 'the request has no size, so no ceiling can be set');
  const e = escalate(req.evidence);
  if (!e.ok) return no('tier', e.why);
  const need = ceiling(r, req.bytes, cfg);
  const k = check(s, day, need, cfg);
  if (!k.ok) return no(k.code, k.why);
  return { ok: true, cfg, entry: { ...base, kind: 'reserve', model: cfg.model, effort: cfg.effort, maxTokens: cfg.maxTokens, bytes: req.bytes, ceilingCents: need, frame: cfg.frame, dayCents: cfg.dayCents, stopCents: cfg.stopCents, evidence: cleanEvidence(req.evidence) } };
}

/** settle(reserve, reply, prices, at) → the entry to append once the API answers or fails. A reply with no readable
 *  usage, or from another model, is charged the whole ceiling: a request that went out may have been billed. */
export function settle(reserve, reply, prices, at) {
  const r = rate(prices, reserve.model);
  const t = isObj(reply) ? tokens(reply.usage) : null;
  const same = isObj(reply) && typeof reply.model === 'string' && (reply.model === reserve.model || reply.model.startsWith(reserve.model + '-'));
  const priced = r !== null && t !== null && same;
  const cost = priced ? costCents(r, t) : reserve.ceilingCents;
  const stop = isObj(reply) && typeof reply.stop_reason === 'string' ? reply.stop_reason : 'no reply';
  return { seq: reserve.seq, at, kind: 'settle', job: reserve.job, model: reserve.model, tokens: t, costCents: cost, priced, overrun: cost > reserve.ceilingCents, stop };
}

/** brief(entries, settings, now) → the morning line, from the ledger alone. */
export function brief(entries, settings, now) {
  const c = config(settings);
  if (!c.ok) return 'API tier: the settings are refused (' + c.why + '), so no call can be made';
  const cfg = c.cfg, s = replay(entries), day = dayOf(now), today = day ? s.days[day] || 0 : 0;
  const head = isOff(s, cfg)
    ? 'API tier OFF: ' + money(s.total) + ' of the ' + money(cfg.creditCents) + ' credit is spent (the stop is ' + money(cfg.stopCents) + '); the free tiers carry on until the stop is raised'
    : 'API tier: today ' + money(today) + ' of ' + money(cfg.dayCents) + ' · ' + money(s.total) + ' of the ' + money(cfg.creditCents) + ' credit spent, ' + money(cfg.stopCents - s.total) + ' left before the stop at ' + money(cfg.stopCents);
  const jobs = Object.keys(s.jobs).sort().map((j) => j + ' ' + money(s.jobs[j])).join(', ');
  return head + ' · ' + s.calls + ' calls, ' + s.refused + ' refused' + (jobs ? ' · by job: ' + jobs : '')
    + (s.overruns ? ' · ' + s.overruns + ' OVERRUN' : '') + (s.open.length ? ' · ' + s.open.length + ' unsettled, counted at the ceiling' : '');
}

/** toTally(entries, settings) → kar-tally's input: the stop as the cap and one entry per seq, in the wall's own numbering
 *  from 1, a call at its charged cost and a refusal at none, each with the balance the wall claims after it. kar-tally
 *  re-adds it and checks the numbering, so a line deleted from the ledger shows as a break. */
export function toTally(entries, settings) {
  const c = config(settings), cfg = c.ok ? c.cfg : DEFAULTS, s = replay(entries);
  let left = cfg.stopCents;
  const rows = s.rows.map((x) => {
    left -= x.cents;
    return { seq: x.seq, actor: 'kar', action: (x.kind === 'call' ? 'api:' : 'refused:' + x.code + ':') + x.job, cost: x.cents / 100, balance: left / 100 };
  });
  return { cap: cfg.stopCents / 100, startSeq: 1, entries: rows };
}

/** findSecrets(text) → how many strings shaped like an Anthropic key the text holds. */
export function findSecrets(text) {
  return typeof text === 'string' ? (text.match(KEY_SHAPE) || []).length : 0;
}

export default { DEFAULTS, EFFORTS, NANO_PER_CENT, KEY_SHAPE, config, rate, cents, tokens, costCents, ceiling, bytesOf, dayOf,
  replay, isOff, check, cleanEvidence, escalate, plan, settle, brief, toTally, findSecrets };

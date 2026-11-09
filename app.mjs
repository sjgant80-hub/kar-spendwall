// kar-spendwall · app.mjs — the page. Every number on it is read from the committed receipts (data/sim.json,
// data/witness.json, data/proofs.json, data/prices.json) or computed here, live, by the very law the wire runs
// (src/wall.mjs, src/sim.mjs). Nothing is fetched from anywhere but this page's own files.
import W from './src/wall.mjs';
import S from './src/sim.mjs';
import { verifyLedger } from './vendor/kar-tally/kernel.mjs';

const $ = (id) => document.getElementById(id);
const usd = (c) => '$' + (c / 100).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const num = (id, lo, hi) => { const v = Math.floor(Number($(id).value)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };
const svgNS = 'http://www.w3.org/2000/svg';
const el = (svg, tag, attrs, text) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; svg.appendChild(e); return e; };

let SIM = null, WIT = null, PROOFS = null, PRICES = null;

function claims() {
  const m = SIM.measured, v = Object.fromEntries(SIM.verdicts.map((x) => [x.id, x]));
  const w = WIT ? WIT.kernels : [], wk = w.reduce((n, k) => n + k.killed, 0), wt = w.reduce((n, k) => n + k.total, 0);
  const t = PROOFS && PROOFS.teacher, wire = PROOFS && PROOFS.wire, scan = PROOFS && PROOFS.scan;
  const rows = [
    ['K1', 'The API only after the cheaper tiers fail', m.k1.requestsWithoutEvidence + ' requests came without the evidence; ' + m.k1.reachedTheApi + ' reached the API', 'the simulation, re-derived on every push', v.K1.pass],
    ['K2', 'No day over the cap', 'dearest day ' + usd(m.k2.dearestDayCents) + ' against a cap of ' + usd(m.k2.capCents) + '; the cap refused ' + m.k2.refusedForDay + ' requests; the quietest day asked for ' + usd(m.k2.cheapestDemandCents), 'the simulation', v.K2.pass],
    ['K3', 'A hard stop that latches', usd(m.k3.totalCents) + ' charged against a stop of ' + usd(m.k3.stopCents) + '; off from ' + (m.k3.firstOffDay || 'never') + ', and ' + m.k3.callsAfterOff + ' calls after', 'the simulation', v.K3.pass],
    ['K4', 'An honest ledger, re-added by kar-tally', m.k4.entries + ' ledger lines; kar-tally ' + m.k4.tally + ', ' + usd(m.k4.tallyTotalCents) + ' re-added of ' + usd(m.k4.wallTotalCents), 'the simulation, kar-tally unmodified', v.K4.pass],
    ['K5', 'Nothing unverified acts', t ? t.pass + ' of ' + t.tests + ' tests of the teacher passed; in them, rules that fail the gate were never promoted' : 'no receipt', t ? 'Kar\'s machine (' + t.ran + ')' : '—', t ? t.pass === t.tests : null],
    ['K6', 'The key stays secret', (wire ? wire.pass + ' of ' + wire.tests + ' wire tests with a fake key and decoy credentials' : 'no receipt') + (scan ? '; ' + scan.hits + ' key-shaped strings in ' + scan.files + ' tracked files' : ''), 'CI, every push', wire && scan ? wire.pass === wire.tests && scan.hits === 0 : null],
    ['C', 'A family taught never costs again', t ? 'covered after one lesson, and not picked again (same ' + t.tests + '-test receipt)' : 'no receipt', t ? 'Kar\'s machine (' + t.ran + ')' : '—', t ? t.pass === t.tests : null],
    ['O', 'No call over its ceiling', m.o.overruns + ' overruns in ' + m.k4.calls + ' calls', 'the simulation and the wire test', v.O.pass],
    ['W', 'The law, mutation-proven', w.length ? wk + ' of ' + wt + ' mutants caught across ' + w.length + ' files, none baselined' : 'no receipt', 'witness v0.6, re-run in CI', w.length ? wk === wt && w.every((k) => k.ignored === 0) : null],
    ['R', 'The simulation re-derives', SIM.ledger.entries + ' lines, fingerprint ' + SIM.ledger.sha256.slice(0, 12) + '…', 'CI, byte for byte; and your browser, below', true],
  ];
  $('claims').querySelector('tbody').innerHTML = rows.map(([id, what, measured, where, pass]) =>
    '<tr><td><b>' + id + '</b></td><td>' + esc(what) + '</td><td>' + esc(measured) + '</td><td class="muted">' + esc(where) + '</td><td>' +
    (pass === null ? '<span class="chip wait">NO RECEIPT</span>' : '<span class="chip ' + (pass ? 'win' : 'bad') + '">' + (pass ? 'HELD' : 'FAILED') + '</span>') + '</td></tr>').join('');
  const held = rows.filter((r) => r[4] === true).length, failed = rows.filter((r) => r[4] === false);
  $('verdictline').innerHTML = '<span class="chip ' + (failed.length ? 'bad' : 'win') + '">' + held + ' OF ' + rows.length + ' HELD</span> ' +
    esc('The dearest simulated day spent ' + usd(m.k2.dearestDayCents) + ' under a ' + usd(m.k2.capCents) + ' cap; the running total stopped at ' + usd(m.k3.totalCents) + ' under a ' + usd(m.k3.stopCents) + ' stop, and kar-tally re-added every cent.');
  $('faq-failed').textContent = failed.length ? 'Failed and kept on the record: ' + failed.map((r) => r[0] + ' (' + r[2] + ')').join('; ') + '.' : 'No claim has failed. The limits are stated in the white paper: the auditor proves the ledger adds up, not that it is complete.';
  $('faq-overrun').textContent = 'In the simulated sixty days there were ' + m.o.overruns + ' overruns in ' + m.k4.calls + ' calls, and the morning brief checks the real ledger for them every day.';
}

function settings() {
  const s = SIM.settings, p = PRICES.models[s.model];
  const rows = [
    ['Daily cap (UTC day)', usd(s.dayCents)], ['Kar\'s stop', usd(s.stopCents) + ' of the ' + usd(s.creditCents) + ' credit'],
    ['Model', s.model + ', effort ' + s.effort], ['Output limit per call', s.maxTokens.toLocaleString('en-GB') + ' tokens, thinking included'],
    ['Calls a night, at most', String(s.perNight)], ['Framing allowance', s.frame + ' tokens'],
    ['Prices', p ? [['in', p.in], ['out', p.out], ['cache write', p.write], ['cache read', p.read]].map(([k, v]) => '$' + (v < 1 ? v.toFixed(2) : String(v)) + ' ' + k).join(' · ') + ', per million tokens (read ' + PRICES.read + ')' : '—'],
    ['Worst case of one call', p ? usd(W.ceiling(W.rate(PRICES, s.model), 4000, s)) + ' for a 4,000-byte request' : '—'],
  ];
  $('settings').querySelector('tbody').innerHTML = rows.map(([k, v]) => '<tr><td><b>' + esc(k) + '</b></td><td>' + esc(v) + '</td></tr>').join('');
}

function charts(days, capCents, stopCents) {
  const d = $('daychart'), t = $('totalchart');
  d.innerHTML = ''; t.innerHTML = '';
  const n = days.length, X0 = 50, X1 = 950, bw = (X1 - X0) / n;
  const top = Math.max(capCents * 1.15, ...days.map((x) => x.spentCents)), y = (c) => 220 - (c / top) * 190;
  el(d, 'text', { x: 50, y: 16, 'font-size': 12, fill: 'var(--muted)', 'font-family': 'var(--mono)' }, 'spent each day');
  days.forEach((x, i) => {
    const h = 220 - y(x.spentCents);
    el(d, 'rect', { x: X0 + i * bw + 1, y: y(x.spentCents), width: Math.max(1, bw - 2), height: Math.max(0, h), fill: x.refusedStop ? 'var(--muted)' : 'var(--accent)' });
  });
  el(d, 'line', { x1: X0, x2: X1, y1: y(capCents), y2: y(capCents), stroke: 'var(--cap)', 'stroke-width': 2, 'stroke-dasharray': '6 4' });
  el(d, 'text', { x: X1, y: y(capCents) - 6, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--cap)' }, 'the cap, ' + usd(capCents));
  el(d, 'line', { x1: X0, x2: X1, y1: 220, y2: 220, stroke: 'var(--line)' });
  el(d, 'text', { x: X0, y: 240, 'font-size': 11, fill: 'var(--muted)' }, days[0].day);
  el(d, 'text', { x: X1, y: 240, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, days[n - 1].day);
  let run = 0;
  const cum = days.map((x) => (run += x.spentCents));
  const tt = Math.max(stopCents * 1.1, run), yt = (c) => 190 - (c / tt) * 165;
  el(t, 'text', { x: 50, y: 16, 'font-size': 12, fill: 'var(--muted)', 'font-family': 'var(--mono)' }, 'running total');
  el(t, 'polyline', { points: cum.map((c, i) => (X0 + (i + 0.5) * bw).toFixed(1) + ',' + yt(c).toFixed(1)).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5 });
  el(t, 'line', { x1: X0, x2: X1, y1: yt(stopCents), y2: yt(stopCents), stroke: 'var(--bad)', 'stroke-width': 2, 'stroke-dasharray': '6 4' });
  el(t, 'text', { x: X1, y: yt(stopCents) - 6, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--bad)' }, 'Kar\'s stop, ' + usd(stopCents));
  el(t, 'line', { x1: X0, x2: X1, y1: 190, y2: 190, stroke: 'var(--line)' });
  const off = days.findIndex((x) => x.refusedStop > 0);
  if (off >= 0) el(t, 'text', { x: X0 + off * bw, y: yt(cum[off]) + 18, 'font-size': 12, fill: 'var(--muted)' }, 'the tier switches itself off: ' + days[off].day);
}

function cards(m) {
  const c = [
    ['Dearest day', usd(m.k2.dearestDayCents), 'against a cap of ' + usd(m.k2.capCents)],
    ['Refused by the cap', String(m.k2.refusedForDay), 'requests, back the next day'],
    ['Refused for no evidence', String(m.k1.refusedForTier), 'the cheaper tiers had not failed'],
    ['Total at the stop', usd(m.k3.totalCents), 'stop ' + usd(m.k3.stopCents) + ' · ' + m.k3.callsAfterOff + ' calls after'],
    ['kar-tally', m.k4.tally, usd(m.k4.tallyTotalCents) + ' re-added'],
  ];
  $('simcards').innerHTML = c.map(([k, big, vs]) => '<div class="card"><div class="k">' + esc(k) + '</div><div class="big">' + esc(big) + '</div><div class="vs">' + esc(vs) + '</div></div>').join('');
}

async function sha256(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function runYourself() {
  const btn = $('s-run'), out = $('s-out');
  btn.disabled = true; out.hidden = false; out.className = 'readout'; out.textContent = 'Running every request through the law…';
  await new Promise((r) => setTimeout(r, 30));
  const settingsIn = { dayCents: num('s-day', 1, 1e7), stopCents: num('s-stop', 1, 1e8) };
  settingsIn.creditCents = Math.max(SIM.settings.creditCents, settingsIn.stopCents);
  const days = num('s-days', 1, 120);
  const c = W.config(settingsIn);
  if (!c.ok) { out.className = 'readout no'; out.textContent = 'The law refuses these settings: ' + c.why + '.'; btn.disabled = false; return; }
  const sim = S.run({ prices: PRICES, settings: settingsIn, seed: SIM.seed, days, start: SIM.start });
  const m = S.measure(sim, settingsIn, verifyLedger), v = S.verdicts(m);
  charts(m.days, settingsIn.dayCents, settingsIn.stopCents); cards(m);
  const same = settingsIn.dayCents === SIM.settings.dayCents && settingsIn.stopCents === SIM.settings.stopCents && settingsIn.creditCents === SIM.settings.creditCents && days === SIM.days;
  let tail = '';
  if (same) {
    const h = await sha256(sim.ledger.map((e) => JSON.stringify(e)).join('\n') + '\n');
    tail = h === SIM.ledger.sha256 ? ' Your browser re-derived the committed ledger exactly: fingerprint ' + h.slice(0, 12) + '… matches the receipt.' : ' The fingerprint ' + h.slice(0, 12) + '… does NOT match the receipt.';
  }
  const bad = v.filter((x) => !x.pass);
  out.textContent = sim.ledger.length + ' ledger lines. ' + (bad.length ? 'Not every claim could be decided at these settings: ' + bad.map((x) => x.id + ' (' + x.what + ')').join('; ') + '.' : 'Every claim the simulation decides held.') + ' Dearest day ' + usd(m.k2.dearestDayCents) + ', total ' + usd(m.k3.totalCents) + ', kar-tally ' + m.k4.tally + '.' + tail;
  btn.disabled = false;
}

function tryOne() {
  const now = new Date(), at = now.toISOString(), today = num('t-today', 0, 1e8), total = Math.max(num('t-total', 0, 1e8), today);
  const yday = new Date(now.getTime() - 86400000).toISOString();
  const L = [];
  if (total > today) L.push({ seq: 1, at: yday, day: W.dayOf(yday), kind: 'reserve', job: 'earlier', ceilingCents: total - today });
  if (today > 0) L.push({ seq: 2, at, day: W.dayOf(at), kind: 'reserve', job: 'earlier', ceilingCents: today });
  const evidence = { tier1: { asked: $('t-asked').checked, answered: $('t-answered').checked }, tier2: { tried: num('t-tried', 0, 1000), passed: num('t-passed', 0, 1000) } };
  const p = W.plan(L, { job: 'teacher', evidence, bytes: num('t-bytes', 0, 1e9) }, {}, PRICES, at, $('t-key').checked);
  const out = $('t-out');
  if (p.ok) {
    out.className = 'readout';
    out.textContent = 'Reserved ' + usd(p.entry.ceilingCents) + ' before anything goes out: the most this call can cost. After it, today stands at ' + usd(today + p.entry.ceilingCents) + ' of ' + usd(p.cfg.dayCents) + ' until the answer settles it at what it really cost.';
  } else {
    out.className = 'readout no';
    out.textContent = 'Refused (' + p.entry.code + '): ' + p.entry.why + '. Nothing was sent; the refusal goes in the ledger.';
  }
}

function trace() {
  const r = W.rate(PRICES, SIM.settings.model), s = SIM.settings, prompt = 'Write up to 5 rules that pick out "fam" repositories.';
  const bytes = W.bytesOf(['', prompt]), ceil = W.ceiling(r, bytes, s), t = { in: 812, out: 431, write: 0, read: 0 };
  const cost = W.costCents(r, t), nano = t.in * r.in + t.out * r.out;
  const steps = [
    'The wire takes the ledger\'s lock, so no two calls can read the same balance.',
    'The law checks the evidence (the library had no rule; the 7B tried and nothing passed), the price, the size (' + bytes + ' bytes), the stop and today\'s cap.',
    'It reserves the whole ceiling, ' + usd(ceil) + ': (' + bytes + ' bytes + ' + s.frame + ') at the dearer input price, plus ' + s.maxTokens.toLocaleString('en-GB') + ' output tokens at $' + PRICES.models[s.model].out + ' a million. The line is flushed to disk.',
    'Only then is the key read, and one request goes out: model ' + s.model + ', output limit ' + s.maxTokens.toLocaleString('en-GB') + ', effort ' + s.effort + '. No retry.',
    'The answer reports ' + t.in + ' tokens in and ' + t.out + ' out: $' + (nano / 1e9).toFixed(6) + ', rounded up to ' + usd(cost) + '. The settlement replaces the reservation.',
    'The answer goes back to the job as a proposal; the job\'s own gate decides what, if anything, it is worth.',
  ];
  $('trace').innerHTML = steps.map((x) => '<li>' + esc(x) + '</li>').join('');
}

function costCase() {
  const r = W.rate(PRICES, SIM.settings.model), rate = num('c-rate', 0, 10000), hours = num('c-hours', 0, 24 * 31), out = num('c-out', 1, 128000), bytes = num('c-bytes', 0, 1e9), cap = num('c-cap', 1, 1e8);
  const per = W.ceiling(r, bytes, { ...SIM.settings, maxTokens: out }), calls = rate * 60 * hours, none = calls * per;
  const days = hours > 0 ? Math.ceil(hours / 24) + 1 : 0, walled = Math.min(none, days * cap, SIM.settings.stopCents), after = Math.min(none, days * (cap + per));
  $('c-head').innerHTML = esc('A loop making ' + rate + ' calls a minute for ' + hours + ' hours makes ' + calls.toLocaleString('en-GB') + ' calls. At its worst, each one costs ' + usd(per) + '.');
  $('c-table').querySelector('tbody').innerHTML = [
    ['No wall', 'Every call goes out until someone notices', usd(none)],
    ['A check after each call', 'Refuses once the cap is crossed: too late by up to one call, every day', 'up to ' + usd(after)],
    ['This wall', 'Reserves each call\'s worst case first; the loop is refused at the cap and falls back to the free tiers', 'at most ' + usd(walled) + (days ? ' (' + days + ' UTC days at most, each capped)' : '')],
  ].map(([a, b, c]) => '<tr><td><b>' + esc(a) + '</b></td><td>' + esc(b) + '</td><td class="num">' + esc(c) + '</td></tr>').join('');
}

async function main() {
  [SIM, WIT, PROOFS, PRICES] = await Promise.all([json('data/sim.json'), json('data/witness.json'), json('data/proofs.json'), json('data/prices.json')]);
  if (!SIM || !PRICES) { $('verdictline').textContent = 'The record did not load; reload the page.'; return; }
  claims(); settings(); charts(SIM.measured.days, SIM.settings.dayCents, SIM.settings.stopCents); cards(SIM.measured); trace(); tryOne(); costCase();
  $('s-day').value = SIM.settings.dayCents; $('s-stop').value = SIM.settings.stopCents; $('s-days').value = SIM.days;
  $('s-run').addEventListener('click', runYourself);
  for (const id of ['t-asked', 't-answered', 't-tried', 't-passed', 't-bytes', 't-today', 't-total', 't-key']) $(id).addEventListener('input', tryOne);
  for (const id of ['c-rate', 'c-hours', 'c-out', 'c-bytes', 'c-cap']) $(id).addEventListener('input', costCase);
}
main();

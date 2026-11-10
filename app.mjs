// kar-spendwall · app.mjs — the page. Every number on it is read from the committed receipts (data/sim.json,
// data/witness.json, data/proofs.json, data/real.json, data/prices.json) or computed here, live, by the very law the
// wire runs (src/wall.mjs, src/sim.mjs). Two claims are decided on this page as it loads: R (your browser re-derives the
// simulated ledger and checks its fingerprint) and P (the page reads its own source and finds no measured number typed
// in). Nothing is fetched from anywhere but this page's own files.
import W from './src/wall.mjs';
import S from './src/sim.mjs';
import { verifyLedger } from './vendor/kar-tally/kernel.mjs';

const $ = (id) => document.getElementById(id);
const usd = (c) => '$' + (c / 100).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (p) => fetch(p).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const text = (p) => fetch(p).then((r) => (r.ok ? r.text() : null)).catch(() => null);
const num = (id, lo, hi) => { const v = Math.floor(Number($(id).value)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; };
const svgNS = 'http://www.w3.org/2000/svg';
const el = (svg, tag, attrs, t) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (t !== undefined) e.textContent = t; svg.appendChild(e); return e; };
const chip = (v, yes = 'HELD', no = 'FAILED', wait = 'NO RECEIPT') => (v === null ? '<span class="chip wait">' + wait + '</span>' : '<span class="chip ' + (v ? 'win' : 'bad') + '">' + (v ? yes : no) + '</span>');

let SIM = null, WIT = null, PROOFS = null, REAL = null, PRICES = null, R_OK = null, P_OK = null, P_WHY = 'checking…';

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const ledgerText = (L) => L.map((e) => JSON.stringify(e)).join('\n') + '\n';

// P, decided here: the measured numbers in the receipt must not appear anywhere in this page's own source
async function checkP() {
  const html = await text('index.html');
  if (!html) { P_OK = null; P_WHY = 'the page source did not load'; return; }
  const m = SIM.measured, visible = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/style="[^"]*"/g, '');
  const forms = [usd(m.k2.dearestDayCents), usd(m.k2.cheapestDemandCents), usd(m.k3.totalCents), SIM.ledger.sha256.slice(0, 12), usd(SIM.settings.dayCents), usd(SIM.settings.stopCents)];
  for (const n of [m.k1.requestsWithoutEvidence, m.k2.refusedForDay, m.k3.refusedForStop, m.k4.entries, m.k4.calls]) if (n > 9) forms.push(String(n), n.toLocaleString('en-GB'));
  const found = forms.filter((f) => visible.includes(f));
  P_OK = found.length === 0 && !/\$\s?\d/.test(visible);
  P_WHY = P_OK ? 'your browser read this page\'s source: none of ' + forms.length + ' measured figures is typed into it' : 'typed into the page: ' + found.join(', ');
}

// R, decided here: the browser re-runs the sixty days and compares the ledger's fingerprint with the receipt
async function checkR() {
  const sim = S.run({ prices: PRICES, settings: {}, seed: SIM.seed, days: SIM.days, start: SIM.start });
  R_OK = (await sha256(ledgerText(sim.ledger))) === SIM.ledger.sha256;
}

function claims() {
  const m = SIM.measured, v = Object.fromEntries(SIM.verdicts.map((x) => [x.id, x]));
  const w = WIT ? WIT.kernels : [], wk = w.reduce((n, k) => n + k.killed, 0), wt = w.reduce((n, k) => n + k.total, 0);
  const t = PROOFS && PROOFS.teacher, wire = PROOFS && PROOFS.wire, scan = PROOFS && PROOFS.scan;
  const real = REAL ? Object.fromEntries(REAL.rows.map((r) => [r.id, r])) : {};
  const realCell = (id) => (!REAL ? chip(null) : REAL.calls === 0 ? '<span class="chip wait">NO CALL YET</span>' : chip(real[id] ? real[id].pass : null) + ' <span class="muted">' + esc(real[id] ? real[id].measured : '') + '</span>');
  const named = (re) => (t && Array.isArray(t.names) ? t.names.filter((n) => re.test(n)) : []);
  const rows = [
    ['K1', 'The API only after the cheaper tiers fail', m.k1.requestsWithoutEvidence + ' requests came without the evidence; ' + m.k1.reachedTheApi + ' reached the API', 'the simulation', v.K1.pass, realCell('K1')],
    ['K2', 'No day over the cap', 'dearest day ' + usd(m.k2.dearestDayCents) + ' against a cap of ' + usd(m.k2.capCents) + '; the cap refused ' + m.k2.refusedForDay + ' requests; the quietest day asked for ' + usd(m.k2.cheapestDemandCents), 'the simulation', v.K2.pass, realCell('K2')],
    ['K3', 'A hard stop that latches', usd(m.k3.totalCents) + ' charged against a stop of ' + usd(m.k3.stopCents) + '; off from ' + (m.k3.firstOffDay || 'never') + ', and ' + m.k3.callsAfterOff + ' calls after', 'the simulation', v.K3.pass, realCell('K3')],
    ['K4', 'A numbered ledger that kar-tally re-adds', m.k4.entries + ' ledger lines; kar-tally ' + m.k4.tally + ', ' + usd(m.k4.tallyTotalCents) + ' re-added of ' + usd(m.k4.wallTotalCents) + '; a deleted line fails it (tested)', 'the simulation and the tests', v.K4.pass, realCell('K4')],
    ['K5', 'Nothing unverified acts', t ? t.pass + ' of ' + t.tests + ' tests of the teacher passed' + (named(/K5/).length ? ', including: ' + named(/K5/).join('; ') : '') : 'no receipt', t ? 'Kar\'s machine, ' + t.ran + ' (not public, not re-run by CI)' : '—', t ? t.pass === t.tests : null, '<span class="muted">—</span>'],
    ['K6', 'The key stays secret', (wire ? wire.pass + ' of ' + wire.tests + ' wire tests with a fake key and decoy credentials' : 'no receipt') + (scan ? '; ' + scan.hits + ' key-shaped strings in ' + scan.files + ' tracked files' : ''), 'CI, every push', wire && scan ? wire.pass === wire.tests && scan.hits === 0 : null, '<span class="muted">—</span>'],
    ['C', 'A family taught is not sent again', t ? (named(/never sent again/).length ? named(/never sent again/).join('; ') : 'see the teacher receipt') : 'no receipt', t ? 'Kar\'s machine, ' + t.ran + ' (not public, not re-run by CI)' : '—', t ? t.pass === t.tests : null, '<span class="muted">—</span>'],
    ['O', 'No call over its ceiling', 'simulation: ' + m.o.overruns + ' overruns, but it reports usage inside the ceiling by design, so it does not test the bound; the detector is tested', 'the tests; the real ledger decides', null, realCell('O')],
    ['W', 'The law, mutation-proven', w.length ? wk + ' of ' + wt + ' mutants caught across ' + w.length + ' files (the wire is not mutation-tested)' : 'no receipt', 'witness v0.6, re-run in CI', w.length ? wk === wt && w.every((k) => k.ignored === 0) : null, '<span class="muted">—</span>'],
    ['R', 'The simulation re-derives', R_OK === null ? 'your browser is re-running the sixty days…' : SIM.ledger.entries + ' lines; your browser re-derived the fingerprint ' + SIM.ledger.sha256.slice(0, 12) + '…' + (R_OK ? '' : ' and it did NOT match'), 'CI, and your browser now', R_OK, '<span class="muted">—</span>'],
    ['P', 'No measured number typed into the page', P_WHY, 'CI, and your browser now', P_OK, '<span class="muted">—</span>'],
  ];
  $('claims').querySelector('tbody').innerHTML = rows.map(([id, what, measured, where, pass, realHtml]) =>
    '<tr><td><b>' + id + '</b></td><td>' + esc(what) + '</td><td>' + esc(measured) + '</td><td class="muted">' + esc(where) + '</td><td>' +
    (id === 'O' ? '<span class="chip wait">OPEN</span>' : chip(pass, 'HELD', 'FAILED', R_OK === null && id === 'R' ? 'CHECKING' : 'NO RECEIPT')) + '</td><td>' + realHtml + '</td></tr>').join('');
  const decided = rows.filter((r) => r[4] === true || r[4] === false), held = decided.filter((r) => r[4] === true), failed = decided.filter((r) => r[4] === false);
  $('verdictline').innerHTML = '<span class="chip ' + (failed.length ? 'bad' : 'win') + '">' + held.length + ' OF ' + decided.length + ' DECIDED CLAIMS HELD</span> ' +
    esc('In sixty simulated days the dearest day spent ' + usd(m.k2.dearestDayCents) + ' under a ' + usd(m.k2.capCents) + ' cap and the total stopped at ' + usd(m.k3.totalCents) + ' under a ' + usd(m.k3.stopCents) + ' stop. ' + (REAL && REAL.calls ? 'The real ledger has ' + REAL.calls + ' calls.' : 'The real ledger has no call yet.') + ' O stays open until real calls decide it.');
  $('faq-failed').textContent = failed.length ? 'Failed and kept on the record: ' + failed.map((r) => r[0] + ' (' + r[2] + ')').join('; ') + '.' : 'No decided claim has failed. O is open: it needs real calls. The limits are in the white paper.';
  $('faq-overrun').textContent = REAL && REAL.calls ? 'On the real ledger: ' + (real.O ? real.O.measured : '—') + '.' : 'No real call has been made yet, so there is no real figure. The simulation cannot overrun by design, and the morning audit checks the real ledger for overruns every day.';
  $('faq-who').textContent = 'Kar, on its own credit, first' + (REAL && REAL.calls ? ': ' + REAL.calls + ' real calls so far.' : ', and no real call has been made yet: the API key is not installed.') + ' No outside team yet; this is the showcase.';
}

function realSection() {
  if (!REAL) { $('real').textContent = 'The real-ledger receipt did not load.'; return; }
  $('real').textContent = 'The real ledger lives on Kar\'s own machine, never in this repository; Kar\'s morning brief judges it by the same rules every session, and tools/audit.mjs --write publishes the result here. Last written ' + REAL.at + ': ' +
    (REAL.present ? REAL.calls + ' calls, ' + REAL.refused + ' refusals, ' + usd(REAL.totalCents) + ' charged.' : 'there is no ledger yet, because no call has been attempted.') + (REAL.calls ? '' : ' The tier stays off until the API key is installed.');
}

function settings() {
  const s = SIM.settings, p = PRICES.models[s.model];
  const fmt = (v) => '$' + (v < 1 ? v.toFixed(2) : String(v));
  const rows = [
    ['Daily cap (UTC day)', usd(s.dayCents)], ['Kar\'s stop', usd(s.stopCents) + ' of the ' + usd(s.creditCents) + ' credit'],
    ['Model', s.model + ', effort ' + s.effort], ['Output limit per call', s.maxTokens.toLocaleString('en-GB') + ' tokens, thinking included'],
    ['Teacher job: families a night, at most', String(s.perNight) + ' (the wall itself counts dollars, not calls)'], ['Framing allowance', s.frame + ' tokens'],
    ['Prices', p ? [['in', p.in], ['out', p.out], ['cache write', p.write], ['cache read', p.read]].map(([k, v]) => fmt(v) + ' ' + k).join(' · ') + ', per million tokens (read ' + PRICES.read + ')' : '—'],
    ['Worst case of one call', p ? usd(W.ceiling(W.rate(PRICES, s.model), 4000, s)) + ' for a 4,000-byte request' : '—'],
  ];
  $('settings').querySelector('tbody').innerHTML = rows.map(([k, val]) => '<tr><td><b>' + esc(k) + '</b></td><td>' + esc(val) + '</td></tr>').join('');
}

function charts(days, capCents, stopCents) {
  const d = $('daychart'), t = $('totalchart');
  d.innerHTML = ''; t.innerHTML = '';
  const n = days.length, X0 = 50, X1 = 950, bw = (X1 - X0) / n;
  const top = Math.max(capCents * 1.15, ...days.map((x) => x.spentCents)), y = (c) => 220 - (c / top) * 190;
  el(d, 'text', { x: 50, y: 16, 'font-size': 12, fill: 'var(--muted)', 'font-family': 'var(--mono)' }, 'spent each day');
  days.forEach((x, i) => el(d, 'rect', { x: X0 + i * bw + 1, y: y(x.spentCents), width: Math.max(1, bw - 2), height: Math.max(0, 220 - y(x.spentCents)), fill: x.refusedStop ? 'var(--muted)' : 'var(--accent)' }));
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
    ['Refused by the cap', String(m.k2.refusedForDay), 'requests, back the next UTC day'],
    ['Refused for no evidence', String(m.k1.refusedForTier), 'the cheaper tiers had not failed'],
    ['Total at the stop', usd(m.k3.totalCents), 'stop ' + usd(m.k3.stopCents) + ' · ' + m.k3.callsAfterOff + ' calls after'],
    ['kar-tally', m.k4.tally, usd(m.k4.tallyTotalCents) + ' re-added'],
  ];
  $('simcards').innerHTML = c.map(([k, big, vs]) => '<div class="card"><div class="k">' + esc(k) + '</div><div class="big">' + esc(big) + '</div><div class="vs">' + esc(vs) + '</div></div>').join('');
}

async function runYourself() {
  const btn = $('s-run'), out = $('s-out');
  btn.disabled = true; out.hidden = false; out.className = 'readout'; out.textContent = 'Running every request through the law…';
  await new Promise((r) => setTimeout(r, 30));
  const st = { dayCents: num('s-day', 1, 1e7), stopCents: num('s-stop', 1, 1e8) };
  st.creditCents = Math.max(SIM.settings.creditCents, st.stopCents);
  const days = num('s-days', 1, 120), c = W.config(st);
  if (!c.ok) { out.className = 'readout no'; out.textContent = 'The law refuses these settings: ' + c.why + '.'; btn.disabled = false; return; }
  const sim = S.run({ prices: PRICES, settings: st, seed: SIM.seed, days, start: SIM.start });
  const m = S.measure(sim, st, verifyLedger), v = S.verdicts(m);
  charts(m.days, st.dayCents, st.stopCents); cards(m);
  const same = st.dayCents === SIM.settings.dayCents && st.stopCents === SIM.settings.stopCents && st.creditCents === SIM.settings.creditCents && days === SIM.days;
  let tail = '';
  if (same) { const h = await sha256(ledgerText(sim.ledger)); tail = h === SIM.ledger.sha256 ? ' Your browser re-derived the committed ledger exactly: fingerprint ' + h.slice(0, 12) + '… matches the receipt.' : ' The fingerprint ' + h.slice(0, 12) + '… does NOT match the receipt.'; }
  const bad = v.filter((x) => !x.pass);
  out.textContent = sim.ledger.length + ' ledger lines. ' + (bad.length ? 'Not every claim can be decided at these settings: ' + bad.map((x) => x.id + ' (' + x.what + ')').join('; ') + '.' : 'Every claim the simulation decides held.') + ' Dearest day ' + usd(m.k2.dearestDayCents) + ', total ' + usd(m.k3.totalCents) + ', kar-tally ' + m.k4.tally + '.' + tail;
  btn.disabled = false;
}

function tryOne() {
  const now = new Date(), at = now.toISOString(), today = num('t-today', 0, 1e8), total = Math.max(num('t-total', 0, 1e8), today);
  const yday = new Date(now.getTime() - 86400000).toISOString(), L = [];
  if (total > today) L.push({ seq: 1, at: yday, day: W.dayOf(yday), kind: 'reserve', job: 'earlier', ceilingCents: total - today });
  if (today > 0) L.push({ seq: 2, at, day: W.dayOf(at), kind: 'reserve', job: 'earlier', ceilingCents: today });
  const evidence = { tier1: { asked: $('t-asked').checked, answered: $('t-answered').checked }, tier2: { tried: num('t-tried', 0, 1000), passed: num('t-passed', 0, 1000) } };
  const p = W.plan(L, { job: 'teacher', evidence, bytes: num('t-bytes', 0, 1e9) }, {}, PRICES, at, $('t-key').checked);
  const out = $('t-out');
  if (p.ok) { out.className = 'readout'; out.textContent = 'Reserved ' + usd(p.entry.ceilingCents) + ' before anything goes out: the most this call can cost. Today then stands at ' + usd(today + p.entry.ceilingCents) + ' of ' + usd(p.cfg.dayCents) + ' until the answer settles it at what it really cost.'; }
  else { out.className = 'readout no'; out.textContent = 'Refused (' + p.entry.code + '): ' + p.entry.why + '. Nothing is sent; the refusal goes in the ledger.'; }
}

function trace() {
  const r = W.rate(PRICES, SIM.settings.model), s = SIM.settings, prompt = 'Write up to 5 rules that pick out "fam" repositories.';
  const bytes = W.bytesOf(['', prompt]), ceil = W.ceiling(r, bytes, s), t = { in: 812, out: 431, write: 0, read: 0 };
  const cost = W.costCents(r, t), nano = t.in * r.in + t.out * r.out;
  $('trace').innerHTML = [
    'The wire takes the ledger\'s lock, so no two calls can read the same balance.',
    'The law checks the evidence (the library had no rule; the local model tried and nothing passed), the price, the size (' + bytes + ' bytes), the stop and today\'s cap.',
    'It reserves the whole ceiling, ' + usd(ceil) + ': (' + bytes + ' bytes + ' + s.frame + ') at the dearer input price, plus ' + s.maxTokens.toLocaleString('en-GB') + ' output tokens at $' + PRICES.models[s.model].out + ' a million. The line is flushed to disk.',
    'Only then is the key read, and one request goes out: model ' + s.model + ', output limit ' + s.maxTokens.toLocaleString('en-GB') + ', effort ' + s.effort + '. No retry.',
    'The answer reports ' + t.in + ' tokens in and ' + t.out + ' out: $' + (nano / 1e9).toFixed(6) + ', rounded up to ' + usd(cost) + '. The settlement replaces the reservation.',
    'The answer goes back to the job as text; the job\'s own gate decides what, if anything, it is worth.',
  ].map((x) => '<li>' + esc(x) + '</li>').join('');
}

function costCase() {
  const r = W.rate(PRICES, SIM.settings.model), rate = num('c-rate', 0, 10000), hours = num('c-hours', 0, 24 * 31), out = num('c-out', 1, 128000), bytes = num('c-bytes', 0, 1e9), cap = num('c-cap', 1, 1e8), stop = num('c-stop', 1, 1e9);
  const per = W.ceiling(r, bytes, { ...SIM.settings, maxTokens: out }), calls = rate * 60 * hours, none = calls * per;
  const days = hours > 0 ? Math.ceil(hours / 24) + 1 : 0, walled = Math.min(none, days * cap, stop), after = Math.min(none, days * (cap + per));
  $('c-head').textContent = 'With ' + SIM.settings.model + ', a loop making ' + rate + ' calls a minute for ' + hours + ' hours makes ' + calls.toLocaleString('en-GB') + ' calls. At its worst, each one costs ' + usd(per) + '.' + (per > cap ? ' One such call is more than a day\'s cap, so the wall refuses every one of them.' : '');
  $('c-table').querySelector('tbody').innerHTML = [
    ['No wall in your code', 'Every call goes out until someone notices (the provider\'s own limit, if set, still applies)', usd(none)],
    ['A check after each call', 'Refuses once the cap is crossed: too late by up to one call, each UTC day', 'up to ' + usd(after)],
    ['This wall', 'Reserves each call\'s worst case first and refuses at the cap; what the job does instead is up to the job', 'at most ' + usd(per > cap ? 0 : walled) + (days && per <= cap ? ' (' + days + ' UTC days at most, each capped, never past the stop)' : '')],
  ].map(([a, b, c]) => '<tr><td><b>' + esc(a) + '</b></td><td>' + esc(b) + '</td><td class="num">' + esc(c) + '</td></tr>').join('');
}

async function main() {
  [SIM, WIT, PROOFS, REAL, PRICES] = await Promise.all([json('data/sim.json'), json('data/witness.json'), json('data/proofs.json'), json('data/real.json'), json('data/prices.json')]);
  if (!SIM || !PRICES) { $('verdictline').textContent = 'The record did not load; reload the page.'; return; }
  claims(); realSection(); settings(); charts(SIM.measured.days, SIM.settings.dayCents, SIM.settings.stopCents); cards(SIM.measured); trace(); tryOne(); costCase();
  $('s-day').value = SIM.settings.dayCents; $('s-stop').value = SIM.settings.stopCents; $('s-days').value = SIM.days;
  $('s-run').addEventListener('click', runYourself);
  for (const id of ['t-asked', 't-answered', 't-tried', 't-passed', 't-bytes', 't-today', 't-total', 't-key']) $(id).addEventListener('input', tryOne);
  for (const id of ['c-rate', 'c-hours', 'c-out', 'c-bytes', 'c-cap', 'c-stop']) $(id).addEventListener('input', costCase);
  await checkP(); claims();
  await new Promise((r) => setTimeout(r, 50));
  await checkR(); claims();
}
main();

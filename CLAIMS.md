# kar-spendwall · SEAL 1: the claims, written before any code

**What this is.** Kar is the estate's resident builder. It now has about $100 of Claude API credit, to use as its top
reasoning tier, the most expensive one. Everything cheaper comes first: tier 1 is the deterministic tools and the
pattern library, tier 2 is the local 7B on this laptop. The API is tier 3, and the last tier is Simon. This repository is the wall
that stands between Kar and that credit: a daily cap checked before every call, a ceiling on every call, a hard stop,
and a ledger an independent auditor re-adds. Simon wrote the spec ("KAR API MUSCLE", 2026-11-09) and gave the
settings to Kar ("it's up to Kar how he wants to allocate it", "it's up to Kar what he wants to build").

**The one job.** The pattern library's nightly teacher. Every night `si-didy/patlib-night.mjs` asks the local 7B to
write rules for the families of repositories the library cannot place yet, and a deterministic gate keeps only rules
that win on held-out data. When the library has no rule for a family (tier 1 cannot) and every rule the 7B wrote for it
tonight failed the gate (tier 2 cannot), that family, and only that family, may go to the API, with the very same
prompt the 7B got. The API's rules are proposals: they face the same gate. A family the API teaches is covered from
then on, so it never costs again.

## The settings (Kar's choice)

| Setting | Value |
|---|---|
| Daily cap | $2.50 per UTC day |
| Kar's stop | $95.00 of the $100 credit (the $5 margin keeps a call from ever meeting an empty balance mid-flight) |
| Model | `claude-opus-5-5`, effort `medium`, at most 6,000 output tokens per call (thinking counts as output) |
| Calls | at most 6 a night; no retries (a retry would be a second spend under one reservation); no server-side fallback (a fallback model would be priced outside the ceiling) |
| Prices | claude.com/pricing, read 2026-11-09 (the page has no date): Opus 5.5 $4 input, $20 output, $5 cache write, $0.20 cache read, per million tokens |
| Ceiling of a call | (UTF-8 bytes of the request + 256) × the dearer of the input and cache-write prices + the output limit × the output price, rounded UP to a whole cent |
| Every charge | rounded UP to a whole cent, so the ledger never under-counts and kar-tally (which works in whole cents) audits it exactly |

Simon can change the daily cap and the stop at any time in a local file; the law refuses a setting that makes no sense
(a cap above the stop, a stop above the credit, a cap of zero).

## The claims

- **K1 · the API only after the cheap tiers fail.** The wire refuses any request that does not show tier 1 asked
  without an answer AND tier 2 tried with nothing passing. Bar: in the tests and the simulation, 0 requests without that
  evidence reach the API; in the real ledger, every call carries the evidence.
- **K2 · no day over the cap.** On every UTC day the charged spend is at most $2.50, and every call is preceded in the
  ledger by a reservation of its full ceiling, written to disk before the request goes out. Bar: the simulation
  (60 days, demand at least twice the cap) has its dearest day at or under the cap AND at least one refusal (the cap
  really bit); the real ledger passes the same check.
- **K3 · a hard stop.** The total charged never passes $95. Once a call would cross it, that request and every later
  one is refused with the reason "the API tier is off", and the morning line says so. Bar: the simulation runs past the
  stop: total at or under $95, at least one such refusal, and no call after the first one.
- **K4 · an honest ledger.** Every attempt, called or refused, is logged with its job, its tokens (in, out, cache), its
  cost, the day's spend and what is left. The morning line is computed from the ledger alone. The ledger re-audits PASS
  on kar-tally's own kernel, vendored unmodified and pinned by its SHA-256, and kar-tally's total equals the wall's.
  Bar: all of that, in the simulation, in the wire's test, and on the real ledger.
- **K5 · nothing unverified acts.** An API reply is only ever a proposal. Nothing enters the pattern library except
  through the library's own gate. Bar: a test teacher that answers with rules which fail the gate gets 0 rules promoted;
  every promoted rule whose source is the API carries the gate's receipt.
- **K6 · the key stays secret.** The key is read only from a file outside every repository, only inside the wire's own
  process; it is never printed, logged or saved, and the wire ignores every credential and endpoint in its environment.
  Bar: the wire's test runs with a fake key against a local stand-in for the API and finds the key in none of the
  ledger, stdout or stderr; CI scans every tracked file and the live page for the shape of an Anthropic key and finds 0.
- **C · the cache.** A family the API taught is covered the next night and gets 0 API calls. Bar: the integration test.
- **O · no overrun.** No call's actual cost exceeds the ceiling reserved for it; an overrun would still be charged in
  full and flagged. Bar: 0 overruns in the simulation, in the wire's test and in the real ledger.
- **W · the gate.** witness v0.6 on `src/wall.mjs`: every mutant killed, nothing baselined, no cap on the count; a fuzz
  test shows the law never throws on garbage.
- **R · re-derivation.** `data/sim.json` re-derives byte for byte in CI.
- **P · the page.** The live page types no measured number; it reads every one from the committed receipts.

A claim that fails stays on the record as FAILED, with why.

Powered by the Konomi architecture, created by Thomas Frumkin.

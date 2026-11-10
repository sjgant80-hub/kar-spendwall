# kar-spendwall

**Live:** https://sjgant80-hub.github.io/kar-spendwall/

A spend wall for an AI agent's paid model calls. The cheaper tiers go first. Before a request can go out, the wall
reserves the most that call could possibly cost, on disk, against a daily cap and a hard stop. Afterwards it settles
the call at what the API says it cost. Every attempt goes in a ledger, and kar-tally, an independent auditor from the
same estate, re-adds it.

Built for Kar, the estate's resident builder, to spend about $100 of Claude API credit on its hardest thinking and
nothing else (Simon's "KAR API MUSCLE" spec, 2026-11-09). The first job is the pattern library's nightly teacher: only
families the local 7B could not crack go to Claude, with the 7B's own question, and Claude's rules face the library's
own gate.

**What it stops, and what it does not.** It stops mistakes and runaway code: a loop that runs all night, a retry storm,
a job that reaches for the paid model when a cheap one would do, a process that dies mid-call. It does not stop someone
or something that can already write to your files (read the key, edit the settings, delete the ledger): keep the
provider's own limit on as the outer wall (auto-reload off, or a Console spend limit).

**The real ledger** lives on Kar's machine (`~/.si-didy/api/ledger.jsonl`), never here. `tools/audit.mjs --write`
publishes its verdicts as `data/real.json`. Until the API key is installed there is no call, and the page says so.

## Proof

- **The claims came first:** `CLAIMS.md` (SEAL 1, e530394) names every claim and its bar before any code.
- **The law is one pure file**, `src/wall.mjs`, with the job's law (`src/teach.mjs`), the proof harness
  (`src/sim.mjs`) and the real-ledger audit (`src/audit.mjs`). witness v0.6 catches every mutant of all four, nothing
  baselined, no cap: `data/witness.json`. CI re-runs the gate on every push and must get the same counts.
- **Sixty hostile days** go through the law and are re-derived byte for byte in CI: `data/sim.json`.
- **The wire** (`tools/ask.mjs`) is tested end to end against a stand-in API, with a fake key and decoy `ANTHROPIC_*`
  credentials in its environment: the file's key is what is sent, the decoys never are, and the key appears in none
  of the ledger, stdout or stderr. For real calls its key and ledger paths are fixed; the test mode refuses the real
  key. CI scans every tracked file for anything shaped like a key. The wire is tested end to end, not mutation-tested.
- **The ledger is numbered**: kar-tally re-adds every call and refusal in the wall's own numbering, so a deleted line
  is a break it catches (deleting the last lines, or the whole file, is not: compare with the provider's usage page).

## Use it

    npm ci
    # the key, alone, in a file outside every repository:
    #   ~/.si-didy/keys/anthropic-api.key
    echo '{"job":"teacher","evidence":{"tier1":{"asked":true,"answered":false},"tier2":{"tried":3,"passed":0}},"prompt":"..."}' | node tools/ask.mjs
    node tools/audit.mjs        # the real ledger, judged by the claims' own bars

Settings (optional): `~/.si-didy/api/settings.json`, e.g. `{"dayCents": 300, "stopCents": 9500}`.

Powered by the Konomi architecture, created by Thomas Frumkin. MIT licence (see `LICENSE`).

# Phase B: Project Status Reporting & Criteria-Typing Assistant

**Date:** 2026-04-26
**Status:** Approved (high-level); detailed design captured here
**Supersedes / depends on:** `2026-04-24-mcpls-phase-a-design.md` (no runtime dependency, but reframes the original "Phase B = LSP-in-analyze-prd" plan)

## Background

Phase A's spec deferred two items to "phase B": Ralph-side LSP usage in `--analyze-prd` and richer call-graph/route info in PRD analysis. Brainstorming on 2026-04-26 surveyed the existing example PRDs and concluded that the original framing has thin value: PRDs in this project are mostly greenfield, so symbol references are aspirational and cross-referencing them against the existing codebase catches little. Iteration data (the `progress.txt` lines, PRD JSON `criteriaResults`/`attempts`/`completedAt`, commit `Ralph-Status` trailers) is much richer than the codebase, and is currently not surfaced anywhere.

This spec replaces the original phase B framing with two grounded enhancements:

1. **`--report`** — a new flag that aggregates iteration data for a PRD into a project-status report.
2. **`--analyze-prd` criteria-typing assistant** — adds a "Suggested Type Hints" section to the existing analyze-prd output, proposing inline-type-hint rewrites for criteria that look executable but are still strings.

Phase C (SymDex / new criteria types / auto-detection) remains deferred.

## Goals

1. `ralph-loop <prd> --report` prints a structured status report (run summary, per-task breakdown, hotspots) with no API calls.
2. `ralph-loop <prd> --analyze-prd` continues to do everything it does today, plus appends a deterministic "Suggested Type Hints" section that scans every untyped criterion for known patterns and proposes rewrites.
3. Both features are opt-in and pure-data — no external tools, no new long-lived dependencies. They work on the artifacts ralph-loop already produces.
4. Both features are independently testable via unit tests against pure functions.

## Non-Goals

- Cross-run aggregation (e.g. "show stats across all PRDs in a directory"). `--report` operates on a single PRD per invocation.
- Auto-rewriting the PRD markdown file. Suggestions are printed; the human applies them.
- LLM involvement in either feature. Both must be deterministic so they produce stable output across runs (and keep `--report` cheap).
- Any LSP / SymDex / external-tool integration. Phase C territory.
- Cross-iteration failure-pattern mining beyond what `--report` surfaces (a count column on the per-task table). Deeper pattern-detection (e.g. clustering similar error messages) is out of scope.

## Design

### `--report` flag

#### Invocation

```
./ralph-loop <prd-file> --report [--no-github]
```

- `--report` is mutually exclusive with `--analyze-prd` and the loop itself. When set, ralph-loop prints the report and exits 0 (or non-zero if the PRD JSON is missing/corrupt).
- The PRD argument may be a markdown file (converted just-in-time) or a JSON file (used directly). Same rules as `--analyze-prd`.
- No GitHub calls are made. `--no-github` is implicitly the report's behavior even without the flag, but is accepted to mirror existing semantics.

#### Output sections

The report has four sections, in order:

1. **Run Summary** — total iterations used, max iterations, tasks total/passed/blocked/in-progress, elapsed wall-clock time (when derivable from `progress.txt` ITERATION timestamps), MCP `degraded` rate (count of degraded iterations / total iterations), GitHub API call count when available.
2. **Per-Task Breakdown** — one row per task: id, title, status (`passed`/`in-progress`/`blocked`/`pending`), priority, attempts, criteria pass rate (e.g. `4/5`), `dependsOn`, last iteration touched.
3. **Criteria Hotspots** — list of criteria that have failed in 2+ iterations across the run, sorted by failure count desc. Each entry: task id, criterion text (truncated), fail count, last error message (truncated to ~80 chars).
4. **MCP Health** (only when MCP was enabled in any iteration) — count of `ok` / `degraded` / `off` lines per iteration; pointer to any sidecar `mcp-iteration-N.log` files.

Output is text (matching existing `--analyze-prd` aesthetic — ANSI color, box-drawing headers). No JSON output in phase B; can be added later.

#### Data sources

- **PRD JSON** — primary source. Tasks already track `passes`, `attempts`, `completedAt`, `criteriaResults` (per-criterion pass/fail history), `dependsOn`, `status`, `blockedBy`.
- **`progress.txt`** — secondary. Line-parses `ITERATION N/MAX` blocks and any `MCP: <status>` markers to compute iteration count and MCP degradation rate.
- **No git introspection in phase B.** Commit trailers are out of scope; everything we need is already in the JSON + progress.txt.

#### Implementation

A new `lib/report/` module follows the established thin-Node-CLI pattern:

```
lib/report/
  index.js         # CLI: report --task-file <path> --progress-file <path>
  aggregator.js    # Pure: (prdJson, progressText) -> { summary, tasks, hotspots, mcp }
  formatter.js     # Pure: aggregatorOutput -> string (the printed report)
  aggregator.test.js
  formatter.test.js
```

Bash adds a top-level `--report` branch in `parse_arguments` and a `run_report` function that mirrors `analyze_prd`'s entrypoint shape: validate JSON → call the Node CLI → print → exit.

### Criteria-Typing Assistant (`--analyze-prd` extension)

#### Behavior

When `--analyze-prd` runs, after the existing dependency-analysis section and before the Claude narrative call, ralph-loop scans every untyped criterion (any criterion that doesn't have an inline type hint and whose normalized type is `manual`) and proposes type hints based on a small list of conservative regex patterns.

#### Patterns (initial list)

| Pattern in criterion text | Suggested type | Rationale |
|---|---|---|
| `Test: Run` `<cmd>` <code>(backticked)</code> | `[shell: <cmd>]` | Existing common idiom in example PRDs. |
| `Run` `<cmd>` (backticked) and verify | `[shell: <cmd>]` | Same idiom, slight variation. |
| `<file>` exists / file `<path>` is created / Created `<path>` | `[file-exists: <path>]` | Path-shaped string with creation verb. |
| `POST <url> returns <NNN>` / `GET <url> returns <NNN>` | `[http: <method> <url> -> <NNN>]` | HTTP-shaped lines. |
| `grep` `<regex>` `<file>` (any order, in backticks) | `[grep: <regex> in <file>]` | Already-shell-shaped grep instructions. |

The matcher is conservative: low false-positive rate is more important than high recall. Patterns must match within a single criterion line; multi-line inference is out of scope.

#### Output

A new "Suggested Type Hints" section is appended to `--analyze-prd` output before the Claude narrative call. Format:

```
Suggested Type Hints:
  Task: task-1 (Implement Backend Email Validation)
    Criterion 7: "Test: Run `npm test -- email-validation.test.js` and verify all 15 test cases pass"
      Suggested:  [shell: npm test -- email-validation.test.js]
    Criterion 8: ...

  Task: task-2 (Add Frontend Real-Time Email Validation)
    (no suggestions)

5 suggestions across 2 tasks. Apply manually to raise Executable Coverage from 47% to ~75%.
```

If no suggestions are produced, the section is omitted (don't add noise).

When the existing Executable Coverage warning fires (<50%), it links forward to the suggestions section.

#### Implementation

A new pure module:

```
lib/criteria/
  suggestions.js       # Pure: (criterionText) -> [{ type, value, rationale }]
  suggestions.test.js
```

`lib/criteria/index.js` gains a `suggest` subcommand: takes a PRD JSON path, returns JSON `{ tasks: [{ id, title, suggestions: [{ index, original, suggestion, rationale }] }], totalSuggestions }`.

Bash `analyze_prd` calls the new subcommand and renders the section.

### Shared decisions

- **No PRD JSON state changes.** Neither feature persists anything to the PRD JSON. `--report` is read-only; suggestions are advisory.
- **No new acceptance-criteria types.** Phase B only uses the four existing types (`shell`, `http`, `file-exists`, `grep`). New types are phase C.
- **No GitHub API calls.** Both features work fully offline.
- **No LLM calls in phase B's new code paths.** `--report` is pure deterministic aggregation. The criteria-typing assistant is regex-only.
- **Determinism.** Given the same PRD JSON + progress.txt, both features produce byte-identical output.

## Files touched

- `lib/report/index.js`, `lib/report/aggregator.js`, `lib/report/formatter.js` — new
- `lib/report/aggregator.test.js`, `lib/report/formatter.test.js` — new
- `lib/criteria/suggestions.js`, `lib/criteria/suggestions.test.js` — new
- `lib/criteria/index.js` — gain `suggest` subcommand
- `ralph-loop` — add `--report` flag, `run_report` function, mutual exclusion with `--analyze-prd`, suggestions section in `analyze_prd`, help text
- `tests/test-report.sh` — new bash end-to-end test
- `tests/test-analysis.sh` — extend with suggestion-section assertions
- `tests/test-help.sh` — extend with `--report` help-text assertion
- `tests/test-all.sh` — register `test-report.sh`
- `README.md`, `CLAUDE.md` — document `--report` flag and the suggestions section

## Out of scope (explicitly)

- Cross-PRD aggregation
- JSON output for `--report`
- Auto-applying suggestions to the PRD markdown
- Any LSP/SymDex usage (phase C)
- New criteria types (phase C)
- Failure-pattern clustering beyond raw count
- Resume-aware delta reporting
- Cost / token / API-budget analytics

## Open questions

None at design time.

# Copilot CLI agent + reviewer — design

**Date:** 2026-04-28
**Status:** Draft, pending review

## Problem

Ralph Loop currently hard-codes a single agent backend: `claude --dangerously-skip-permissions --print` is invoked at three points in `ralph-loop` (around lines 2785, 2808, 2815, in the debug/verbose/quiet branches of the iteration loop). We want to:

1. Let users run the loop on **GitHub Copilot CLI** (the agentic `copilot` binary, not `gh copilot`) as a full alternative to Claude.
2. Allow a **second agent to act as a reviewer** when criteria fail, feeding insight forward without doubling per-iteration cost.

Both axes are independent: primary agent and reviewer are picked per run.

## Goals

- `--agent claude|copilot` swaps the per-iteration backend with no other behavior change.
- `--reviewer none|claude|copilot|auto` adds a failure-time second opinion. `auto` picks the other agent.
- Reviewer comments are always posted to the GitHub issue (when GitHub is enabled).
- Reviewer feedback is injected into the next prompt **only after thrash threshold** (4+ consecutive failures), so the cheap path stays cheap.
- MCP support works for both agents.
- Observability (progress, commits, issue comments, report) records which agent ran each iteration.

## Non-goals

- Alternating implementer ensembles (odd/even iterations swap agents). Rejected during brainstorm — different mental models cause thrash.
- Per-iteration agent switching. Agent is per-run.
- Real-time reviewer chatter on every iteration. Reviewer only fires on criterion failure.
- Cost tracking per agent. Out of scope; existing `GITHUB_API_CALLS` warning is unchanged.

## Architecture

### Agent abstraction

Extract the three inline `claude ...` invocations in `ralph-loop` into a single Bash function:

```bash
invoke_agent <agent> <prompt_file> [mcp_args...]
# → writes to global agent_output, returns agent's exit code
```

Per-agent dispatch:

- `claude` — `claude --dangerously-skip-permissions --print "${mcp_args[@]}" < "$prompt_file"`
- `copilot` — `copilot -p --allow-all-tools "${mcp_args[@]}" < "$prompt_file"` (exact print-mode + auto-approve flags verified against the installed Copilot CLI version during implementation).

The retry/backoff wrapper (rate-limit detection via `grep -iq "rate limit\|429\|quota"`) wraps `invoke_agent`, so both agents share retry behavior. The MCP-status classifier currently scans `claude_output`; the variable is renamed to `agent_output` and the same case-insensitive heuristic is reused unchanged — both agents surface MCP errors as plain text.

### Selection and preflight

- New flag `--agent claude|copilot` (default `claude`), parsed in `parse_arguments`, stored in `AGENT` global.
- Startup preflight: `command -v "$AGENT"` — exit with a clear "agent binary not found" error if missing. Same check for `REVIEWER` if it resolves to a non-`none` value.
- `auto` reviewer resolution: if `--agent` was set explicitly to X, reviewer is the other agent. If `--agent` defaulted, `auto` resolves to `copilot`.
- Same-agent reviewer (e.g. `--agent claude --reviewer claude`) is allowed without warning. Lower value, but the user may have a reason.

### Reviewer flow

After `node lib/criteria/index.js verify` returns and any criterion has failed, if `REVIEWER != none`:

1. Build a reviewer prompt via new `node lib/prompt/index.js build-review --task-file ... --task-id ... --criteria-results ... --agent-output-tail ...`. Output is a focused "here's the failing criteria and the last N lines of agent output, suggest a different approach" prompt.
2. Invoke the reviewer through `invoke_agent` (same retry/MCP/output handling).
3. **Always:** post the reviewer output as a separate GitHub issue comment with header `### Reviewer feedback (<agent>)` — gated behind `GITHUB_ENABLED`, non-fatal on failure.
4. **Conditionally:** write the reviewer output to `.ralph/<slug>/reviewer-feedback.txt`. On the next iteration, when assembling the prompt, `lib/prompt/index.js build` checks `progress.txt` for consecutive-failure count; if it's ≥ 4 (existing thrash threshold), the file's contents are read into a `## Reviewer Feedback` section of the prompt and the file is deleted after use. Below threshold, the file is overwritten by the next reviewer run (only the most recent feedback ever exists on disk).

Reviewer invocations do **not** count toward `attempts` / `passes`, do **not** create a commit, and do **not** post an iteration table comment. They get their own `Reviewer:` line in `progress.txt`.

### MCP and config

Copilot CLI uses a different MCP config schema than Claude (top-level `mcpServers` key, slightly different field shapes). When `--mcp` is set:

- `lib/mcp/config.js` exports `buildMcpConfig({ agent })` and emits the right schema per agent.
- `lib/mcp/index.js write-config` is invoked **twice** when both an agent and a non-`none` reviewer are configured (once per agent), producing `.ralph/<slug>/mcp-config.claude.json` and/or `.ralph/<slug>/mcp-config.copilot.json`.
- Bash picks the matching config file when building `mcp_args` for each `invoke_agent` call.
- The MCP iteration sidecar log gains an agent suffix: `mcp-iteration-N.<agent>.log`. Primary and reviewer don't collide.

This is a small, idempotent extra write per run — worth it so reviewer invocations get MCP for free.

## Observability

### Commit trailers

`lib/git/commits.js` adds `Ralph-Agent: <agent>` to every iteration commit alongside the existing `Ralph-Task-Id`, `Ralph-Issue`, `Ralph-Status: in-progress|passed|failed` trailers. Reviewer invocations don't commit, so no trailer there.

### `progress.txt`

Each iteration block already includes a `MCP:` line. We add two adjacent lines:

- `Agent: claude|copilot` (always, identifies primary)
- `Reviewer: <agent>|none` with status `ok|degraded|off|n/a` (always)

Box-drawing formatting and `ITERATION N/MAX` markers are unchanged.

### GitHub issue comments

`lib/github/issues.js` iteration comment table gains an `Agent` column. Reviewer feedback is a separate comment posted directly after, with header `### Reviewer feedback (<agent>)`. Both gated behind `GITHUB_ENABLED`.

### Resume / crosscheck

`crosscheck_issues` (and the resume parser that reads last iteration from `progress.txt`) is extended to extract the last `Agent:` value. If the resumed run's `--agent` differs, it warns: `previous run used <prev>, current run uses <curr> — continuing`. Non-fatal — user may have switched intentionally.

### `--report`

The offline report aggregator (`lib/report/aggregator.js`) gains an "Agent breakdown" section: iteration count per agent, reviewer invocation count, reviewer comment count. Pure reads; no new API calls.

## Testing

### New Bash test suites (`tests/test-all.sh` registers all)

- `tests/test-agent-selection.sh` — `--agent claude|copilot`, default, preflight failure on missing binary, log filename suffix, MCP config selection. Uses fake `claude` / `copilot` shims on `PATH` (matches the existing `gh` shim pattern).
- `tests/test-reviewer.sh` — `--reviewer none|claude|copilot|auto`, `auto` resolution, reviewer fires only on criterion failure, thrash-gated prompt injection (mocks `progress.txt` with 4 consecutive failures), reviewer doesn't bump `attempts` or commit.
- `tests/test-agent-resume.sh` — switching `--agent` between resumed runs surfaces the `crosscheck_issues` warning.

### JS unit tests (Jest)

- `lib/prompt/builder.test.js` — `build-review` command output; `## Reviewer Feedback` section appears only when `reviewer-feedback.txt` exists and consecutive-failure count ≥ 4.
- `lib/mcp/config.test.js` — `buildMcpConfig({ agent: 'copilot' })` emits the Copilot schema; `agent: 'claude'` regression guard.
- `lib/git/commits.test.js` — `Ralph-Agent` trailer present and correct.
- `lib/github/issues.test.js` — iteration table renders the `Agent` column; reviewer comment formatter renders correctly.

### Out of scope

Real `claude` / `copilot` / `gh` invocations (always shimmed); MCP server reachability.

## Open items resolved during brainstorm

- **Which Copilot?** The agentic `copilot` binary (not `gh copilot`).
- **Ensemble role?** Failure-time reviewer only; no alternating implementer.
- **Reviewer feedback path?** Always issue comment; prompt injection only after thrash threshold.
- **Defaults?** `--agent claude`, `--reviewer none`. `--reviewer auto` opts into the other agent.

## Risks

- **Copilot CLI flag drift.** Print-mode and auto-approve flags may change between Copilot CLI versions. Mitigation: preflight check on startup; document tested version in README; keep the per-agent dispatch in one Bash function so a flag change is a one-line edit.
- **Output heuristic mismatch.** The MCP-status classifier was tuned against Claude output. If Copilot phrases MCP errors very differently, the classifier could mis-label iterations. Mitigation: implementation step adds a small fixture-based test of the classifier against captured Copilot output samples; classifier is heuristic anyway, so misclassification is non-fatal.
- **Reviewer config sprawl.** Two MCP config files per run, two log files per iteration. Mitigation: all under `.ralph/<slug>/`, cleaned by existing state-dir hygiene.

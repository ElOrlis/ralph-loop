# mcpls Integration — Phase A Design

**Date:** 2026-04-24
**Status:** Approved (design); implementation plan pending
**Supersedes / depends on:** none

## Background

Ralph Loop currently invokes Claude with `claude --dangerously-skip-permissions --print` and a built prompt. Claude has no structured way to navigate the codebase it is editing — it relies on whatever it can read via its built-in file tools. Two open-source projects could change that:

- **mcpls** (`bug-ops/mcpls`) — Universal MCP↔LSP bridge written in Rust. Exposes Language Server Protocol capabilities (go-to-definition, references, diagnostics, completion, hover) as MCP tools. Auto-detects which language servers to spawn based on project markers (`Cargo.toml`, `go.mod`, `package.json`, `pyproject.toml`, etc.). Configured via its own `~/.config/mcpls/mcpls.toml`.
- **SymDex** (`husnainpk/SymDex`) — Python "codebase oracle" providing exact symbol search, semantic search, route maps, and call graphs across 16 languages. Not natively MCP.

The long-term goal is **option C** from brainstorming: both tools available to Claude during the loop *and* used by Ralph itself for richer `--analyze-prd` output and new criteria types (`lsp-diagnostics`, `symbol-exists`, etc.).

This spec covers **phase A only**: ship mcpls as an MCP server available to Claude during each iteration, behind an opt-in flag. SymDex and Ralph-side LSP usage are deferred.

## Goals

1. Claude has access to mcpls's LSP-backed MCP tools during every iteration when the user opts in.
2. Existing Ralph behavior is unchanged when the flag is not passed.
3. MCP-related failures degrade gracefully: a missing binary fails fast at startup; transient mid-loop failures warn and continue.
4. MCP health is visible per iteration in `progress.txt` and (when applicable) on the GitHub issue comment.

## Non-Goals

- SymDex integration in any form (deferred to phase B/C).
- Ralph-side use of LSP signals in `--analyze-prd` (phase B).
- New criteria types (`lsp-diagnostics`, `symbol-exists`) (phase C).
- Auto-detection of mcpls availability without an explicit flag (possible later enhancement).
- Managing mcpls's own configuration (`mcpls.toml`); the user owns that file.
- Installing mcpls or any LSP server on the user's machine.

## Design

### Flag

A new flag `--mcp` is added to `parse_arguments` in `ralph-loop`:

- Sets a global `MCP_ENABLED=true`. Default `false`.
- Not persisted in PRD JSON. It is a per-run concern, like `--verbose` or `--debug`.
- No interaction with `GITHUB_ENABLED` / `BRANCH_ENABLED`.
- Documented in `--help` output and `README.md`.

### Preflight

When `MCP_ENABLED` is true, the loop performs a single startup check:

- `command -v mcpls` must succeed.
- On failure: abort with a clear, actionable error message that names the binary and links to the install URL (`https://github.com/bug-ops/mcpls`). Do not start the loop.
- This preflight runs once per `ralph-loop` invocation, not per iteration.

### MCP config generation

A new module `lib/mcp/index.js` handles MCP config generation, following the existing thin-Node-CLI-behind-Bash pattern (`lib/prompt`, `lib/github`, `lib/criteria`, etc.):

- Command: `node lib/mcp/index.js write-config --output <path>`
- Writes:
  ```json
  { "mcpServers": { "mcpls": { "command": "mcpls" } } }
  ```
- Generated once at run start, alongside `progress.txt`, at `mcp-config.json`.
- The module is intentionally minimal in phase A. It exists now so phase C has a stable home for adding the SymDex MCP shim entry and any richer config (env vars, args, multiple servers).

### Claude invocation

The existing Claude CLI call gains `--mcp-config <path>` only when `MCP_ENABLED`:

- Off: `claude --dangerously-skip-permissions --print` (unchanged).
- On: `claude --dangerously-skip-permissions --print --mcp-config <run-dir>/mcp-config.json`.

### Failure handling

Phase A treats *startup* errors as fatal and *runtime* errors as recoverable, mirroring the existing GitHub gating pattern:

- **Startup (preflight):** missing `mcpls` binary → abort with error.
- **Per-iteration runtime:**
  - Capture mcpls / Claude stderr that mentions `mcp` or `mcpls` to a sidecar log: `mcp-iteration-N.log`, in the run directory.
  - If a Claude invocation exits non-zero and stderr matches the MCP heuristic (case-insensitive substring match on `mcp` or `mcpls`), classify the iteration's MCP status as `degraded`, warn, and continue the loop. The iteration itself proceeds through normal verification — Ralph still decides pass/fail from criteria results, not from MCP health.
  - Iteration outcome (pass/fail) is independent of MCP status. A `degraded` MCP status with passing criteria is still a passing iteration.

### Status surface

A new `MCP: ok|degraded|off` indicator is added to:

1. The per-iteration line in `progress.txt`.
2. The per-iteration GitHub issue comment results table emitted by `lib/github/issues.js` (only when `GITHUB_ENABLED`).

States:

- `off` — `MCP_ENABLED` is false.
- `ok` — `MCP_ENABLED` is true and no MCP-related errors were detected this iteration.
- `degraded` — `MCP_ENABLED` is true and the heuristic detected an MCP-related error this iteration.

### Testing

A new `tests/test-mcp.sh` covers:

- `--mcp` flag parsing sets `MCP_ENABLED`.
- Preflight aborts with non-zero exit and clear message when `mcpls` is not on `PATH`.
- `lib/mcp/index.js write-config` produces the expected JSON shape.
- `--mcp-config <path>` is appended to the Claude invocation only when `MCP_ENABLED` is true (asserted by stubbing `claude` and inspecting the recorded argv).
- The `MCP: ok|degraded|off` indicator appears in `progress.txt` for each state.
- A shell-stub `mcpls` on `PATH` is used for happy-path tests; CI does not need a real Rust toolchain or LSP.

The new suite is wired into `tests/test-all.sh`. Existing suites should continue to pass unchanged.

## Files touched

- `ralph-loop` — argument parsing, preflight, Claude invocation, status indicator, help text.
- `lib/mcp/index.js` — new thin CLI module.
- `lib/github/issues.js` — extend the iteration results table to include the MCP status column.
- `tests/test-mcp.sh` — new.
- `tests/test-all.sh` — register the new suite.
- `README.md` and `CLAUDE.md` — document the `--mcp` flag and the phase A scope.

## Open questions

None at design time. Follow-up items intentionally deferred to phases B and C are listed under Non-Goals.

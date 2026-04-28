# Ralph State Directory — Design

**Date:** 2026-04-27
**Status:** Approved (design)
**Owner:** ralph-loop maintainers

## Problem

Ralph currently writes generated state in two places:

- The converted PRD JSON (`<basename>.json`) lives **next to the markdown PRD**.
- `progress.txt` and rotated `progress-*.txt` files live in the **current working directory**.
- `mcp-config.json` and `mcp-iteration-N.log` (when `--mcp` is set) also land in cwd.

This mixes human-authored content (the markdown PRD) with machine-generated state, makes `.gitignore` messy, makes "reset this PRD" impossible without knowing every file, and ties progress location to wherever the user happens to invoke the tool.

## Goal

Establish a single, predictable state directory per PRD: `.ralph/<slug>/` at the repo root. All generated artifacts for that PRD live there. Provide a clean migration path for existing users and an escape hatch for non-standard layouts.

## Non-goals

- Pruning state for deleted PRDs (manual `rm -rf` is fine).
- Cross-PRD aggregation tooling over `.ralph/`.
- Storing state outside the repo (`--state-dir` covers this if anyone needs it).
- Auto-mutating the user's `.gitignore`.

## Decisions

| # | Decision |
|---|---|
| 1 | State lives at repo-root `.ralph/<prd-slug>/`. |
| 2 | Repo root is resolved via `git rev-parse --show-toplevel` from the PRD's directory. Hard error if not in a git repo (escape hatch: `--state-dir`). |
| 3 | Slug is `<basename>-<hash4>`, where `hash4` = first 4 hex chars of `sha1(repo-relative PRD path)`. Always appended (deterministic, collision-free in the common case). |
| 4 | File names inside the state dir are canonical/generic: `prd.json`, `progress.txt`, `progress-<ts>.txt`, `mcp-config.json`, `mcp-iteration-N.log`. The dir name carries PRD identity. |
| 5 | New layout is the default. Old behavior is **not** preserved automatically. |
| 6 | If legacy state is detected for a PRD and neither `--migrate-state` nor `--state-dir` was passed → **hard error**. No silent orphaning. |
| 7 | `.gitignore` is **not** mutated. A one-time hint prints on first creation of `.ralph/`. |
| 8 | `--migrate-state` moves legacy files (`git mv` if tracked, plain `mv` otherwise), renames to canonical names, then continues with a normal run. |
| 9 | `--migrate-state` hard-errors if the destination already contains any of the canonical files. No merge, no overwrite. |
| 10 | `--state-dir <path>` overrides the entire resolution algorithm: skips repo-root lookup, skips slug computation, skips legacy detection. Works outside a git repo. |

## Path resolution algorithm

Run once at startup, after `parse_arguments` and `validate_prd_file`, before `convert_prd_to_json`.

1. If `--state-dir <path>` is set → `STATE_DIR="<path>"` (resolved against cwd if relative). Skip steps 2–4.
2. Canonicalize the PRD path (`realpath`) and compute `REPO_ROOT = git -C <prd-dir> rev-parse --show-toplevel`. On failure → hard error: *"Ralph requires a git repository to anchor `.ralph/`. Run inside a git repo or pass `--state-dir <path>`."*
3. `REL_PATH` = canonicalized PRD path relative to `REPO_ROOT`. `BASENAME` = filename without extension. `HASH4` = first 4 hex chars of `sha1(REL_PATH)`. `SLUG = "${BASENAME}-${HASH4}"`. `STATE_DIR = "${REPO_ROOT}/.ralph/${SLUG}"`.
4. `mkdir -p "$STATE_DIR"` if missing. If the top-level `${REPO_ROOT}/.ralph/` directory did not exist before this `mkdir` (i.e., this is the first PRD ever run in this repo), print the `.gitignore` hint (one line, includes the absolute `.ralph/` path). The hint does **not** fire for subsequent new per-PRD subdirs.
5. Derive globals: `JSON_FILE="$STATE_DIR/prd.json"`, `PROGRESS_FILE="$STATE_DIR/progress.txt"`, `MCP_CONFIG_FILE="$STATE_DIR/mcp-config.json"`.
6. On every run (not just creation), write/verify `STATE_DIR/.source` containing the repo-relative PRD path. Mismatch → hard error indicating a slug hash collision; suggest `RALPH_SLUG_HASH_LEN=8`.

## Pre-flight: legacy detection

After resolution, before the main loop. Skipped entirely when `--state-dir` is set.

Legacy state for this PRD = any of:

- A sibling `<basename>.json` in the PRD's directory.
- `./progress.txt` in cwd.
- `./progress-*.txt` in cwd matching the rotation pattern.

If any exist **and** `STATE_DIR` is empty **and** neither `--migrate-state` nor `--state-dir` was passed → hard error with the exact message:

```
Found legacy Ralph state for this PRD:
  - <listed paths>

Ralph now stores state under .ralph/<slug>/. Pick one:
  --migrate-state          Move legacy files into .ralph/<slug>/
  --state-dir <path>       Keep using a custom location

To start fresh and ignore the legacy files, delete or move them yourself.
```

If `STATE_DIR` is non-empty, legacy files are ignored (the user has clearly already moved on).

## `--migrate-state` semantics

1. Re-detect legacy state. If none → no-op + info message; continue with a normal run. Not an error.
2. If `STATE_DIR` already contains any of `prd.json`, `progress.txt`, or `progress-*.txt` → hard error: *"Destination already populated; refusing to overwrite. Inspect `.ralph/<slug>/` and remove conflicting files manually if you want to re-migrate."*
3. For each legacy file:
   - Tracked in git (`git ls-files --error-unmatch <file>` succeeds) → `git mv`.
   - Untracked → plain `mv`.
   - Sibling JSON renames to `prd.json`. `progress.txt` and `progress-*.txt` keep their names; only their location changes.
4. Print a summary table of what moved (source → destination, transport).
5. Continue with the normal run. Migration is an opt-in mode of the normal invocation, not a separate command.

Migration is not transactional. On any failure, hard-error and instruct the user to inspect both source and `STATE_DIR` before retrying. Don't attempt rollback.

## `--state-dir <path>` semantics

- Accepts absolute or relative paths; relative paths resolve against cwd.
- Skips repo-root resolution, slug computation, and legacy detection.
- Works outside a git repo.
- `mkdir -p` if missing. No `.gitignore` hint.
- Composes with `--migrate-state` (migrate into the custom dir) and `--resume` (resume from the custom dir's `progress.txt`).

## Code touchpoints

### `ralph-loop` (Bash)

- **`parse_arguments`** — add `--state-dir <path>` and `--migrate-state` flags. No `--legacy-paths`.
- **New `resolve_state_dir`** — implements the resolution algorithm. Sets `STATE_DIR`, `JSON_FILE`, `PROGRESS_FILE`, `MCP_CONFIG_FILE`. Calls into `lib/state/index.js` for the pure logic; the bash side handles `mkdir`, hint, and `.source` file.
- **New `detect_legacy_state`** — returns the list of legacy paths. Used by both pre-flight and migration.
- **New `enforce_no_legacy`** — the hard-error pre-flight when neither flag was passed.
- **New `migrate_legacy_state`** — implements migration semantics above.
- **`convert_prd_to_json`** (current lines ~360–380) — replace local JSON-path derivation with `local json_file="$JSON_FILE"`.
- **Progress plumbing** — every reference to `progress.txt` and `progress-*.txt` switches to `$PROGRESS_FILE` and `"$STATE_DIR"/progress-*.txt`. Resume logic reads from `$PROGRESS_FILE`.
- **MCP plumbing** — pass `$MCP_CONFIG_FILE` to `node lib/mcp/index.js write-config --output`. `mcp-iteration-N.log` writes into `$STATE_DIR`.
- **Help text & error hints** — references to "progress.txt" and "your-prd.json" update to point at `.ralph/<slug>/`.

### `lib/`

- **New `lib/state/index.js`** — CLI: `resolve-paths --prd <path> [--state-dir <path>]`. Pure function returning JSON `{stateDir, jsonFile, progressFile, mcpConfigFile, slug, source}`. Keeps the algorithm testable in Jest.
- **New `lib/state/resolver.js`** — implementation of the resolver.
- All other `lib/*` modules are untouched (they consume paths passed by the bash layer).

### Tests

- **New `tests/test-state-paths.sh`** — covers resolution, slug determinism, legacy detection, migration (both `mv` and `git mv` paths), `--state-dir` override, hard-error scenarios, the `.source` collision check.
- **New `lib/state/state.test.js`** — Jest unit tests for the resolver.
- Existing tests that hard-code sibling JSON or cwd `progress.txt` paths get updated to pass `--state-dir <tempdir>` (they're not testing layout; they're testing the loop). A grep over `tests/` will turn up call sites.

### Documentation

- **`README.md`** — new "State directory" section: `.ralph/<slug>/`, `.gitignore` hint, `--migrate-state`, `--state-dir`.
- **`CLAUDE.md`** — update the "Run the tool" line and add a paragraph in "Key conventions" describing the new layout and the resolution rule.

## Risks & edge cases

1. **PRD rename/move silently orphans state.** Slug hashes the repo-relative path; moving the PRD produces a new slug. *Mitigation:* on resolve, if `STATE_DIR` doesn't exist but `.ralph/<basename>-*` does, print a warning suggesting `--state-dir`. No automatic recovery.
2. **PRD path is a symlink.** Canonicalize via `realpath` before computing `REL_PATH`.
3. **PRD belongs to a different repo than cwd.** State lands in the PRD's repo. Correct behavior; the `.gitignore` hint prints the absolute path so it's unambiguous.
4. **Worktrees.** Each worktree gets its own `.ralph/`. Desirable.
5. **Hash collision (~1 in 65k for two PRDs sharing a basename).** `.source` file under `STATE_DIR` is verified every run; mismatch → hard error suggesting `RALPH_SLUG_HASH_LEN=8`.
6. **`--migrate-state` partial failure.** Not transactional; hard-error with what moved. User inspects manually.
7. **`.ralph/` accidentally committed.** Hint is unmissable on first creation; auto-mutation rejected by design.
8. **Parallel test runs.** Tests use `--state-dir <tempdir>` per case, sidestepping resolution. Only `tests/test-state-paths.sh` exercises real resolution.

## Acceptance criteria

- A fresh PRD invocation creates `.ralph/<basename>-<hash4>/` at the repo root and writes `prd.json` and `progress.txt` there. No files appear next to the PRD or in cwd.
- The `.gitignore` hint prints exactly once on first creation of `.ralph/`.
- A second invocation with the same PRD reuses the same slug and `STATE_DIR`.
- Moving the PRD to a new path produces a new slug; the warning about a possibly-orphaned `.ralph/<basename>-*` dir prints.
- Running on a PRD with legacy state and no flags exits non-zero with the exact error message above.
- `--migrate-state` moves legacy files (using `git mv` for tracked files), renames the JSON to `prd.json`, and the run continues normally.
- `--migrate-state` hard-errors when the destination already contains canonical files.
- `--state-dir <path>` works outside a git repo, skips legacy detection, and composes with `--resume` and `--migrate-state`.
- A slug hash collision (simulated by writing a different `.source`) hard-errors with the suggested env var.
- `tests/test-state-paths.sh` and `lib/state/state.test.js` cover all the above.

# Ralph State Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all generated PRD state out of the PRD's directory and cwd into a single `.ralph/<slug>/` directory at the repo root, with `--migrate-state` and `--state-dir` flags for migration and overrides.

**Architecture:** A new `lib/state/` module computes the per-PRD state directory (slug = `<basename>-<hash4>`, anchored at `git rev-parse --show-toplevel`). The bash script calls into it, writes a `.source` sentinel for collision detection, prints a one-time `.gitignore` hint, and routes `JSON_FILE` / `PROGRESS_FILE` / `MCP_CONFIG_FILE` through the resolved path. A pre-flight blocks runs when legacy state is detected without `--migrate-state` or `--state-dir`.

**Tech Stack:** Bash 4.0+, Node.js (CommonJS), Jest, jq, git CLI.

**Spec:** `docs/superpowers/specs/2026-04-27-ralph-state-directory-design.md`

---

## File Structure

**Create:**
- `lib/state/resolver.js` — pure resolver: slug computation, path derivation, override handling
- `lib/state/index.js` — CLI wrapper (mirrors `lib/mcp/index.js` pattern)
- `lib/state/resolver.test.js` — Jest unit tests
- `tests/test-state-paths.sh` — bash integration tests

**Modify:**
- `ralph-loop` — add flags, new bash functions, swap path globals
- `tests/test-all.sh` — wire new test script
- `README.md` — new "State directory" section
- `CLAUDE.md` — update "Run the tool" line and "Key conventions"

---

## Task 1: Resolver — slug & path computation (TDD)

**Files:**
- Create: `lib/state/resolver.js`
- Test: `lib/state/resolver.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// lib/state/resolver.test.js
'use strict';

const path = require('path');
const { computeSlug, resolvePaths } = require('./resolver');

describe('computeSlug', () => {
  test('returns <basename>-<hash4> for a repo-relative path', () => {
    const slug = computeSlug('docs/prds/auth-system.md');
    expect(slug).toMatch(/^auth-system-[0-9a-f]{4}$/);
  });

  test('is deterministic for the same input', () => {
    const a = computeSlug('docs/prds/auth-system.md');
    const b = computeSlug('docs/prds/auth-system.md');
    expect(a).toBe(b);
  });

  test('differs when the path differs', () => {
    const a = computeSlug('docs/prds/auth-system.md');
    const b = computeSlug('services/auth/docs/prds/auth-system.md');
    expect(a).not.toBe(b);
  });

  test('respects RALPH_SLUG_HASH_LEN env var', () => {
    const prev = process.env.RALPH_SLUG_HASH_LEN;
    process.env.RALPH_SLUG_HASH_LEN = '8';
    try {
      const slug = computeSlug('docs/prds/auth-system.md');
      expect(slug).toMatch(/^auth-system-[0-9a-f]{8}$/);
    } finally {
      if (prev === undefined) delete process.env.RALPH_SLUG_HASH_LEN;
      else process.env.RALPH_SLUG_HASH_LEN = prev;
    }
  });

  test('strips .md and .json extensions for the basename', () => {
    expect(computeSlug('a/b/foo.md')).toMatch(/^foo-[0-9a-f]{4}$/);
    expect(computeSlug('a/b/foo.json')).toMatch(/^foo-[0-9a-f]{4}$/);
  });
});

describe('resolvePaths', () => {
  test('with stateDirOverride returns paths under that dir, no slug', () => {
    const r = resolvePaths({ stateDirOverride: '/tmp/custom-state' });
    expect(r.stateDir).toBe('/tmp/custom-state');
    expect(r.jsonFile).toBe('/tmp/custom-state/prd.json');
    expect(r.progressFile).toBe('/tmp/custom-state/progress.txt');
    expect(r.mcpConfigFile).toBe('/tmp/custom-state/mcp-config.json');
    expect(r.slug).toBeNull();
    expect(r.source).toBeNull();
  });

  test('with repoRoot + relPath returns slug-based paths', () => {
    const r = resolvePaths({
      repoRoot: '/repo',
      relPath: 'docs/prds/auth-system.md',
    });
    expect(r.slug).toMatch(/^auth-system-[0-9a-f]{4}$/);
    expect(r.stateDir).toBe(`/repo/.ralph/${r.slug}`);
    expect(r.jsonFile).toBe(`/repo/.ralph/${r.slug}/prd.json`);
    expect(r.progressFile).toBe(`/repo/.ralph/${r.slug}/progress.txt`);
    expect(r.mcpConfigFile).toBe(`/repo/.ralph/${r.slug}/mcp-config.json`);
    expect(r.source).toBe('docs/prds/auth-system.md');
  });

  test('throws when neither override nor (repoRoot+relPath) provided', () => {
    expect(() => resolvePaths({})).toThrow(/repoRoot.*relPath|stateDirOverride/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --no-coverage lib/state/resolver.test.js`
Expected: FAIL with "Cannot find module './resolver'".

- [ ] **Step 3: Implement the resolver**

```javascript
// lib/state/resolver.js
'use strict';

const path = require('path');
const crypto = require('crypto');

function computeSlug(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('computeSlug: relPath must be a non-empty string');
  }
  const len = parseInt(process.env.RALPH_SLUG_HASH_LEN || '4', 10);
  if (!Number.isFinite(len) || len < 4 || len > 40) {
    throw new Error(`RALPH_SLUG_HASH_LEN must be between 4 and 40 (got ${process.env.RALPH_SLUG_HASH_LEN})`);
  }
  const basename = path.basename(relPath).replace(/\.(md|json)$/i, '');
  const hash = crypto.createHash('sha1').update(relPath).digest('hex').slice(0, len);
  return `${basename}-${hash}`;
}

function resolvePaths({ stateDirOverride, repoRoot, relPath } = {}) {
  if (stateDirOverride) {
    const stateDir = path.resolve(stateDirOverride);
    return {
      stateDir,
      jsonFile: path.join(stateDir, 'prd.json'),
      progressFile: path.join(stateDir, 'progress.txt'),
      mcpConfigFile: path.join(stateDir, 'mcp-config.json'),
      slug: null,
      source: null,
    };
  }
  if (!repoRoot || !relPath) {
    throw new Error('resolvePaths: must provide stateDirOverride OR (repoRoot AND relPath)');
  }
  const slug = computeSlug(relPath);
  const stateDir = path.join(repoRoot, '.ralph', slug);
  return {
    stateDir,
    jsonFile: path.join(stateDir, 'prd.json'),
    progressFile: path.join(stateDir, 'progress.txt'),
    mcpConfigFile: path.join(stateDir, 'mcp-config.json'),
    slug,
    source: relPath,
  };
}

module.exports = { computeSlug, resolvePaths };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage lib/state/resolver.test.js`
Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add lib/state/resolver.js lib/state/resolver.test.js
git commit -m "feat(state): add pure path resolver for .ralph/<slug>/"
```

---

## Task 2: CLI wrapper

**Files:**
- Create: `lib/state/index.js`

- [ ] **Step 1: Implement the CLI wrapper**

```javascript
#!/usr/bin/env node
// lib/state/index.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolvePaths } = require('./resolver');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function realpathOrFail(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    fail(`Cannot resolve PRD path: ${p} (${err.message})`);
  }
}

function gitTopLevel(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (err) {
    return null;
  }
}

function main() {
  switch (command) {
    case 'resolve-paths': {
      const prd = getArg('--prd');
      const stateDirOverride = getArg('--state-dir');
      if (!prd) fail('Usage: resolve-paths --prd <path> [--state-dir <path>]');
      if (stateDirOverride) {
        const r = resolvePaths({ stateDirOverride });
        process.stdout.write(JSON.stringify(r) + '\n');
        return;
      }
      const prdAbs = realpathOrFail(prd);
      const repoRoot = gitTopLevel(path.dirname(prdAbs));
      if (!repoRoot) {
        fail('Ralph requires a git repository to anchor `.ralph/`. Run inside a git repo or pass `--state-dir <path>`.');
      }
      const repoRootReal = fs.realpathSync(repoRoot);
      const relPath = path.relative(repoRootReal, prdAbs);
      if (relPath.startsWith('..')) {
        fail(`PRD ${prd} is outside the resolved repo root ${repoRootReal}`);
      }
      const r = resolvePaths({ repoRoot: repoRootReal, relPath });
      process.stdout.write(JSON.stringify(r) + '\n');
      return;
    }
    default:
      fail(`Unknown command: ${command}\nAvailable: resolve-paths`);
  }
}

main();
```

- [ ] **Step 2: Smoke test from the shell**

Run (from the repo root):
```bash
node lib/state/index.js resolve-paths --prd README.md
```
Expected: a JSON object with `slug` matching `README-[0-9a-f]{4}` and `stateDir` ending in `.ralph/README-XXXX`.

Run (override):
```bash
node lib/state/index.js resolve-paths --prd README.md --state-dir /tmp/foo
```
Expected: `{"stateDir":"/tmp/foo","jsonFile":"/tmp/foo/prd.json", ...,"slug":null,"source":null}`.

- [ ] **Step 3: Commit**

```bash
git add lib/state/index.js
git commit -m "feat(state): add CLI wrapper for path resolver"
```

---

## Task 3: Bash flag parsing

**Files:**
- Modify: `ralph-loop:11-33` (globals), `ralph-loop:247-343` (parse_arguments), `ralph-loop:75-100` (help OPTIONS)

- [ ] **Step 1: Add globals**

Edit `ralph-loop` — in the "Default values" block (around line 11–33), add after the existing `MCP_CONFIG_FILE=""` line:

```bash
STATE_DIR=""
STATE_DIR_OVERRIDE=""
MIGRATE_STATE=false
SOURCE_REL_PATH=""
```

- [ ] **Step 2: Add flag parsing cases**

In `parse_arguments` (around line 247), add two new cases inside the `while` loop, just before the `-*)` catch-all:

```bash
            --state-dir)
                if [ -z "${2:-}" ]; then
                    error_exit "--state-dir requires a path argument" "Example: ./ralph-loop my-prd.md --state-dir /tmp/ralph-state"
                fi
                STATE_DIR_OVERRIDE="$2"
                shift 2
                ;;
            --migrate-state)
                MIGRATE_STATE=true
                shift
                ;;
```

- [ ] **Step 3: Update OPTIONS block in show_help**

In `show_help` (around line 80–100), add inside the `OPTIONS:` block (before `--help`):

```
  --state-dir <path>      Override the .ralph/<slug>/ state directory.
                          Skips repo-root + slug resolution. Works outside
                          a git repo.
  --migrate-state         Move legacy state (sibling JSON, cwd progress.txt)
                          into .ralph/<slug>/ before running. One-shot.
```

- [ ] **Step 4: Verify the help text and a no-op invocation still parse**

Run: `./ralph-loop --help | grep -E 'state-dir|migrate-state'`
Expected: both new flags listed.

Run: `./ralph-loop examples/simple-feature.md --state-dir /tmp/ralph-smoke --dry-run --no-github 2>&1 | head -5`
Expected: no parse error; tool proceeds (will fail later due to missing wiring — that's fine for this step).

- [ ] **Step 5: Commit**

```bash
git add ralph-loop
git commit -m "feat(cli): parse --state-dir and --migrate-state flags"
```

---

## Task 4: `resolve_state_dir` bash function (calls lib/state)

**Files:**
- Modify: `ralph-loop` — new function inserted after `validate_prd_file` (around line 360), call site added in `main` (around line 2982)

- [ ] **Step 1: Add the bash function**

Insert after `validate_prd_file` closes (around line 360, before `convert_prd_to_json`):

```bash
# Resolve the per-PRD state directory: .ralph/<slug>/ at repo root, or the
# user-provided --state-dir. Sets STATE_DIR, JSON_FILE, PROGRESS_FILE,
# MCP_CONFIG_FILE, SOURCE_REL_PATH globals. Writes a .source sentinel and
# verifies it on subsequent runs. Prints a one-time .gitignore hint when
# the top-level .ralph/ is first created.
resolve_state_dir() {
    local resolver_args=(--prd "$PRD_FILE")
    if [ -n "$STATE_DIR_OVERRIDE" ]; then
        resolver_args+=(--state-dir "$STATE_DIR_OVERRIDE")
    fi

    local resolver_json
    if ! resolver_json=$(node "$SCRIPT_DIR/lib/state/index.js" resolve-paths "${resolver_args[@]}" 2>&1); then
        error_exit "Failed to resolve state directory: $resolver_json" \
            "Ensure you are inside a git repo, or pass --state-dir <path>."
    fi

    STATE_DIR=$(echo "$resolver_json" | jq -r '.stateDir')
    JSON_FILE=$(echo "$resolver_json" | jq -r '.jsonFile')
    PROGRESS_FILE=$(echo "$resolver_json" | jq -r '.progressFile')
    MCP_CONFIG_FILE=$(echo "$resolver_json" | jq -r '.mcpConfigFile')
    SOURCE_REL_PATH=$(echo "$resolver_json" | jq -r '.source // ""')

    # Detect first-creation of the top-level .ralph/ for the .gitignore hint.
    local ralph_root_existed=true
    if [ -z "$STATE_DIR_OVERRIDE" ]; then
        local ralph_root="$(dirname "$STATE_DIR")"
        if [ ! -d "$ralph_root" ]; then
            ralph_root_existed=false
        fi
    fi

    mkdir -p "$STATE_DIR"

    if [ "$ralph_root_existed" = false ]; then
        local ralph_root="$(dirname "$STATE_DIR")"
        echo -e "${BLUE}[INFO] Created $ralph_root. Add '.ralph/' to your .gitignore to keep generated state out of version control.${NC}"
    fi

    # Write or verify the .source sentinel for slug-collision detection.
    if [ -n "$SOURCE_REL_PATH" ]; then
        local source_file="$STATE_DIR/.source"
        if [ -f "$source_file" ]; then
            local existing
            existing=$(cat "$source_file")
            if [ "$existing" != "$SOURCE_REL_PATH" ]; then
                error_exit "Slug collision detected for $STATE_DIR" \
                    "This directory was previously used for PRD '$existing' but the current PRD resolves to '$SOURCE_REL_PATH'. Bump the slug hash length: RALPH_SLUG_HASH_LEN=8 ./ralph-loop ..."
            fi
        else
            echo "$SOURCE_REL_PATH" > "$source_file"
        fi
    fi

    if [ "$DEBUG" = true ]; then
        echo -e "${BLUE}[DEBUG] STATE_DIR: $STATE_DIR${NC}"
        echo -e "${BLUE}[DEBUG] JSON_FILE: $JSON_FILE${NC}"
        echo -e "${BLUE}[DEBUG] PROGRESS_FILE: $PROGRESS_FILE${NC}"
    fi
}
```

- [ ] **Step 2: Wire it into `main`**

In `main` (around line 2982), insert immediately after `validate_prd_file` and **before** `convert_prd_to_json`:

```bash
    resolve_state_dir
```

- [ ] **Step 3: Smoke test resolution**

From the repo root:
```bash
rm -rf .ralph
./ralph-loop examples/simple-feature.md --dry-run --no-github 2>&1 | grep -E 'STATE_DIR|Created|gitignore' || true
ls .ralph/
```
Expected: `.ralph/simple-feature-XXXX/` exists with a `.source` file containing `examples/simple-feature.md`. The "[INFO] Created ... .ralph" hint printed exactly once.

Run again:
```bash
./ralph-loop examples/simple-feature.md --dry-run --no-github 2>&1 | grep -E 'Created.*\.ralph' || echo "no hint (correct)"
```
Expected: hint does NOT print on the second run.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): resolve .ralph/<slug>/ via lib/state in main flow"
```

---

## Task 5: Route `convert_prd_to_json` through `JSON_FILE`

**Files:**
- Modify: `ralph-loop:362-386` (head of `convert_prd_to_json`)

- [ ] **Step 1: Replace the prd_dir/json_file derivation**

Find this block at the top of `convert_prd_to_json` (lines 362–367):

```bash
convert_prd_to_json() {
    local prd_dir=$(dirname "$PRD_FILE")
    local prd_basename=$(basename "$PRD_FILE")
    local prd_name="${prd_basename%.*}"
    local json_file="${prd_dir}/${prd_name}.json"
```

Replace with:

```bash
convert_prd_to_json() {
    # JSON_FILE is set by resolve_state_dir; honor that as the canonical path.
    local json_file="$JSON_FILE"
```

The rest of the function stays the same — `JSON_FILE="$json_file"` assignments still work, `cp`/`mv` now target `.ralph/<slug>/prd.json`.

- [ ] **Step 2: Verify a fresh conversion lands in .ralph/**

```bash
rm -rf .ralph
./ralph-loop examples/simple-feature.md --dry-run --no-github 2>&1 | tail -20
ls .ralph/simple-feature-*/prd.json
```
Expected: `prd.json` exists inside the slug dir. No JSON file appears next to `examples/simple-feature.md`.

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): write converted PRD JSON into .ralph/<slug>/prd.json"
```

---

## Task 6: Route progress file paths through `PROGRESS_FILE` / `STATE_DIR`

**Files:**
- Modify: `ralph-loop` lines 1714–1717, 1755–1758, 1776–1782, 3014–3016

- [ ] **Step 1: Update `prompt_resume_or_fresh`**

Replace lines ~1714–1717:

```bash
prompt_resume_or_fresh() {
    local prd_dir=$(dirname "$JSON_FILE")
    local progress_file="${prd_dir}/progress.txt"
```

with:

```bash
prompt_resume_or_fresh() {
    local progress_file="$PROGRESS_FILE"
```

- [ ] **Step 2: Update `initialize_progress_file`**

Replace lines ~1755–1758:

```bash
initialize_progress_file() {
    local prd_dir=$(dirname "$JSON_FILE")
    local progress_file="${prd_dir}/progress.txt"
```

with:

```bash
initialize_progress_file() {
    local progress_file="$PROGRESS_FILE"
```

Then in the same function, the archive line (around line 1778):

```bash
        local archive_file="${prd_dir}/progress-${timestamp}.txt"
```

becomes:

```bash
        local archive_file="${STATE_DIR}/progress-${timestamp}.txt"
```

- [ ] **Step 3: Update the `--report` call site**

Replace lines ~3014–3016 in `main`:

```bash
        local prd_dir
        prd_dir="$(dirname "$JSON_FILE")"
        run_report "$JSON_FILE" "${prd_dir}/progress.txt"
```

with:

```bash
        run_report "$JSON_FILE" "$PROGRESS_FILE"
```

- [ ] **Step 4: Smoke test**

```bash
rm -rf .ralph
./ralph-loop examples/simple-feature.md --no-github --dry-run 2>&1 | tail -5
ls .ralph/simple-feature-*/
```
Expected: `prd.json` plus (after a real run, not dry-run) `progress.txt`. Confirm no `progress.txt` appears in cwd.

For the actual progress file creation, run a `--report` after a prior real run if you have one available; otherwise this step verifies path wiring through inspection.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): route progress.txt through .ralph/<slug>/"
```

---

## Task 7: Route MCP config + sidecar log into `STATE_DIR`

**Files:**
- Modify: `ralph-loop:2375-2386` (MCP config write), `ralph-loop:2650-2654` (sidecar log)

- [ ] **Step 1: Update MCP config write**

Replace lines ~2375–2386:

```bash
    # Generate MCP config once per run, alongside progress.txt.
    if [ "$MCP_ENABLED" = true ]; then
        local prd_dir
        prd_dir="$(dirname "$JSON_FILE")"
        MCP_CONFIG_FILE="${prd_dir}/mcp-config.json"
        if ! node "$SCRIPT_DIR/lib/mcp/index.js" write-config --output "$MCP_CONFIG_FILE" > /dev/null; then
            error_exit "Failed to write MCP config to $MCP_CONFIG_FILE" "Check filesystem permissions and rerun."
        fi
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[VERBOSE] MCP enabled; config at $MCP_CONFIG_FILE${NC}"
        fi
    fi
```

with:

```bash
    # Generate MCP config once per run; MCP_CONFIG_FILE is set by resolve_state_dir.
    if [ "$MCP_ENABLED" = true ]; then
        if ! node "$SCRIPT_DIR/lib/mcp/index.js" write-config --output "$MCP_CONFIG_FILE" > /dev/null; then
            error_exit "Failed to write MCP config to $MCP_CONFIG_FILE" "Check filesystem permissions and rerun."
        fi
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[VERBOSE] MCP enabled; config at $MCP_CONFIG_FILE${NC}"
        fi
    fi
```

- [ ] **Step 2: Update the sidecar log path**

Replace lines ~2650–2654:

```bash
            # Sidecar log for debuggability
            local prd_dir
            prd_dir="$(dirname "$JSON_FILE")"
            echo "$claude_output" | grep -Ei 'mcpls|(^|[^a-z])mcp([^a-z]|$)' \
                > "${prd_dir}/mcp-iteration-${iteration}.log" 2>/dev/null || true
```

with:

```bash
            # Sidecar log for debuggability
            echo "$claude_output" | grep -Ei 'mcpls|(^|[^a-z])mcp([^a-z]|$)' \
                > "${STATE_DIR}/mcp-iteration-${iteration}.log" 2>/dev/null || true
```

- [ ] **Step 3: Smoke test**

```bash
rm -rf .ralph
./ralph-loop examples/simple-feature.md --mcp --no-github --dry-run 2>&1 | grep -Ei 'mcp|state' | head -5
ls .ralph/simple-feature-*/mcp-config.json 2>/dev/null && echo "ok"
```
Expected: MCP config file written under `.ralph/<slug>/mcp-config.json`. (Skip the smoke test entirely if `mcpls` is not installed — `--mcp` will exit before this point.)

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): route MCP config and iteration logs into .ralph/<slug>/"
```

---

## Task 8: Legacy detection helper

**Files:**
- Modify: `ralph-loop` — new function inserted after `resolve_state_dir`

- [ ] **Step 1: Add the function**

Insert after `resolve_state_dir` closes:

```bash
# Print legacy state paths (one per line) for the current PRD. Used by both
# pre-flight and migration. Skipped when STATE_DIR_OVERRIDE is set.
detect_legacy_state() {
    if [ -n "$STATE_DIR_OVERRIDE" ]; then
        return 0
    fi

    local prd_dir
    prd_dir="$(dirname "$PRD_FILE")"
    local prd_basename
    prd_basename="$(basename "$PRD_FILE")"
    local prd_name="${prd_basename%.*}"

    # Sibling JSON: skip when the PRD itself IS the JSON.
    if [[ ! "$PRD_FILE" =~ \.json$ ]]; then
        local sibling_json="${prd_dir}/${prd_name}.json"
        if [ -f "$sibling_json" ]; then
            echo "$sibling_json"
        fi
    fi

    # cwd progress.txt
    if [ -f "./progress.txt" ]; then
        echo "./progress.txt"
    fi

    # cwd progress-*.txt archives
    local archive
    for archive in ./progress-*.txt; do
        [ -e "$archive" ] || continue
        echo "$archive"
    done
}
```

- [ ] **Step 2: Smoke test detection**

```bash
mkdir -p /tmp/ralph-legacy && cd /tmp/ralph-legacy
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.md .
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.json .
touch progress.txt progress-20260101-000000.txt
bash -c 'PRD_FILE="./simple-feature.md"; STATE_DIR_OVERRIDE=""; source /Users/orlandogarcia/numeron/ralph-loop/ralph-loop; detect_legacy_state' 2>/dev/null
cd - >/dev/null
```
Expected output (sourcing path may need adjustment for your environment — manual check is fine): three lines listing the sibling JSON, `./progress.txt`, and the archive.

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): add detect_legacy_state helper"
```

---

## Task 9: Pre-flight `enforce_no_legacy`

**Files:**
- Modify: `ralph-loop` — new function inserted after `detect_legacy_state`, call site in `main`

- [ ] **Step 1: Add the function**

```bash
# Hard-error if legacy state exists for this PRD AND STATE_DIR is empty AND
# neither --migrate-state nor --state-dir was passed. Prevents silent orphaning.
enforce_no_legacy() {
    if [ -n "$STATE_DIR_OVERRIDE" ] || [ "$MIGRATE_STATE" = true ]; then
        return 0
    fi

    # If STATE_DIR already has any canonical file, the user is past migration.
    if [ -f "$STATE_DIR/prd.json" ] || [ -f "$STATE_DIR/progress.txt" ]; then
        return 0
    fi

    local legacy
    legacy="$(detect_legacy_state)"
    if [ -z "$legacy" ]; then
        return 0
    fi

    local indented
    indented="$(echo "$legacy" | sed 's/^/  - /')"

    error_exit "Found legacy Ralph state for this PRD:
$indented

Ralph now stores state under .ralph/<slug>/." \
"Pick one:
  --migrate-state          Move legacy files into $STATE_DIR
  --state-dir <path>       Keep using a custom location

To start fresh and ignore the legacy files, delete or move them yourself."
}
```

- [ ] **Step 2: Wire into `main`**

In `main`, immediately after the `resolve_state_dir` call you added in Task 4, add:

```bash
    enforce_no_legacy
```

(It must run before `convert_prd_to_json` so a legacy sibling JSON doesn't get silently picked up.)

- [ ] **Step 3: Verify the hard-error fires**

```bash
mkdir -p /tmp/ralph-legacy-check && cd /tmp/ralph-legacy-check
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.md .
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.json .
git init -q
/Users/orlandogarcia/numeron/ralph-loop/ralph-loop ./simple-feature.md --no-github --dry-run 2>&1 | head -15
echo "exit=$?"
cd - >/dev/null
rm -rf /tmp/ralph-legacy-check
```
Expected: error message listing the sibling JSON, suggesting `--migrate-state` or `--state-dir`. Exit code non-zero.

Then verify the override bypasses it:

```bash
mkdir -p /tmp/ralph-legacy-check && cd /tmp/ralph-legacy-check
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.md .
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.json .
git init -q
/Users/orlandogarcia/numeron/ralph-loop/ralph-loop ./simple-feature.md --no-github --dry-run --state-dir /tmp/ralph-state-2 2>&1 | tail -5
echo "exit=$?"
cd - >/dev/null
rm -rf /tmp/ralph-legacy-check /tmp/ralph-state-2
```
Expected: no legacy error; tool runs through dry-run.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): block runs when legacy state present without migration flag"
```

---

## Task 10: `migrate_legacy_state` function

**Files:**
- Modify: `ralph-loop` — new function inserted after `enforce_no_legacy`, call site in `main`

- [ ] **Step 1: Add the function**

```bash
# When --migrate-state is set, move legacy files into STATE_DIR using `git mv`
# for tracked files and plain `mv` otherwise. Sibling <basename>.json renames
# to prd.json; progress.txt and archives keep their names. Hard-error if any
# canonical file already exists at the destination.
migrate_legacy_state() {
    if [ "$MIGRATE_STATE" != true ]; then
        return 0
    fi

    local legacy
    legacy="$(detect_legacy_state)"
    if [ -z "$legacy" ]; then
        echo -e "${BLUE}[INFO] --migrate-state: no legacy files found; nothing to do.${NC}"
        return 0
    fi

    # Refuse if destination already has canonical files.
    local existing
    existing="$(find "$STATE_DIR" -maxdepth 1 -type f \( -name 'prd.json' -o -name 'progress.txt' -o -name 'progress-*.txt' \) 2>/dev/null)"
    if [ -n "$existing" ]; then
        error_exit "Destination already populated; refusing to overwrite:
$(echo "$existing" | sed 's/^/  - /')" \
            "Inspect $STATE_DIR and remove conflicting files manually if you want to re-migrate."
    fi

    echo -e "${BLUE}[INFO] Migrating legacy state into $STATE_DIR${NC}"
    echo "  Source                                Destination                    Transport"

    local prd_dir
    prd_dir="$(dirname "$PRD_FILE")"
    local prd_basename
    prd_basename="$(basename "$PRD_FILE")"
    local prd_name="${prd_basename%.*}"
    local sibling_json="${prd_dir}/${prd_name}.json"

    local file
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        local dest
        if [ "$file" = "$sibling_json" ]; then
            dest="$STATE_DIR/prd.json"
        else
            dest="$STATE_DIR/$(basename "$file")"
        fi

        local transport="mv"
        if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
            if git mv "$file" "$dest" 2>/dev/null; then
                transport="git mv"
            else
                # Fall back to plain mv if git mv fails (e.g., dest path quirks).
                mv "$file" "$dest"
            fi
        else
            mv "$file" "$dest"
        fi

        printf "  %-37s %-30s %s\n" "$file" "$dest" "$transport"
    done <<< "$legacy"

    echo -e "${GREEN}✓${NC} Migration complete."
}
```

- [ ] **Step 2: Wire into `main`**

In `main`, immediately after `enforce_no_legacy`, add:

```bash
    migrate_legacy_state
```

(Order: `resolve_state_dir` → `enforce_no_legacy` → `migrate_legacy_state` → `convert_prd_to_json`.)

- [ ] **Step 3: End-to-end migration test**

```bash
rm -rf /tmp/ralph-mig && mkdir -p /tmp/ralph-mig && cd /tmp/ralph-mig
git init -q && git commit -q --allow-empty -m init
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.md .
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.json .
touch progress.txt progress-20260101-000000.txt
git add . && git commit -q -m "seed"
/Users/orlandogarcia/numeron/ralph-loop/ralph-loop ./simple-feature.md --migrate-state --no-github --dry-run 2>&1 | tail -20
echo "---"
ls -la
ls .ralph/simple-feature-*/
cd - >/dev/null
rm -rf /tmp/ralph-mig
```
Expected: migration summary printed; cwd no longer contains `simple-feature.json`, `progress.txt`, `progress-*.txt`; `.ralph/<slug>/` contains `prd.json`, `progress.txt`, `progress-20260101-000000.txt`.

Verify the destination-conflict error:

```bash
rm -rf /tmp/ralph-mig2 && mkdir -p /tmp/ralph-mig2 && cd /tmp/ralph-mig2
git init -q
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.md .
cp /Users/orlandogarcia/numeron/ralph-loop/examples/simple-feature.json .
touch progress.txt
SLUG=$(node /Users/orlandogarcia/numeron/ralph-loop/lib/state/index.js resolve-paths --prd ./simple-feature.md | jq -r .slug)
mkdir -p ".ralph/$SLUG" && touch ".ralph/$SLUG/prd.json"
/Users/orlandogarcia/numeron/ralph-loop/ralph-loop ./simple-feature.md --migrate-state --no-github --dry-run 2>&1 | head -10
echo "exit=$?"
cd - >/dev/null
rm -rf /tmp/ralph-mig2
```
Expected: hard-error mentioning "Destination already populated".

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(state): add --migrate-state to move legacy files into .ralph/"
```

---

## Task 11: Refresh help text and inline references

**Files:**
- Modify: `ralph-loop:69, 84, 218, 224-226` (help text mentions of `progress.txt` / `your-prd.json`)

- [ ] **Step 1: Update the QUICK START step 3**

Around line 68–69, replace:

```
3. REVIEW RESULTS
   Check progress.txt for detailed logs and your-prd.json for final status.
```

with:

```
3. REVIEW RESULTS
   Check .ralph/<slug>/progress.txt for detailed logs and
   .ralph/<slug>/prd.json for final status.
```

- [ ] **Step 2: Update `--resume` description**

Around line 84, replace:

```
  --resume                Resume from last checkpoint in progress.txt
```

with:

```
  --resume                Resume from last checkpoint in .ralph/<slug>/progress.txt
```

- [ ] **Step 3: Update the "Check progress.txt" hint**

Around line 218, replace:

```
• Check progress.txt regularly to see detailed logs
```

with:

```
• Check .ralph/<slug>/progress.txt regularly to see detailed logs
```

- [ ] **Step 4: Update the FILES CREATED block**

Around lines 224–226, replace:

```
  your-prd.json          Converted PRD with task status
  progress.txt           Detailed iteration logs and learnings
  progress-*.txt         Archived logs from previous runs
```

with:

```
  .ralph/<slug>/prd.json          Converted PRD with task status
  .ralph/<slug>/progress.txt      Detailed iteration logs and learnings
  .ralph/<slug>/progress-*.txt    Archived logs from previous runs
  .ralph/<slug>/.source           Sentinel: repo-relative PRD path
```

- [ ] **Step 5: Smoke test**

Run: `./ralph-loop --help | grep -E '\.ralph|state-dir|migrate-state'`
Expected: all the new strings appear.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop
git commit -m "docs(cli): update help text for .ralph/<slug>/ layout"
```

---

## Task 12: Bash integration tests for state paths

**Files:**
- Create: `tests/test-state-paths.sh`
- Modify: `tests/test-all.sh` (add the new script to the runner)

- [ ] **Step 1: Write the integration test**

```bash
#!/usr/bin/env bash
# tests/test-state-paths.sh — verify .ralph/<slug>/ layout, legacy detection,
# migration semantics, and --state-dir override.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH="$SCRIPT_DIR/../ralph-loop"
EXAMPLE_MD="$SCRIPT_DIR/../examples/simple-feature.md"
EXAMPLE_JSON="$SCRIPT_DIR/../examples/simple-feature.json"

PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); }

setup_temp_repo() {
    local d
    d="$(mktemp -d)"
    (cd "$d" && git init -q && git commit -q --allow-empty -m init)
    cp "$EXAMPLE_MD" "$d/"
    echo "$d"
}

cleanup() { rm -rf "$1"; }

echo "=== State Paths Tests ==="

# Test 1: fresh run creates .ralph/<slug>/ with canonical files
{
    DIR="$(setup_temp_repo)"
    pushd "$DIR" >/dev/null
    "$RALPH" ./simple-feature.md --no-github --dry-run >/dev/null 2>&1 || true
    if compgen -G ".ralph/simple-feature-*/prd.json" >/dev/null; then
        pass "fresh run creates .ralph/<slug>/prd.json"
    else
        fail "fresh run did NOT create .ralph/<slug>/prd.json"
    fi
    if compgen -G ".ralph/simple-feature-*/.source" >/dev/null; then
        pass ".source sentinel written"
    else
        fail ".source sentinel missing"
    fi
    popd >/dev/null
    cleanup "$DIR"
}

# Test 2: slug is deterministic across runs
{
    DIR="$(setup_temp_repo)"
    pushd "$DIR" >/dev/null
    "$RALPH" ./simple-feature.md --no-github --dry-run >/dev/null 2>&1 || true
    SLUG1="$(ls .ralph)"
    rm -rf .ralph
    "$RALPH" ./simple-feature.md --no-github --dry-run >/dev/null 2>&1 || true
    SLUG2="$(ls .ralph)"
    if [ "$SLUG1" = "$SLUG2" ]; then
        pass "slug is deterministic ($SLUG1)"
    else
        fail "slug changed between runs ($SLUG1 vs $SLUG2)"
    fi
    popd >/dev/null
    cleanup "$DIR"
}

# Test 3: legacy state without flag → hard error
{
    DIR="$(setup_temp_repo)"
    pushd "$DIR" >/dev/null
    cp "$EXAMPLE_JSON" ./simple-feature.json
    touch progress.txt
    if "$RALPH" ./simple-feature.md --no-github --dry-run >/dev/null 2>&1; then
        fail "legacy state should have caused hard error"
    else
        pass "legacy state without flag → exit non-zero"
    fi
    popd >/dev/null
    cleanup "$DIR"
}

# Test 4: --migrate-state moves files into .ralph/<slug>/
{
    DIR="$(setup_temp_repo)"
    pushd "$DIR" >/dev/null
    cp "$EXAMPLE_JSON" ./simple-feature.json
    touch progress.txt progress-20260101-000000.txt
    "$RALPH" ./simple-feature.md --migrate-state --no-github --dry-run >/dev/null 2>&1 || true
    if [ ! -f "./simple-feature.json" ] && [ ! -f "./progress.txt" ]; then
        pass "legacy files removed from cwd"
    else
        fail "legacy files still present in cwd"
    fi
    if compgen -G ".ralph/simple-feature-*/prd.json" >/dev/null \
       && compgen -G ".ralph/simple-feature-*/progress.txt" >/dev/null \
       && compgen -G ".ralph/simple-feature-*/progress-20260101-000000.txt" >/dev/null; then
        pass "files moved into .ralph/<slug>/"
    else
        fail "migration destination missing files"
    fi
    popd >/dev/null
    cleanup "$DIR"
}

# Test 5: --migrate-state with destination conflict → hard error
{
    DIR="$(setup_temp_repo)"
    pushd "$DIR" >/dev/null
    cp "$EXAMPLE_JSON" ./simple-feature.json
    touch progress.txt
    SLUG=$(node "$SCRIPT_DIR/../lib/state/index.js" resolve-paths --prd ./simple-feature.md | jq -r .slug)
    mkdir -p ".ralph/$SLUG"
    echo '{}' > ".ralph/$SLUG/prd.json"
    if "$RALPH" ./simple-feature.md --migrate-state --no-github --dry-run >/dev/null 2>&1; then
        fail "conflicting destination should have errored"
    else
        pass "destination conflict → exit non-zero"
    fi
    popd >/dev/null
    cleanup "$DIR"
}

# Test 6: --state-dir bypasses legacy detection and works outside git
{
    DIR="$(mktemp -d)"
    cp "$EXAMPLE_MD" "$DIR/"
    cp "$EXAMPLE_JSON" "$DIR/"
    SD="$(mktemp -d)"
    pushd "$DIR" >/dev/null
    if "$RALPH" ./simple-feature.md --state-dir "$SD" --no-github --dry-run >/dev/null 2>&1; then
        pass "--state-dir works outside git repo and bypasses legacy check"
    else
        fail "--state-dir invocation failed"
    fi
    if [ -f "$SD/prd.json" ]; then
        pass "prd.json written to --state-dir"
    else
        fail "prd.json missing in --state-dir"
    fi
    popd >/dev/null
    cleanup "$DIR"
    cleanup "$SD"
}

# Test 7: slug-collision sentinel triggers hard error
{
    DIR="$(setup_temp_repo)"
    pushd "$DIR" >/dev/null
    "$RALPH" ./simple-feature.md --no-github --dry-run >/dev/null 2>&1 || true
    SLUG_DIR="$(ls -d .ralph/simple-feature-* | head -1)"
    echo "some/other/path.md" > "$SLUG_DIR/.source"
    if "$RALPH" ./simple-feature.md --no-github --dry-run >/dev/null 2>&1; then
        fail "slug collision should have errored"
    else
        pass "slug collision → exit non-zero"
    fi
    popd >/dev/null
    cleanup "$DIR"
}

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x tests/test-state-paths.sh`

- [ ] **Step 3: Wire it into the test runner**

Open `tests/test-all.sh`, find the existing block that invokes individual `tests/test-*.sh` scripts, and add a line for `tests/test-state-paths.sh` in the same style as its neighbors. (The exact pattern depends on the runner's loop or explicit list — match what's already there.)

- [ ] **Step 4: Run the new test suite**

Run: `./tests/test-state-paths.sh`
Expected: `Results: 7 passed, 0 failed` and exit 0.

Run: `./tests/test-all.sh` and confirm the new script is invoked and passes.

- [ ] **Step 5: Commit**

```bash
git add tests/test-state-paths.sh tests/test-all.sh
git commit -m "test(state): integration tests for .ralph/<slug>/ layout and migration"
```

---

## Task 13: Update existing tests that hard-code legacy paths

**Files:**
- Modify: any test file that creates a sibling `<basename>.json` next to a PRD or expects `progress.txt` in cwd.

- [ ] **Step 1: Identify the call sites**

Run:
```bash
grep -nE 'progress\.txt|\.json"' tests/*.sh | grep -v test-state-paths
```

For each match, decide:
- If the test is constructing a sibling JSON intentionally (legacy assumption), it must be updated.
- If the test passes a PRD and then expects `progress.txt` in cwd, it must be updated.

The fix in every case is to pass `--state-dir <tempdir>` to `ralph-loop` invocations and read paths from there. Tests are not exercising the layout — they're testing the loop — so an explicit override is the cleanest fix.

- [ ] **Step 2: Update each affected test**

For each test that invokes `./ralph-loop ... <prd>`, change the invocation to:

```bash
STATE_TMP="$(mktemp -d)"
./ralph-loop "$PRD" --state-dir "$STATE_TMP" [other flags...]
# Then read $STATE_TMP/progress.txt or $STATE_TMP/prd.json instead of legacy paths
```

Add `rm -rf "$STATE_TMP"` to the test's cleanup section.

- [ ] **Step 3: Run the full bash test suite**

Run: `./tests/test-all.sh`
Expected: all tests pass. If any fail, fix the legacy path assumption in that test.

- [ ] **Step 4: Run the JS test suite**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: route bash tests through --state-dir to isolate from .ralph/"
```

---

## Task 14: Documentation updates

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README — add a "State directory" section**

Find an appropriate spot (near the existing "Files Created" or "Configuration" content) and add:

```markdown
## State directory

Ralph stores all generated state for a PRD in a single directory at the repo root:

```
.ralph/<basename>-<hash4>/
├── prd.json                      # converted/working PRD JSON
├── progress.txt                  # current run's progress log
├── progress-<timestamp>.txt      # archived logs from prior runs
├── mcp-config.json               # written when --mcp is set
├── mcp-iteration-N.log           # sidecar for degraded MCP iterations
└── .source                       # repo-relative PRD path (collision sentinel)
```

The slug is `<basename>-<hash4>`, where `hash4` is the first 4 hex chars of `sha1(repo-relative PRD path)`. This is deterministic and survives reruns; rename or move the PRD and the slug changes.

**Add `.ralph/` to your `.gitignore`** to keep generated state out of version control. Ralph prints a one-time hint on first creation but does not modify `.gitignore` for you.

### Migrating from the old layout

Earlier versions wrote `<basename>.json` next to the markdown PRD and `progress.txt` in cwd. If you have a PRD with that legacy state, Ralph will refuse to run until you choose:

- `--migrate-state` — move the legacy files into `.ralph/<slug>/` and continue. Uses `git mv` for tracked files. One-shot; subsequent runs work normally.
- `--state-dir <path>` — keep using a custom location. Skips the slug/repo-root logic entirely and works outside a git repo.

To start fresh and ignore the legacy files, delete or move them yourself.

### Slug collisions

A 4-char hash means ~1-in-65k odds of two PRDs sharing a basename colliding. Ralph stores the source path inside `.ralph/<slug>/.source` and verifies it on every run; on mismatch you'll see a hard error suggesting `RALPH_SLUG_HASH_LEN=8` (any value 4–40 works).
```

- [ ] **Step 2: CLAUDE.md — update Run the tool**

Find the existing usage line and add the new flags:

```markdown
./ralph-loop <prd-file.md> [--max-iterations N] [--verbose] [--debug] [--resume] \
  [--analyze-prd] [--dry-run] [--no-github] [--no-branch] [--repo owner/name] \
  [--mcp] [--report] [--state-dir <path>] [--migrate-state]
```

- [ ] **Step 3: CLAUDE.md — add a Key conventions bullet**

In the "Key conventions" section, add a new bullet (group it with the other state-related bullets):

```markdown
- All generated state lives in `.ralph/<basename>-<hash4>/` at the repo root: `prd.json`, `progress.txt`, `progress-*.txt`, `mcp-config.json`, `mcp-iteration-N.log`, and a `.source` sentinel. The slug hashes the repo-relative PRD path. Override with `--state-dir <path>`; migrate legacy sibling-JSON / cwd-progress with `--migrate-state`. Ralph hard-errors when legacy state is present without one of those flags.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document .ralph/<slug>/ state directory and migration flags"
```

---

## Self-Review

**Spec coverage:**
- Decision 1 (repo-root `.ralph/<slug>/`) → Tasks 1, 4
- Decision 2 (git rev-parse anchor, hard error) → Tasks 1, 2
- Decision 3 (`<basename>-<hash4>`, sha1, env override) → Task 1
- Decision 4 (canonical filenames) → Tasks 1, 5–7
- Decision 5 (new layout default) → Tasks 4–7
- Decision 6 (hard error on legacy without flag) → Task 9
- Decision 7 (`.gitignore` hint, no mutation) → Task 4
- Decision 8 (`--migrate-state` with `git mv`) → Task 10
- Decision 9 (destination-populated hard error) → Task 10
- Decision 10 (`--state-dir` overrides everything) → Tasks 1, 2, 3, 4, 8, 9
- `.source` sentinel + collision detection → Task 4
- Pre-flight detection set (sibling JSON / cwd progress / cwd archives) → Task 8
- Tests, README, CLAUDE.md → Tasks 12, 13, 14

**Placeholder scan:** No "TBD"/"TODO" placeholders. Every code-changing step shows the exact code or exact diff. Test scripts are complete.

**Type/name consistency:** `STATE_DIR`, `JSON_FILE`, `PROGRESS_FILE`, `MCP_CONFIG_FILE`, `STATE_DIR_OVERRIDE`, `MIGRATE_STATE`, `SOURCE_REL_PATH` are used consistently. `resolvePaths` returns `{stateDir, jsonFile, progressFile, mcpConfigFile, slug, source}` and bash reads exactly those keys via `jq`. The CLI command `resolve-paths` matches between Task 2 (definition) and Task 4 (consumer).

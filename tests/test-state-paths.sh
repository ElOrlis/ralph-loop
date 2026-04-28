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

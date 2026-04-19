#!/usr/bin/env bash
# tests/fixtures/mock-git.sh — minimal fake `git` for Phase 5 integration tests.
# Logs every invocation to MOCK_GIT_CALL_LOG and returns canned state.
set -euo pipefail

: "${MOCK_GIT_CALL_LOG:=/tmp/mock-git-calls.log}"
echo "$*" >> "$MOCK_GIT_CALL_LOG"

case "${1:-}" in
    rev-parse)
        case "${2:-}" in
            --abbrev-ref) echo "main" ;;
            HEAD)         echo "abc1234567890abcdef0000000000000000000" ;;
            *)            echo "abc1234567890abcdef0000000000000000000" ;;
        esac
        exit 0
        ;;
    show-ref)
        # Always report branch missing so ensure-branch proceeds to create it.
        # Tests that need richer behavior can override this fixture per-test.
        exit 1
        ;;
    branch)
        exit 0
        ;;
    checkout|switch)
        exit 0
        ;;
    diff)
        exit 0
        ;;
    ls-files)
        echo ""
        exit 0
        ;;
    stash)
        case "${2:-}" in
            push) echo "Saved working directory and index state" ;;
            pop)  echo "Dropped refs/stash@{0}" ;;
            *)    echo "" ;;
        esac
        exit 0
        ;;
    add)
        exit 0
        ;;
    commit)
        exit 0
        ;;
    push)
        exit 0
        ;;
    *)
        # Fall back to silent success for unknown subcommands
        exit 0
        ;;
esac

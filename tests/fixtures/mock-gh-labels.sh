#!/usr/bin/env bash
# tests/fixtures/mock-gh-labels.sh — minimal fake `gh` for Phase 6 label tests.
# Logs every invocation to MOCK_GH_CALL_LOG and returns canned output.
set -euo pipefail

: "${MOCK_GH_CALL_LOG:=/tmp/mock-gh-calls.log}"
echo "$*" >> "$MOCK_GH_CALL_LOG"

case "${1:-}" in
    issue)
        case "${2:-}" in
            edit)    exit 0 ;;
            comment) exit 0 ;;
            view)    echo '{"state":"OPEN"}' ; exit 0 ;;
            create)  echo 'https://github.com/o/r/issues/1' ; exit 0 ;;
            *)       exit 0 ;;
        esac
        ;;
    auth)   echo "Logged in to github.com" ; exit 0 ;;
    api)    echo "{}" ; exit 0 ;;
    pr)     exit 0 ;;
    *)      exit 0 ;;
esac

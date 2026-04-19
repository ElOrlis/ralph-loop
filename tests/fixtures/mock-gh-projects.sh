#!/usr/bin/env bash
# Mock `gh` CLI for Projects v2 tests. Replays canned JSON replies based on args.
set -euo pipefail

# Count calls in a sidecar file so tests can assert on totals.
: "${MOCK_GH_CALL_LOG:=/tmp/mock-gh-projects-calls.log}"
echo "$*" >> "$MOCK_GH_CALL_LOG"

if [ "${1:-}" = "api" ] && [ "${2:-}" = "graphql" ]; then
    # Pull out query and variable values from: -f query='...' -f key=value -F key=value
    query_arg=""
    dataType_arg=""
    for arg in "$@"; do
        case "$arg" in
            query=*)    query_arg="${arg#query=}" ;;
            dataType=*) dataType_arg="${arg#dataType=}" ;;
        esac
    done
    case "$query_arg" in
        *"user(login:"*)
            echo '{"data":{"user":{"id":"U_test"},"organization":null}}' ;;
        *"createProjectV2Field"*)
            # Distinguish by the dataType variable, not the query text (both contain SINGLE_SELECT fragment).
            if [ "$dataType_arg" = "SINGLE_SELECT" ]; then
                echo '{"data":{"createProjectV2Field":{"projectV2Field":{"id":"PVTF_ss","options":[{"id":"opt_a","name":"A"},{"id":"opt_b","name":"B"},{"id":"opt_pending","name":"Pending"},{"id":"opt_inprog","name":"In Progress"},{"id":"opt_passed","name":"Passed"},{"id":"opt_failed","name":"Failed"},{"id":"opt_stalled","name":"Stalled"}]}}}}'
            else
                echo '{"data":{"createProjectV2Field":{"projectV2Field":{"id":"PVTF_num"}}}}'
            fi
            ;;
        *"createProjectV2"*)
            echo '{"data":{"createProjectV2":{"projectV2":{"id":"PVT_test","number":99,"url":"https://example.test/projects/99"}}}}' ;;
        *"addProjectV2ItemById"*)
            echo '{"data":{"addProjectV2ItemById":{"item":{"id":"PVTI_test"}}}}' ;;
        *"updateProjectV2ItemFieldValue"*)
            echo '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_test"}}}}' ;;
        *"issue(number:"*)
            echo '{"data":{"repository":{"issue":{"id":"I_test"}}}}' ;;
        *"fields(first:"*)
            echo '{"data":{"node":{"fields":{"nodes":[{"id":"PVTF_num","name":"Priority","dataType":"NUMBER"},{"id":"PVTF_ss","name":"Category","dataType":"SINGLE_SELECT","options":[{"id":"opt_a","name":"Backend"}]},{"id":"PVTF_ic","name":"Iteration Count","dataType":"NUMBER"},{"id":"PVTF_cp","name":"Criteria Pass Rate","dataType":"NUMBER"},{"id":"PVTF_rs","name":"Ralph Status","dataType":"SINGLE_SELECT","options":[{"id":"opt_pending","name":"Pending"}]}]}}}}' ;;
        *"fieldValues(first:"*)
            echo '{"data":{"node":{"fieldValues":{"nodes":[{"field":{"id":"PVTF_cp"},"number":0.5}]}}}}' ;;
        *)
            echo '{"data":{}}' ;;
    esac
    exit 0
fi

# Fallback for non-graphql invocations (issue create/view/etc): produce benign outputs.
case "${1:-}" in
    issue)
        case "${2:-}" in
            create) echo "https://github.com/test/repo/issues/99" ;;
            view)   echo "OPEN" ;;
            *)      echo "" ;;
        esac
        ;;
    auth) echo "Logged in" ;;
    *) echo "" ;;
esac
exit 0

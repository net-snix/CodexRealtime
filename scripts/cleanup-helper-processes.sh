#!/usr/bin/env bash
set -euo pipefail

readonly MCP_REGEX='npm exec @playwright/mcp@latest|node .*@playwright/mcp|npm exec xcodebuildmcp@latest mcp|node .*xcodebuildmcp.* mcp'

matches=()
while IFS= read -r line; do
  [[ -n "$line" ]] && matches+=("$line")
done < <(pgrep -af "$MCP_REGEX" || true)

if [[ ${#matches[@]} -eq 0 ]]; then
  echo "No stale Playwright/xcodebuildmcp helper processes found."
  exit 0
fi

echo "Found helper processes:"
printf '  %s\n' "${matches[@]}"

pids=()
while IFS= read -r line; do
  [[ -n "$line" ]] && pids+=("$line")
done < <(printf '%s\n' "${matches[@]}" | awk '{ print $1 }' | sort -u)

kill "${pids[@]}" 2>/dev/null || true
sleep 1

still_running=()
while IFS= read -r line; do
  [[ -n "$line" ]] && still_running+=("$line")
done < <(pgrep -af "$MCP_REGEX" || true)

if [[ ${#still_running[@]} -gt 0 ]]; then
  echo "Escalating to SIGKILL for stubborn processes..."
  stubborn_pids=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && stubborn_pids+=("$line")
  done < <(printf '%s\n' "${still_running[@]}" | awk '{ print $1 }' | sort -u)
  kill -9 "${stubborn_pids[@]}" 2>/dev/null || true
  sleep 1
fi

remaining=()
while IFS= read -r line; do
  [[ -n "$line" ]] && remaining+=("$line")
done < <(pgrep -af "$MCP_REGEX" || true)

if [[ ${#remaining[@]} -gt 0 ]]; then
  echo "Some helper processes are still running:"
  printf '  %s\n' "${remaining[@]}"
  exit 1
fi

echo "Helper process cleanup complete."

#!/usr/bin/env bash
#
# OpenClaw Jelastic package smoke tests.
# Run on the cp (Docker Engine) node after install or redeploy.
#
# Usage:
#   ./tests/smoke-test.sh
#   ./tests/smoke-test.sh --domain myenv.demo.jelastic.com
#   ./tests/smoke-test.sh --token oc_xxxxxxxx --verbose
#
# See tests/test-cases.md for full manual test matrix.
#
# Environment overrides:
#   PUBLIC_PORT=80 CONTAINER_NAME=openclaw STATE_DIR=/data/openclaw ./tests/smoke-test.sh

set -uo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-openclaw}"
PUBLIC_PORT="${PUBLIC_PORT:-80}"
CONTAINER_PORT="${CONTAINER_PORT:-18789}"
STATE_DIR="${STATE_DIR:-/data/openclaw}"
RUNTIME_IMAGE="${RUNTIME_IMAGE:-openclaw-node:22-bullseye-slim}"

DOMAIN=""
EXPECTED_TOKEN="${OPENCLAW_EXPECTED_TOKEN:-}"
VERBOSE=0
USE_COLOR=1

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
WARN_COUNT=0

usage() {
  cat <<'EOF'
OpenClaw Jelastic smoke test

Options:
  --domain HOST     HTTPS check against https://HOST/ (optional)
  --token TOKEN     Compare gateway.auth.token with TOKEN from access card
  --no-color        Disable ANSI colors
  --verbose, -v     Print extra diagnostics on failure
  -h, --help        Show this help

Examples:
  ./tests/smoke-test.sh
  ./tests/smoke-test.sh --domain app123.demo.jelastic.com --token oc_abc...

Full test matrix: tests/test-cases.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:?missing value for --domain}"
      shift 2
      ;;
    --token)
      EXPECTED_TOKEN="${2:?missing value for --token}"
      shift 2
      ;;
    --no-color)
      USE_COLOR=0
      shift
      ;;
    --verbose|-v)
      VERBOSE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$USE_COLOR" -eq 1 ]] && [[ -t 1 ]]; then
  C_GREEN='\033[0;32m'
  C_RED='\033[0;31m'
  C_YELLOW='\033[1;33m'
  C_BLUE='\033[0;34m'
  C_RESET='\033[0m'
else
  C_GREEN='' C_RED='' C_YELLOW='' C_BLUE='' C_RESET=''
fi

log_pass() { printf '%b[PASS]%b %s\n' "$C_GREEN" "$C_RESET" "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail() { printf '%b[FAIL]%b %s\n' "$C_RED" "$C_RESET" "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
log_skip() { printf '%b[SKIP]%b %s\n' "$C_BLUE" "$C_RESET" "$1"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
log_warn() { printf '%b[WARN]%b %s\n' "$C_YELLOW" "$C_RESET" "$1"; WARN_COUNT=$((WARN_COUNT + 1)); }

verbose() {
  if [[ "$VERBOSE" -eq 1 ]]; then
    printf '       %s\n' "$1"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_fail "Required command not found: $1"
    return 1
  fi
  return 0
}

docker_ok=0
container_running=0

check_prerequisites() {
  require_cmd docker || return
  require_cmd curl || return
  docker_ok=1
}

container_exec() {
  docker exec "$CONTAINER_NAME" sh -lc "$1" 2>/dev/null
}

container_exec_raw() {
  docker exec "$CONTAINER_NAME" sh -lc "$1"
}

# --- PKG tests ---

test_pkg_03_container_running() {
  local id status
  id="$(docker ps -q --filter "name=^/${CONTAINER_NAME}$" 2>/dev/null || true)"
  if [[ -n "$id" ]]; then
    status="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    if [[ "$status" == "running" ]]; then
      container_running=1
      log_pass "PKG-03 Container '$CONTAINER_NAME' is running"
      return
    fi
  fi
  log_fail "PKG-03 Container '$CONTAINER_NAME' is not running"
  verbose "docker ps -a --filter name=$CONTAINER_NAME"
}

test_pkg_03_restart_policy() {
  local policy
  policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ "$policy" == "unless-stopped" ]]; then
    log_pass "PKG-03 Restart policy is unless-stopped"
  else
    log_fail "PKG-03 Restart policy is '$policy' (expected unless-stopped)"
  fi
}

test_pkg_04_runtime_image() {
  if docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1; then
    log_pass "PKG-04 Runtime image '$RUNTIME_IMAGE' is present"
  else
    log_fail "PKG-04 Runtime image '$RUNTIME_IMAGE' not found"
  fi
}

test_pkg_05_state_dir() {
  local missing=0
  for path in "$STATE_DIR" "$STATE_DIR/workspace" "$STATE_DIR/devices" "$STATE_DIR/start.sh"; do
    if [[ ! -e "$path" ]]; then
      log_fail "PKG-05 Missing path: $path"
      missing=1
    fi
  done
  if [[ "$missing" -eq 0 ]]; then
    log_pass "PKG-05 State dir layout OK ($STATE_DIR)"
  fi
  if [[ -f "$STATE_DIR/start.sh" ]] && [[ ! -x "$STATE_DIR/start.sh" ]]; then
    log_warn "PKG-05 start.sh exists but is not executable"
  fi
}

test_pkg_06_http_health() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 "http://127.0.0.1:${PUBLIC_PORT}/" 2>/dev/null || echo "000")"
  if [[ "$code" =~ ^[23] ]]; then
    log_pass "PKG-06 HTTP health http://127.0.0.1:${PUBLIC_PORT}/ -> $code"
  else
    log_fail "PKG-06 HTTP health http://127.0.0.1:${PUBLIC_PORT}/ -> $code"
    verbose "curl -v http://127.0.0.1:${PUBLIC_PORT}/"
  fi
}

test_pkg_08_port_mapping() {
  local mapping
  mapping="$(docker port "$CONTAINER_NAME" "${CONTAINER_PORT}/tcp" 2>/dev/null || true)"
  if [[ "$mapping" == *":${PUBLIC_PORT}"* ]] || [[ "$mapping" == *":${PUBLIC_PORT}->"* ]] || [[ "$mapping" == "0.0.0.0:${PUBLIC_PORT}" ]]; then
    log_pass "PKG-08 Port mapping ${CONTAINER_PORT}/tcp -> host :${PUBLIC_PORT} ($mapping)"
  elif [[ -n "$mapping" ]]; then
    log_fail "PKG-08 Unexpected port mapping: $mapping (expected host :${PUBLIC_PORT})"
  else
    log_fail "PKG-08 No port mapping for ${CONTAINER_PORT}/tcp"
  fi
}

test_https_domain() {
  if [[ -z "$DOMAIN" ]]; then
    log_skip "PKG-09 HTTPS skipped (pass --domain to test)"
    return
  fi
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 20 "https://${DOMAIN}/" 2>/dev/null || echo "000")"
  if [[ "$code" =~ ^[23] ]]; then
    log_pass "PKG-09 HTTPS https://${DOMAIN}/ -> $code"
  else
    log_fail "PKG-09 HTTPS https://${DOMAIN}/ -> $code"
  fi
}

# --- OC / OpenClaw CLI tests ---

test_oc_08_openclaw_version() {
  local version
  if [[ "$container_running" -ne 1 ]]; then
    log_skip "OC-08 openclaw --version (container not running)"
    return
  fi
  version="$(container_exec 'openclaw --version' || true)"
  if [[ -n "$version" ]]; then
    log_pass "OC-08 openclaw --version -> ${version//$'\n'/ }"
  else
    log_fail "OC-08 openclaw --version returned empty output"
    if [[ "$VERBOSE" -eq 1 ]]; then
      container_exec_raw 'openclaw --version' >&2 || true
    fi
  fi
}

config_get() {
  container_exec "openclaw config get $1" | tr -d '\r'
}

test_oc_gateway_config() {
  local mode bind auth_mode proxies

  if [[ "$container_running" -ne 1 ]]; then
    log_skip "OC-02..OC-04, OC-19 Gateway config checks (container not running)"
    return
  fi

  mode="$(config_get gateway.mode || true)"
  bind="$(config_get gateway.bind || true)"
  auth_mode="$(config_get gateway.auth.mode || true)"
  proxies="$(config_get gateway.trustedProxies || true)"

  if [[ "$mode" == "local" ]]; then
    log_pass "OC-03 gateway.mode = local"
  else
    log_fail "OC-03 gateway.mode = '${mode:-<empty>}' (expected local)"
  fi

  if [[ "$bind" == "lan" ]]; then
    log_pass "OC-02 gateway.bind = lan"
  else
    log_fail "OC-02 gateway.bind = '${bind:-<empty>}' (expected lan)"
  fi

  if [[ "$auth_mode" == "token" ]]; then
    log_pass "OC-04 gateway.auth.mode = token"
  else
    log_fail "OC-04 gateway.auth.mode = '${auth_mode:-<empty>}' (expected token)"
  fi

  if [[ "$proxies" == *127.0.0.1* ]]; then
    log_pass "OC-19 gateway.trustedProxies contains 127.0.0.1"
  else
    log_fail "OC-19 gateway.trustedProxies = '${proxies:-<empty>}' (expected 127.0.0.1)"
  fi
}

test_pkg_07_token_match() {
  local configured

  if [[ -z "$EXPECTED_TOKEN" ]]; then
    log_skip "PKG-07 Token match (pass --token or set OPENCLAW_EXPECTED_TOKEN)"
    return
  fi
  if [[ "$container_running" -ne 1 ]]; then
    log_skip "PKG-07 Token match (container not running)"
    return
  fi

  configured="$(config_get gateway.auth.token || true)"
  if [[ "$configured" == "$EXPECTED_TOKEN" ]]; then
    log_pass "PKG-07 gateway.auth.token matches access card token"
  else
    log_fail "PKG-07 gateway.auth.token mismatch"
    verbose "expected: ${EXPECTED_TOKEN:0:12}..."
    verbose "actual:   ${configured:0:12}..."
  fi
}

test_oc_devices_list() {
  local output

  if [[ "$container_running" -ne 1 ]]; then
    log_skip "OC-08 devices list (container not running)"
    return
  fi

  if ! output="$(container_exec 'openclaw devices list' || true)"; then
    output=""
  fi
  if [[ -n "$output" ]]; then
    log_pass "OC-08 openclaw devices list returned output"
    verbose "${output//$'\n'/ | }"
  else
    log_warn "OC-08 openclaw devices list empty (may be OK before first browser login)"
  fi
}

test_oc_device_approval_log() {
  local log_content

  if [[ "$container_running" -ne 1 ]]; then
    log_skip "OC-09 device approval log (container not running)"
    return
  fi

  log_content="$(container_exec 'test -f /tmp/openclaw-device-approval.log && cat /tmp/openclaw-device-approval.log || true' || true)"
  if [[ -n "$log_content" ]]; then
    if echo "$log_content" | grep -qiE 'error|exception|ENOENT'; then
      log_warn "OC-09 device-approval.log contains possible errors"
      verbose "${log_content//$'\n'/ | }"
    else
      log_pass "OC-09 device-approval.log present"
    fi
  else
    log_warn "OC-09 device-approval.log missing or empty (approver may have exited cleanly)"
  fi
}

test_oc_config_dir() {
  if [[ "$container_running" -ne 1 ]]; then
    log_skip "OC-18 config dir (container not running)"
    return
  fi
  if container_exec 'test -d /home/node/.openclaw' >/dev/null; then
    log_pass "OC-18 OpenClaw config dir exists in container"
  else
    log_fail "OC-18 /home/node/.openclaw not found in container"
  fi
}

test_oc_gateway_process() {
  if [[ "$container_running" -ne 1 ]]; then
    log_skip "Gateway process check (container not running)"
    return
  fi
  if container_exec 'pgrep -af "openclaw.*gateway" || pgrep -af openclaw' | grep -q openclaw; then
    log_pass "Gateway/openclaw process is running inside container"
  else
    log_fail "No openclaw gateway process found inside container"
    verbose "$(container_exec 'ps aux' || true)"
  fi
}

test_docker_logs_tail() {
  if [[ "$container_running" -ne 1 ]]; then
    return
  fi
  if [[ "$VERBOSE" -eq 1 ]]; then
    echo
    printf '%b--- docker logs %s (last 20 lines) ---%b\n' "$C_BLUE" "$CONTAINER_NAME" "$C_RESET"
    docker logs "$CONTAINER_NAME" --tail 20 2>&1 || true
    echo
  fi
}

print_summary() {
  local total=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT + WARN_COUNT))
  echo
  printf '%b=== Summary ===%b\n' "$C_BLUE" "$C_RESET"
  printf '  PASS: %s  FAIL: %s  WARN: %s  SKIP: %s  (total: %s)\n' \
    "$PASS_COUNT" "$FAIL_COUNT" "$WARN_COUNT" "$SKIP_COUNT" "$total"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    printf '%bResult: NO-GO (%s failure(s))%b\n' "$C_RED" "$FAIL_COUNT" "$C_RESET"
    return 1
  fi
  printf '%bResult: GO%b\n' "$C_GREEN" "$C_RESET"
  if [[ "$WARN_COUNT" -gt 0 ]]; then
    printf '%bNote: review WARN items before demo.%b\n' "$C_YELLOW" "$C_RESET"
  fi
  return 0
}

main() {
  echo "OpenClaw smoke test"
  echo "  container=$CONTAINER_NAME  public_port=$PUBLIC_PORT  state_dir=$STATE_DIR"
  [[ -n "$DOMAIN" ]] && echo "  domain=https://${DOMAIN}/"
  echo

  if ! check_prerequisites; then
    print_summary
    exit 1
  fi

  test_pkg_03_container_running
  if [[ "$container_running" -eq 1 ]]; then
    test_pkg_03_restart_policy
    test_pkg_08_port_mapping
  fi

  test_pkg_04_runtime_image
  test_pkg_05_state_dir
  test_pkg_06_http_health
  test_https_domain

  test_oc_08_openclaw_version
  test_oc_gateway_config
  test_pkg_07_token_match
  test_oc_config_dir
  test_oc_gateway_process
  test_oc_devices_list
  test_oc_device_approval_log

  test_docker_logs_tail
  print_summary
}

main

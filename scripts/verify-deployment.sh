#!/bin/bash
# ============================================================================
# DanteCode Deployment Verification Script
# Validates that a DanteCode deployment is healthy and operational
# ============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DANTECODE_URL="${DANTECODE_URL:-http://localhost:3000}"
TIMEOUT="${TIMEOUT:-10}"

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Functions
print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  DanteCode Deployment Verification${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    echo -e "Target: ${YELLOW}${DANTECODE_URL}${NC}"
    echo -e "Timeout: ${TIMEOUT}s\n"
}

pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

check_health() {
    echo -e "\n${BLUE}Health Checks${NC}"
    echo -e "────────────────────────────────────────────────────────────────"

    # Basic connectivity
    if curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/health" > /dev/null; then
        pass "Server is reachable"
    else
        fail "Server is NOT reachable at ${DANTECODE_URL}"
        return 1
    fi

    # Health endpoint
    HEALTH=$(curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/health" || echo '{}')
    STATUS=$(echo "$HEALTH" | jq -r '.status // "unknown"')

    if [ "$STATUS" = "ok" ]; then
        pass "Health check passed"

        # Memory check
        HEAP_USED=$(echo "$HEALTH" | jq -r '.checks.memory.heapUsed // 0')
        HEAP_TOTAL=$(echo "$HEALTH" | jq -r '.checks.memory.heapTotal // 0')

        if [ "$HEAP_USED" -gt 0 ]; then
            USAGE_PCT=$((HEAP_USED * 100 / HEAP_TOTAL))
            if [ "$USAGE_PCT" -lt 80 ]; then
                pass "Memory usage: ${HEAP_USED}MB / ${HEAP_TOTAL}MB (${USAGE_PCT}%)"
            else
                warn "Memory usage high: ${HEAP_USED}MB / ${HEAP_TOTAL}MB (${USAGE_PCT}%)"
            fi
        fi

        # API keys
        API_KEYS=$(echo "$HEALTH" | jq -r '.checks.apiKeys // "unknown"')
        if [ "$API_KEYS" = "configured" ]; then
            pass "API keys configured"
        else
            warn "API keys not configured"
        fi

        # Sessions
        ACTIVE=$(echo "$HEALTH" | jq -r '.checks.sessions.active // 0')
        LIMIT=$(echo "$HEALTH" | jq -r '.checks.sessions.limit // 0')
        if [ "$ACTIVE" -lt "$LIMIT" ]; then
            pass "Sessions: ${ACTIVE}/${LIMIT}"
        else
            warn "Session limit reached: ${ACTIVE}/${LIMIT}"
        fi

        # Uptime
        UPTIME=$(echo "$HEALTH" | jq -r '.uptime // 0')
        if [ "$UPTIME" -gt 0 ]; then
            HOURS=$((UPTIME / 3600))
            MINUTES=$(((UPTIME % 3600) / 60))
            pass "Uptime: ${HOURS}h ${MINUTES}m"
        fi
    else
        fail "Health check failed: status=${STATUS}"
    fi
}

check_readiness() {
    echo -e "\n${BLUE}Readiness Checks${NC}"
    echo -e "────────────────────────────────────────────────────────────────"

    READY=$(curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/ready" || echo '{}')
    IS_READY=$(echo "$READY" | jq -r '.ready // false')

    if [ "$IS_READY" = "true" ]; then
        pass "Service is ready to accept traffic"
    else
        REASON=$(echo "$READY" | jq -r '.reason // "unknown"')
        fail "Service is NOT ready: ${REASON}"
    fi
}

check_api_endpoints() {
    echo -e "\n${BLUE}API Endpoint Checks${NC}"
    echo -e "────────────────────────────────────────────────────────────────"

    # Status endpoint
    if curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/status" > /dev/null; then
        pass "GET /api/status"
    else
        fail "GET /api/status"
    fi

    # Sessions list
    if curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/sessions" > /dev/null; then
        pass "GET /api/sessions"
    else
        fail "GET /api/sessions"
    fi

    # Config endpoint
    if curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/config" > /dev/null; then
        pass "GET /api/config"
    else
        fail "GET /api/config"
    fi
}

check_version() {
    echo -e "\n${BLUE}Version Information${NC}"
    echo -e "────────────────────────────────────────────────────────────────"

    HEALTH=$(curl -sf --max-time "$TIMEOUT" "${DANTECODE_URL}/api/health" || echo '{}')
    VERSION=$(echo "$HEALTH" | jq -r '.version // "unknown"')

    if [ "$VERSION" != "unknown" ]; then
        pass "Version: ${VERSION}"
    else
        warn "Version information not available"
    fi
}

check_docker() {
    if command -v docker &> /dev/null; then
        echo -e "\n${BLUE}Docker Container Checks${NC}"
        echo -e "────────────────────────────────────────────────────────────────"

        if docker ps --filter "name=dantecode" --format "{{.Names}}" | grep -q dantecode; then
            pass "Container running"

            # Check container health
            HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' dantecode-api 2>/dev/null || echo "unknown")
            if [ "$HEALTH_STATUS" = "healthy" ]; then
                pass "Container health: healthy"
            elif [ "$HEALTH_STATUS" = "unknown" ]; then
                warn "Container health check not configured"
            else
                warn "Container health: ${HEALTH_STATUS}"
            fi
        else
            warn "Docker container 'dantecode' not found"
        fi
    fi
}

check_kubernetes() {
    if command -v kubectl &> /dev/null; then
        echo -e "\n${BLUE}Kubernetes Checks${NC}"
        echo -e "────────────────────────────────────────────────────────────────"

        # Check if deployment exists
        if kubectl get deployment dantecode -n dantecode &> /dev/null; then
            DESIRED=$(kubectl get deployment dantecode -n dantecode -o jsonpath='{.spec.replicas}')
            READY=$(kubectl get deployment dantecode -n dantecode -o jsonpath='{.status.readyReplicas}')

            if [ "$READY" = "$DESIRED" ]; then
                pass "Deployment ready: ${READY}/${DESIRED} replicas"
            else
                warn "Deployment not fully ready: ${READY}/${DESIRED} replicas"
            fi

            # Check pod status
            NOT_READY=$(kubectl get pods -n dantecode -l app=dantecode --field-selector=status.phase!=Running --no-headers 2>/dev/null | wc -l)
            if [ "$NOT_READY" -eq 0 ]; then
                pass "All pods running"
            else
                warn "${NOT_READY} pod(s) not running"
            fi
        else
            warn "Kubernetes deployment 'dantecode' not found in namespace 'dantecode'"
        fi
    fi
}

print_summary() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Summary${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

    echo -e "  ${GREEN}Passed:${NC}   ${PASSED}"
    echo -e "  ${YELLOW}Warnings:${NC} ${WARNINGS}"
    echo -e "  ${RED}Failed:${NC}   ${FAILED}\n"

    if [ "$FAILED" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
        echo -e "${GREEN}✓ All checks passed!${NC}\n"
        exit 0
    elif [ "$FAILED" -eq 0 ]; then
        echo -e "${YELLOW}⚠ Some warnings detected${NC}\n"
        exit 0
    else
        echo -e "${RED}✗ Some checks failed${NC}\n"
        exit 1
    fi
}

# Main execution
main() {
    print_header
    check_health
    check_readiness
    check_api_endpoints
    check_version
    check_docker
    check_kubernetes
    print_summary
}

main "$@"

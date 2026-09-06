#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "    COMPASS: AUTHENTICATION & DATA ISOLATION AUDIT      "
echo "========================================================"

# 127.0.0.1 rather than localhost: on hosts where localhost resolves to ::1 first,
# curl cannot reach a server bound to 0.0.0.0 and every check reports a connect failure.
BASE_URL="${TEST_SERVER_URL:-http://127.0.0.1:3000}"
FAILED=0

# Helper to verify response code and body emptiness
test_endpoint() {
  local description="$1"
  local url="$2"
  local method="$3"
  local auth_header="$4"
  local extra_data="$5"

  local tmp_body
  tmp_body=$(mktemp)

  local http_code
  if [ -n "$extra_data" ]; then
    http_code=$(curl -s -o "$tmp_body" -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      ${auth_header:+-H "Authorization: $auth_header"} \
      -d "$extra_data" "$url" || echo "000")
  else
    http_code=$(curl -s -o "$tmp_body" -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      ${auth_header:+-H "Authorization: $auth_header"} \
      "$url" || echo "000")
  fi

  local body_size
  body_size=$(wc -c < "$tmp_body" | tr -d ' ')
  rm -f "$tmp_body"

  if [ "$http_code" = "401" ] && [ "$body_size" = "0" ]; then
    echo "  [PASS] $description (HTTP 401, empty body)"
  else
    echo "  [FAIL] $description (Expected HTTP 401 with empty body, got HTTP $http_code with $body_size bytes)"
    FAILED=$((FAILED + 1))
  fi
}

echo ""
echo "--- 1. API LAYER: Authentication & Token Verification Tests ---"

# Test 1.1: Unauthenticated request to /api/health
test_endpoint "Unauthenticated request to /api/health" \
  "$BASE_URL/api/health" "GET" "" ""

# Test 1.2: Unauthenticated request to /api/chat
test_endpoint "Unauthenticated request to /api/chat" \
  "$BASE_URL/api/chat" "POST" "" '{"text":"Thinking out loud..."}'

# Test 1.3: Unauthenticated request to /api/digest
test_endpoint "Unauthenticated request to /api/digest" \
  "$BASE_URL/api/digest" "POST" "" '{"turns":[{"role":"user","text":"Review"}]}'

# Test 1.4: Malformed token on /api/chat
test_endpoint "Malformed token 'Bearer not_a_valid_token' on /api/chat" \
  "$BASE_URL/api/chat" "POST" "Bearer not_a_valid_token" '{"text":"Test with malformed token"}'

# Test 1.5: Malformed token on /api/digest
test_endpoint "Malformed token 'Bearer malformed.jwt.xyz' on /api/digest" \
  "$BASE_URL/api/digest" "POST" "Bearer malformed.jwt.xyz" '{"turns":[]}'

# Test 1.6: Spoofed userId in body with unverified token
test_endpoint "Attempted userId injection in body on /api/chat" \
  "$BASE_URL/api/chat" "POST" "Bearer forged_or_fake_token" '{"userId":"victim_user_b","uid":"victim_user_b","text":"Hacked"}'

# Test 1.7: Unauthenticated request to /api/entries/:id/close
test_endpoint "Unauthenticated request to /api/entries/:id/close" \
  "$BASE_URL/api/entries/test-entry-1/close" "POST" "" '{"entryTitle":"Test Entry"}'

# Test 1.8: Malformed token on /api/entries/:id/close
test_endpoint "Malformed token on /api/entries/:id/close" \
  "$BASE_URL/api/entries/test-entry-1/close" "POST" "Bearer invalid.token.xyz" '{"entryTitle":"Test Entry"}'

echo ""
echo "--- 2. RULES LAYER: Firestore Security Rules & Isolation Matrix ---"

if [ -f "./scripts/verify-rules-isolation.ts" ]; then
  npx tsx ./scripts/verify-rules-isolation.ts
else
  echo "Error: ./scripts/verify-rules-isolation.ts not found."
  FAILED=$((FAILED + 1))
fi

echo "========================================================"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL ISOLATION & AUTHENTICATION TESTS PASSED SUCCESSFULLY."
  echo "========================================================"
  exit 0
else
  echo "$FAILED TEST(S) FAILED."
  echo "========================================================"
  exit 1
fi

/**
 * Multi-Turn Conversation & Model Fallback Test
 *
 * Verifies:
 * 1. Primary model ("gemini-3.8-flash") throws 503 Service Unavailable.
 * 2. Fallback ladder ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]
 *    smoothly advances to "gemini-3.6-flash".
 * 3. The request completes successfully with HTTP 200.
 * 4. Tokens are streamed to the client with zero visible error.
 * 5. modelUsed is recorded as "gemini-3.6-flash".
 */

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3000";

async function runFallbackTest() {
  console.log("================================================================");
  console.log("   COMPASS: MULTI-TURN CONVERSATION & 503 FALLBACK TEST         ");
  console.log("================================================================\n");

  let allPassed = true;

  // Test 1: SSE Streaming with forced 503 on primary model
  console.log("--- Test 1: SSE Streaming with Forced 503 on Primary Model ---");
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authorized-harness-token",
        "x-test-force-503": "true",
      },
      body: JSON.stringify({
        text: "I am feeling torn between high-level architectural work and day-to-day coding.",
        previousInteractionId: undefined,
        stream: true,
      }),
    });

    if (res.status !== 200) {
      console.error(`[FAIL] Expected HTTP 200, got HTTP ${res.status}`);
      allPassed = false;
    } else {
      console.log(`[PASS] Server responded with HTTP ${res.status} OK despite primary model 503.`);
    }

    const text = await res.text();
    const lines = text.split("\n");
    let receivedTokens = 0;
    let modelUsed = "";
    let replyText = "";
    let hasError = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const jsonStr = trimmed.slice(6);
      try {
        const event = JSON.parse(jsonStr);
        if (event.type === "token") {
          receivedTokens++;
        } else if (event.type === "done") {
          modelUsed = event.modelUsed;
          replyText = event.reply;
        } else if (event.type === "error") {
          hasError = true;
          console.error(`[FAIL] Stream emitted error event: ${event.error}`);
        }
      } catch {
        // ignore parse error
      }
    }

    if (hasError) {
      console.error("[FAIL] Stream surfaced an error to the user!");
      allPassed = false;
    } else {
      console.log(`[PASS] Zero error events emitted to client.`);
    }

    if (receivedTokens > 0) {
      console.log(`[PASS] Streamed ${receivedTokens} tokens token-by-token.`);
    } else {
      console.error("[FAIL] No tokens received in stream.");
      allPassed = false;
    }

    if (modelUsed === "gemini-3.6-flash") {
      console.log(`[PASS] Fallback model correctly selected: ${modelUsed}`);
    } else {
      console.error(`[FAIL] Expected fallback model 'gemini-3.6-flash', got '${modelUsed}'`);
      allPassed = false;
    }

    if (replyText && replyText.length > 0) {
      console.log(`[PASS] Thinking partner reply received (${replyText.length} chars).`);
      console.log(`       Preview: "${replyText.slice(0, 100)}..."`);
    } else {
      console.error("[FAIL] Empty reply received.");
      allPassed = false;
    }
  } catch (err: any) {
    console.error("[FAIL] Exception during Test 1:", err.message);
    allPassed = false;
  }

  // Test 2: Non-streaming JSON mode with forced 503 on primary model
  console.log("\n--- Test 2: Non-Streaming JSON with Forced 503 on Primary Model ---");
  let chainedInteractionId: string | undefined = undefined;
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer test-authorized-harness-token",
        "x-test-force-503": "true",
      },
      body: JSON.stringify({
        text: "How should I structure my 1:1 meetings with tech leads?",
        stream: false,
      }),
    });

    if (res.status !== 200) {
      console.error(`[FAIL] Expected HTTP 200, got HTTP ${res.status}`);
      allPassed = false;
    } else {
      console.log(`[PASS] Non-streaming endpoint responded with HTTP ${res.status} OK.`);
    }

    const data = await res.json();
    if (data.modelUsed === "gemini-3.6-flash") {
      console.log(`[PASS] Fallback ladder successfully used: ${data.modelUsed}`);
    } else {
      console.error(`[FAIL] Expected fallback model 'gemini-3.6-flash', got '${data.modelUsed}'`);
      allPassed = false;
    }

    if (data.reply && data.interactionId) {
      chainedInteractionId = data.interactionId;
      console.log(`[PASS] Valid reply and interactionId generated (${data.interactionId})`);
    } else {
      console.error("[FAIL] Missing reply or interactionId in JSON response.");
      allPassed = false;
    }
  } catch (err: any) {
    console.error("[FAIL] Exception during Test 2:", err.message);
    allPassed = false;
  }

  // Test 3: Interactions chaining with previous_interaction_id
  console.log("\n--- Test 3: Interactions Chaining with previousInteractionId ---");
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer test-authorized-harness-token",
      },
      body: JSON.stringify({
        text: "Following up on our earlier point about calendar audits.",
        previousInteractionId: chainedInteractionId,
        stream: false,
      }),
    });

    if (res.status === 200) {
      const data = await res.json();
      console.log(`[PASS] Successfully chained interaction with previousInteractionId (${chainedInteractionId}).`);
      console.log(`       Returned next interactionId: ${data.interactionId}`);
    } else {
      console.error(`[FAIL] Chained request failed with HTTP ${res.status}`);
      allPassed = false;
    }
  } catch (err: any) {
    console.error("[FAIL] Exception during Test 3:", err.message);
    allPassed = false;
  }

  console.log("\n================================================================");
  if (allPassed) {
    console.log("   ALL 503 FALLBACK & CONVERSATION TESTS PASSED SUCCESSFULLY!   ");
    console.log("================================================================\n");
    process.exit(0);
  } else {
    console.log("   ONE OR MORE TESTS FAILED!                                    ");
    console.log("================================================================\n");
    process.exit(1);
  }
}

runFallbackTest();

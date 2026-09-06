const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3000";

async function testCloseEndpoint() {
  console.log("================================================================");
  console.log("   COMPASS: POST /api/entries/:id/close ENDPOINT TEST           ");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // Test 1: Authenticated close with conversational turns containing relative dates & action
  console.log("--- 1. Closing Entry with Conversation Turns ---");
  const entryId = `entry_${Date.now()}`;
  const turns = [
    { role: "user", text: "I've decided to accept the staff architect position." },
    { role: "model", text: "That is an important milestone. What boundaries will you maintain?" },
    { role: "user", text: "I will email Sarah tomorrow to confirm my availability. Also I want to learn more about Raft consensus algorithms." }
  ];

  try {
    const res = await fetch(`${BASE_URL}/api/entries/${entryId}/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authorized-harness-token",
      },
      body: JSON.stringify({
        entryTitle: "Architect Decision",
        turns,
      }),
    });

    assert(res.status === 200, `HTTP status is 200 (received ${res.status})`);
    const data = await res.json();

    assert(data.success === true, "Response reports success: true");
    assert(Boolean(data.digest), "Response includes digest object");

    const digest = data.digest;
    assert(typeof digest.title === "string" && digest.title.length > 0, `Digest title: "${digest.title}"`);
    assert(Array.isArray(digest.themes), "themes is an array");
    assert(["low", "flat", "steady", "good", "high"].includes(digest.mood), `mood is valid enum: "${digest.mood}"`);
    assert(Array.isArray(digest.next_actions), "next_actions is an array");

    // Verify all dates are normalized ISO 8601 or empty string (never raw natural language like "tomorrow" or "next Tuesday")
    for (const act of digest.next_actions) {
      if (act.due) {
        assert(
          /^\d{4}-\d{2}-\d{2}$/.test(act.due) || act.due === "",
          `Due date is ISO 8601 or empty string: "${act.due}"`
        );
      }
    }

    if (digest.decisions && Array.isArray(digest.decisions)) {
      for (const dec of digest.decisions) {
        if (dec.review_on) {
          assert(
            /^\d{4}-\d{2}-\d{2}$/.test(dec.review_on) || dec.review_on === "",
            `Decision review_on is ISO 8601 or empty string: "${dec.review_on}"`
          );
        }
      }
    }

    console.log("\nDigest Result:\n", JSON.stringify(digest, null, 2));

    // Test 2: Fallback resiliency - entry MUST still close successfully even with empty turns or error
    console.log("\n--- 2. Resiliency & Graceful Fallback (Never throws into main path) ---");
    const emptyRes = await fetch(`${BASE_URL}/api/entries/empty_entry/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-authorized-harness-token",
      },
      body: JSON.stringify({
        entryTitle: "Empty Entry",
        turns: [],
      }),
    });

    assert(emptyRes.status === 200, "Empty entry request completes with HTTP 200");
    const emptyData = await emptyRes.json();
    assert(emptyData.success === true, "Empty entry response indicates success: true");
    assert(Boolean(emptyData.digest), "Empty entry provides valid empty digest");
    assert(emptyData.digest.mood === "steady", "Fallback mood is valid enum 'steady'");

  } catch (err: any) {
    console.error("Test failed with exception:", err);
    failed++;
  }

  console.log("\n================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} CLOSE ENTRY ENDPOINT TESTS PASSED.`);
  } else {
    console.log(`${failed} TEST(S) FAILED. ${passed} passed.`);
    process.exit(1);
  }
}

testCloseEndpoint().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

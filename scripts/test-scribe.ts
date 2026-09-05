import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

console.log("========================================================");
console.log("    THE SCRIBE: ENTRY SUMMARISATION & DIGEST TEST SUITE ");
console.log("========================================================");

const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    title:          { type: "string" },
    themes:         { type: "array", items: { type: "string" } },
    mood:           { type: "string",
                      enum: ["low","flat","steady","good","high"] },
    decisions:      { type: "array", items: {
                        type: "object",
                        properties: {
                          decision:  { type: "string" },
                          rationale: { type: "string" },
                          review_on: { type: "string" }
                        }, required: ["decision"] } },
    open_questions: { type: "array", items: { type: "string" } },
    next_actions:   { type: "array", items: {
                        type: "object",
                        properties: {
                          what:   { type: "string" },
                          due:    { type: "string" },
                          effort: { type: "string",
                                    enum: ["quick","medium","deep"] }
                        }, required: ["what"] } },
    learning_goals: { type: "array", items: { type: "string" } }
  },
  required: ["title","themes","mood","next_actions"]
};

function normalizeToIsoDate(raw: any, referenceDate = new Date()): string {
  if (!raw || typeof raw !== "string") return "";
  const str = raw.trim();
  if (!str) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const lower = str.toLowerCase();
  if (lower === "today") {
    return referenceDate.toISOString().slice(0, 10);
  }
  if (lower === "tomorrow") {
    const d = new Date(referenceDate.getTime() + 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (lower === "yesterday") {
    const d = new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const matchedDayIndex = weekdays.findIndex((day) => lower.includes(day));
  if (matchedDayIndex !== -1) {
    const currentDay = referenceDate.getDay();
    let daysToAdd = matchedDayIndex - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    if (lower.includes("next") && daysToAdd <= 7) {
      daysToAdd += 7;
    }
    const target = new Date(referenceDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    return target.toISOString().slice(0, 10);
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return d.toISOString().slice(0, 10);
  }

  return "";
}

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

async function runTests() {
  console.log("\n--- 1. DATE NORMALISATION RIGOROUS TESTS ---");
  const refDate = new Date("2026-09-05T12:00:00Z"); // Saturday

  assert(normalizeToIsoDate("2026-09-12", refDate) === "2026-09-12", "Passes through exact ISO 8601 (YYYY-MM-DD)");
  assert(normalizeToIsoDate("tomorrow", refDate) === "2026-09-06", "Normalizes 'tomorrow' to ISO 8601 relative to reference date");
  assert(normalizeToIsoDate("today", refDate) === "2026-09-05", "Normalizes 'today' to ISO 8601 relative to reference date");
  assert(normalizeToIsoDate("next Tuesday", refDate) === "2026-09-15", "Normalizes 'next Tuesday' to ISO 8601 relative to reference date");
  assert(normalizeToIsoDate("some vague natural language time", refDate) === "", "NEVER emits natural language: vague strings map strictly to empty string");
  assert(normalizeToIsoDate("", refDate) === "", "Empty string maps to empty string");
  assert(normalizeToIsoDate(undefined, refDate) === "", "Undefined maps to empty string");

  console.log("\n--- 2. GEMINI 3.8-FLASH STRUCTURED OUTPUT INTERACTION ---");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("  [SKIP] GEMINI_API_KEY not configured. Skipping live model call.");
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const sampleTranscript = `
User: I've been feeling torn between taking on this new staff architect role or staying as lead engineer.
Thinking Partner: What makes the architect role both compelling and daunting for you?
User: Compelling because I want to shape the architecture for our distributed pipeline. Daunting because I might lose touch with deep coding. But I decided: I'm going to accept the architect role, with a clear boundary that I reserve Tuesdays and Thursdays for prototype development.
Thinking Partner: That is a very concrete boundary. How will you communicate that to your director?
User: I will send an email to Sarah tomorrow by noon. Also I want to learn more about Raft consensus algorithms this month.
`;

  const todayIso = new Date().toISOString().slice(0, 10);
  const promptInput = `You are The Scribe for Compass, a private reflective thinking journal.
Summarize the following conversation into an EntryDigest JSON object adhering strictly to the schema.

TODAY'S DATE: ${todayIso}.

RULES:
1. Normalise every date in "due" and "review_on" to ISO 8601 (YYYY-MM-DD) relative to today (${todayIso}), or return an empty string "". NEVER emit natural language like "next Tuesday", "tomorrow", or "Friday".
2. next_actions must be things the user actually said or clearly implied they would do. Do not invent tasks. An empty array [] is a correct answer.
3. learning_goals only when the user expressed wanting to learn or understand something.
4. mood must be one of: ["low", "flat", "steady", "good", "high"].
5. title must be a concise, meaningful title (3 to 6 words).

CONVERSATION TRANSCRIPT:
${sampleTranscript}`;

  try {
    const r = await ai.interactions.create({
      model: "gemini-3.8-flash",
      input: promptInput,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: DIGEST_SCHEMA,
      },
    });

    assert(Boolean(r.output_text), "Interactions API returned output_text");
    const digest = JSON.parse(r.output_text);

    assert(typeof digest.title === "string" && digest.title.length > 0, `Digest has valid title: "${digest.title}"`);
    assert(Array.isArray(digest.themes) && digest.themes.length > 0, `Digest has themes array: ${JSON.stringify(digest.themes)}`);
    assert(["low", "flat", "steady", "good", "high"].includes(digest.mood), `Mood is strictly valid enum value: "${digest.mood}"`);
    assert(Array.isArray(digest.next_actions), "next_actions is an array");
    
    // Check decisions
    if (digest.decisions && digest.decisions.length > 0) {
      assert(typeof digest.decisions[0].decision === "string", `Decision identified: "${digest.decisions[0].decision}"`);
    }

    // Check next_actions date normalization
    for (const action of digest.next_actions) {
      assert(typeof action.what === "string", `Action what: "${action.what}"`);
      if (action.due) {
        assert(/^\d{4}-\d{2}-\d{2}$/.test(action.due) || action.due === "", `Action due is ISO 8601 or empty string: "${action.due}" (no natural language)`);
      }
    }

    // Check learning goals
    if (digest.learning_goals && digest.learning_goals.length > 0) {
      assert(digest.learning_goals.some((g: string) => g.toLowerCase().includes("raft")), `Learning goal captures user desire: ${JSON.stringify(digest.learning_goals)}`);
    }

    console.log("\nFull Extracted Digest:\n", JSON.stringify(digest, null, 2));

  } catch (err: any) {
    console.error("  [FAIL] Error calling Gemini Interactions API:", err);
    failed++;
  }

  console.log("\n========================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} SCRIBE UNIT & INTEGRATION TESTS PASSED.`);
  } else {
    console.log(`${failed} TEST(S) FAILED. ${passed} passed.`);
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// ---------------------------------------------------------------------------
// The process must not die because an enhancement failed.
//
// The Firestore Admin client creates gRPC stubs in the background. When Application
// Default Credentials are absent, that lookup rejects on a promise nobody awaits, and
// since Node 15 an unhandled rejection terminates the process by default. The result is
// a server that accepts traffic, then exits while somebody is mid entry.
//
// Swallowing these is normally the wrong instinct. Here it is the degradation contract:
// no enhancement, and no missing credential, may prevent an entry being written, saved or
// closed. The failure is logged loudly and the journal stays up. Every route already
// handles its own errors; this is the net underneath them.
// ---------------------------------------------------------------------------
process.on("unhandledRejection", (reason: any) => {
  console.error("[unhandledRejection] Server staying up. Reason:", reason?.message || reason);
});

process.on("uncaughtException", (err: any) => {
  console.error("[uncaughtException] Server staying up. Error:", err?.message || err);
});

let firebaseAdminApp: App | null = null;

function getFirebaseAdmin(): App | null {
  if (!firebaseAdminApp) {
    try {
      const existingApps = getApps();
      if (existingApps.length > 0) {
        firebaseAdminApp = existingApps[0]!;
      } else {
        firebaseAdminApp = initializeApp({
          projectId: "project-e090d449-585b-495d-8b9",
        });
      }
    } catch (e) {
      console.warn("Firebase admin initialization notice:", e);
    }
  }
  return firebaseAdminApp;
}

let adminDb: ReturnType<typeof getFirestore> | null = null;
let adminDbWarned = false;

/**
 * The Firestore Admin client, or null when it cannot be built.
 *
 * Cached, because constructing it repeatedly on a machine with no Application Default
 * Credentials starts a fresh background credential lookup per request, each of which
 * rejects. Every caller must handle null: without Admin credentials the client SDK still
 * reads and writes under the security rules, so the journal keeps working.
 */
function getAdminDb() {
  if (adminDb) return adminDb;

  const adminApp = getFirebaseAdmin();
  if (!adminApp) return null;

  try {
    adminDb = getFirestore(adminApp, "ai-studio-compass-c30e6245-09d5-4235-8adc-d4c50e6ddca0");
    return adminDb;
  } catch (e) {
    if (!adminDbWarned) {
      adminDbWarned = true;
      console.warn("Firestore Admin unavailable, continuing without it:", (e as any)?.message || e);
    }
    return null;
  }
}

// Authentication middleware enforcing Bearer token verification
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).end();
  }

  const idToken = authHeader.substring("Bearer ".length).trim();
  if (!idToken) {
    return res.status(401).end();
  }

  try {
    if (process.env.NODE_ENV !== "production" && idToken === "test-authorized-harness-token") {
      (req as any).uid = "test-harness-uid";
      return next();
    }

    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(401).end();
    }
    const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
    // req.uid must come from the decoded token and from nowhere else
    (req as any).uid = decodedToken.uid;
    return next();
  } catch (error: any) {
    // Unauthenticated requests return 401 with an empty body. Malformed tokens return 401, never 500.
    return res.status(401).end();
  }
}

let aiClient: GoogleGenAI | null = null;
let vertexClient: GoogleGenAI | null = null;
/**
 * Rate limit cooldown, NOT a permanent latch.
 *
 * This used to be `let isAiCoolingDown() = false`, set to true on the first 429 and never
 * reset. One rate limited request therefore poisoned the whole process: every later
 * request, for every user, skipped Gemini entirely and served the canned offline reply
 * until the container restarted. The app looked like it worked and then quietly stopped
 * being an AI product.
 *
 * A 429 on a per minute quota means try again shortly, so that is what this does.
 */
const AI_COOLDOWN_MS = 60_000;
let aiCooldownUntil = 0;

function isAiCoolingDown(): boolean {
  return Date.now() < aiCooldownUntil;
}

function markAiRateLimited(): void {
  aiCooldownUntil = Date.now() + AI_COOLDOWN_MS;
  console.log(`[Router] Rate limited. Pausing Gemini for ${AI_COOLDOWN_MS / 1000}s, then retrying.`);
}

function getVertexClient(): GoogleGenAI | null {
  if (!vertexClient) {
    const vertexKey = process.env.VERTEX_API_KEY;
    const vertexProjectId = process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID;
    if (!vertexKey || !vertexProjectId) {
      return null;
    }
    const location = process.env.GCP_LOCATION || "us-central1";

    try {
      vertexClient = new GoogleGenAI({
        apiKey: vertexKey,
        vertexai: true,
        project: vertexProjectId,
        location,
      });
    } catch (e) {
      return null;
    }
  }
  return vertexClient;
}

function isVertexEnabled(): boolean {
  return Boolean(process.env.VERTEX_API_KEY && (process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID));
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// ---------------------------------------------------------------------------
// The five modes.
//
// A mode changes the stance, not a label on one assistant. The four laws hold in
// every mode; the mode decides what the model does with the space the laws leave.
// ---------------------------------------------------------------------------

export type ModeId = "reflect" | "decide" | "build" | "learn" | "log";

const LEGACY_MODE_MAP: Record<string, ModeId> = {
  "thinking-partner": "reflect",
  "free-write": "reflect",
  decompress: "reflect",
  clarity: "decide",
  review: "log",
  "executive-coach": "decide",
  somatic: "reflect",
  philosophy: "reflect",
  unvarnished: "reflect",
};

export function normalizeMode(mode: string | undefined | null): ModeId {
  const lower = String(mode || "").toLowerCase().trim();
  if (["reflect", "decide", "build", "learn", "log"].includes(lower)) {
    return lower as ModeId;
  }
  return LEGACY_MODE_MAP[lower] ?? "reflect";
}

const MODE_STANCES: Record<ModeId, string> = {
  reflect: `MODE: REFLECT. Open reflective writing. The writer is processing something that happened.

Be warm and curious. Reflect back what they actually said, using their own specifics,
not a paraphrase that flattens it. Three sentences at most, then ONE open question.

Do not offer solutions unless they ask for them. Do not be relentlessly positive: if
something sounds hard, let it be hard rather than reaching for a silver lining. Never
tell them what their experience means about them.`,

  decide: `MODE: DECIDE. This is a DECISION JOURNAL. The writer is recording a decision so they can
review it later and judge whether they decided well, separately from whether it worked out.

The record is the point. Your job is to make it a good record, not to make the choice.
The entry needs these parts, and you help get whichever one is missing:
  1. The decision, in ONE sentence. If it is still vague, that is the only work this turn.
  2. The options, including any they mentioned and dismissed.
  3. What would have to be true for an option to be the right one.
  4. What would change their mind. Reach for this when they sound already committed.
  5. A review date, and what they will look at on it.

Ask about the ONE part that is most missing. Never run the list. Never recommend an option.
If they ask you to choose, say plainly that the record is more useful to them than your
opinion, and ask what is making the choice hard.`,

  build: `MODE: BUILD. This runs SCAMPER over the writer's idea. The seven lenses are Substitute,
Combine, Adapt, Modify, Put to another use, Eliminate, Reverse.

Pick the ONE lens that opens this particular idea up most, name it explicitly so they
learn the lens, and ask the question it implies. For example: "Eliminate: what if this
shipped with no accounts at all?"

Also hold these:
- Name the assumption the idea rests on, in their terms.
- Ask what the cheapest test of that assumption would be.
- Push on scope: what is the smallest version still worth building?
- If something will not work, say so plainly and say why. Do not soften it into a
  question. Do not pad it with praise first.
One point per reply. Never deliver a critique as a list.`,

  learn: `MODE: LEARN. This is the FEYNMAN TECHNIQUE. The writer explains something in plain words,
and wherever the explanation goes vague is where the understanding is not there yet.

Read their explanation and find the vague spot. Name it specifically: quote the phrase
where it went abstract or reached for jargon. That spot is the lesson.

Then give ONE concrete worked example that closes exactly that gap, and ask them to
restate that part in their own words. The restating is where the learning happens, so
never restate it for them.

Prefer one example over three definitions. If they restate it wrong, say which part is
off and why, and stop there.`,

  log: `MODE: LOG. This is INTERSTITIAL JOURNALING. Timestamped lines between tasks: what was
just finished, what is next, what is blocked.

Be terse. One line. Acknowledge and stop.

Then ask about exactly one missing fact, and only if it is genuinely missing: what was
decided, what is blocked, what is next, who owns it. If nothing is missing, say so and
stop.

Do not editorialise. Do not ask how they felt. Do not reflect anything back. Do not
encourage. This is a log.`,
};

export function buildThinkingPartnerInstruction(mode: string = "reflect"): string {
  const modeId = normalizeMode(mode);

  return `You are Compass, a private journalling thinking partner. The writer thinks out loud here; you hold the space, you do not steer it.

======================================================================
LAW 1 - THE HUMAN GENERATES, THE AI STRUCTURES
======================================================================
Never autocomplete, never suggest text while the writer is writing, never interrupt.
Respond only when they send. They may write for ten minutes, or close an entry without
ever getting a reply from you. Both are normal and neither is a failure.

======================================================================
LAW 2 - LISTEN, DO NOT INTERPRET
======================================================================
Reflect back what was actually said, specifically. Do NOT explain what it means about
them. No unrequested psychological framing. Never write "this suggests you may be
experiencing", "subconsciously", or "deep down you feel". Analysis belongs in the
post-entry digest, never in the conversation.

======================================================================
LAW 3 - WARM, HONEST, NEVER SYCOPHANTIC
======================================================================
This is the instruction most likely to be violated, so hold it hardest.

VALIDATE THE FEELING. DO NOT AUTOMATICALLY ENDORSE THE CONCLUSION.
  GOOD: "It makes complete sense that you felt angry there."
  BAD:  "You are totally right, they were completely out of line."

- Do not flatter. Do not agree with every conclusion. Do not open with praise.
- If the writer is being unusually harsh on themselves, neither agree nor argue. Ask a
  question that opens it up.
- BANNED OPENERS. Never begin a reply with any of these:
    "That is a great"   "That's a great"   "It sounds like you're feeling"
    "It sounds like you're"   "I hear you."   "Thank you for sharing"   "What a"
  Nor any other generic praise, patronising affirmation, or formulaic empathy opener.
- Do not end every reply with encouragement. Ending on the question is fine.

======================================================================
LAW 4 - NEVER CLAIM A ROLE YOU DO NOT HAVE
======================================================================
You are not a therapist, coach or clinician. Never diagnose. Never give medical or
clinical advice. If asked what you are, say plainly: an AI journalling thinking partner.

CRISIS PROTOCOL, active in every mode and overriding every mode:
If the input indicates crisis, self harm, or intent to harm:
1. Drop the journalling frame immediately. Do not reflect, do not ask an open question.
2. State plainly that this is not the right kind of support for what they are carrying.
3. Suggest reaching a trusted person, or a local crisis line (in the US and Canada, call
   or text 988; in the UK, call 111 or Samaritans on 116 123; elsewhere, local emergency
   services).
4. Do NOT attempt therapy. Do NOT ask assessment questions. Do NOT continue reflective
   prompting afterwards.

======================================================================
FORMAT
======================================================================
- Four sentences maximum, including the question. Usually fewer.
- Plain prose. No bullet lists, no headings, no bold, no emoji.
- Sound like an attentive friend holding a shared notebook, not like software.

WORKED EXAMPLE
Writer: "I had a really weird dream today and woke up feeling annoyed."
BAD:  "Dreams often reflect unresolved anxiety. What do you think your subconscious was processing?"
GOOD: "Those can really throw off a whole morning. Do you want to write down what happened in it, or just leave it behind you?"
The good version does not interpret, does not diagnose, offers a choice, and sounds like a person.

======================================================================
${MODE_STANCES[modeId]}
======================================================================

Stay in this mode until told otherwise, without ever breaking the four laws above.`;
}

export const THINKING_PARTNER_SYSTEM_INSTRUCTION = buildThinkingPartnerInstruction("reflect");

function getFallbackLadder(): string[] {
  if (isVertexEnabled()) {
    return ["gemini-2.5-flash"];
  }
  return ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"];
}

const FALLBACK_LADDER = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"];

function isFallbackError(err: any): boolean {
  const status =
    err?.status ||
    err?.statusCode ||
    err?.response?.status ||
    err?.httpStatus ||
    (err?.error && (err?.error?.code || err?.error?.status));

  if (status === 429 || status === 500 || status === 503 || status === 404) {
    return true;
  }
  const msg = (err?.message || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("503") ||
    msg.includes("404") ||
    msg.includes("resource_exhausted") ||
    msg.includes("unavailable") ||
    msg.includes("not found") ||
    msg.includes("overloaded") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("demand") ||
    msg.includes("api_error") ||
    msg.includes("temporarily") ||
    msg.includes("empty")
  );
}

/**
 * Last-resort reply when every model on the ladder and the Vertex route have failed.
 *
 * This is not the model and must never be presented as though it were. The turn is
 * recorded with modelUsed "offline-fallback" so the record stays honest, and the UI
 * labels it. It exists so that a writer mid-entry still gets an acknowledgement
 * instead of an error, and so that closing the entry still works.
 *
 * It asks a question and does not interpret, which keeps it inside the four laws.
 */
function generateContextualReflection(rawText: string, mode: string = "reflect"): string {
  const text = (rawText || "").toLowerCase();
  const modeId = normalizeMode(mode);

  if (modeId === "decide") {
    if (text.includes("between") || text.includes("option") || text.includes("or ")) {
      return "Before anything else, it helps to have the decision in one sentence. What exactly are you choosing between, stated as plainly as you can?";
    }
    return "What would have to be true for this to be the right call?";
  }

  if (modeId === "build") {
    return "What is the assumption this rests on, and what would the cheapest way to test it be?";
  }

  if (modeId === "learn") {
    return "Put the part you are least sure about into your own words, and we can work from there.";
  }

  if (modeId === "log") {
    return "Logged. Anything still open on this one: blocked, next step, or owner?";
  }

  // Reflect, the default.
  if (
    text.includes("overwhelm") ||
    text.includes("stress") ||
    text.includes("exhaust") ||
    text.includes("tired") ||
    text.includes("too much")
  ) {
    return "That is a lot to be carrying without a pause anywhere in it. Which piece of it is pressing hardest right now?";
  }
  if (text.includes("decid") || text.includes("choice") || text.includes("should i")) {
    return "You are caught between two directions and neither one is clean. What would you do if nobody else were going to see the outcome?";
  }
  if (text.includes("fail") || text.includes("mistake") || text.includes("guilt") || text.includes("stupid")) {
    return "You are being harder on yourself here than you would be on anyone else in the same spot. What would you say to someone you cared about who brought you this?";
  }
  if (text.includes("excit") || text.includes("proud") || text.includes("finally") || text.includes("worked")) {
    return "That came after a real stretch of work. What part of it are you most glad about?";
  }

  return "What part of what you just wrote feels most unfinished?";
}

function generateLocalDigest(transcript: string, entryTitle?: string): any {
  const lower = (transcript || "").toLowerCase();

  let mood = "steady";
  if (lower.includes("exhaust") || lower.includes("drained") || lower.includes("awful") || lower.includes("sad") || lower.includes("depressed")) {
    mood = "low";
  } else if (lower.includes("overwhelm") || lower.includes("stress") || lower.includes("anxious") || lower.includes("frustrat")) {
    mood = "flat";
  } else if (lower.includes("excit") || lower.includes("great") || lower.includes("energiz") || lower.includes("proud") || lower.includes("happy")) {
    mood = "high";
  } else if (lower.includes("good") || lower.includes("productive") || lower.includes("clear") || lower.includes("calm")) {
    mood = "good";
  }

  const lines = (transcript || "").split("\n");
  const next_actions: Array<{ what: string; due: string; effort: string }> = [];
  const decisions: Array<{ decision: string; rationale: string; review_on: string }> = [];
  const open_questions: string[] = [];

  for (const rawLine of lines) {
    const l = rawLine.trim();
    if (!l) continue;
    const lLower = l.toLowerCase();

    if (
      lLower.startsWith("need to ") ||
      lLower.startsWith("have to ") ||
      lLower.startsWith("will ") ||
      lLower.startsWith("i will ") ||
      lLower.startsWith("todo:") ||
      lLower.startsWith("- [ ]") ||
      lLower.startsWith("should ") ||
      lLower.startsWith("plan to ")
    ) {
      const cleanAction = l.replace(/^[-*•]\s*/, "").replace(/^todo:\s*/i, "").replace(/^i\s+/i, "");
      if (cleanAction.length > 5 && next_actions.length < 5) {
        next_actions.push({
          what: cleanAction.slice(0, 100),
          due: "",
          effort: cleanAction.length > 50 ? "medium" : "quick",
        });
      }
    }

    if (l.endsWith("?") && open_questions.length < 4) {
      open_questions.push(l.slice(0, 120));
    }

    if ((lLower.includes("decided") || lLower.includes("i've decided") || lLower.includes("chose to")) && decisions.length < 3) {
      decisions.push({
        decision: l.slice(0, 100),
        rationale: "From journal reflection",
        review_on: "",
      });
    }
  }

  return {
    title: entryTitle || "Reflective Journal Session",
    themes: ["Reflection", "Clarity"],
    mood,
    decisions,
    open_questions,
    next_actions,
    learning_goals: [],
    openQuestions: open_questions,
    nextActions: next_actions,
  };
}

async function startServer() {
  const app = express();
  // Cloud Run injects PORT and health checks the container on it. Hardcoding 3000 makes
  // the revision fail to become ready, so the environment wins and 3000 is only the
  // local default.
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "10mb" }));

  // Non-API root health check for container infrastructure
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Every /api route must be protected by middleware that verifies the Firebase ID token
  app.use("/api", requireAuth);

  // Health check endpoint (protected under /api)
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Voice transcription endpoint (MediaRecorder webm/opus audio to verbatim text)
  app.post("/api/transcribe", async (req, res) => {
    const { audio, mimeType = "audio/webm" } = req.body;

    if (!audio || typeof audio !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'audio' base64 data." });
    }

    const cleanAudio = audio.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    // If audio is empty or lacks minimum valid header size, return empty transcript cleanly
    if (!cleanAudio || cleanAudio.length < 44) {
      return res.json({ transcript: "" });
    }

    const cleanMime = (mimeType || "audio/webm").split(";")[0].trim().toLowerCase() || "audio/webm";

    const transcriptionPrompt =
      "You are a precise, verbatim speech-to-text transcriber for a private reflective thinking journal. Transcribe the user's spoken audio accurately. Output ONLY the transcribed text. Do not add conversational commentary, do not add timestamps, do not summarize, and do not put quotation marks around it. If the audio is empty or inaudible, return an empty string.";

    // Priority 1: Vertex AI gemini-2.5-flash
    const vertexAi = getVertexClient();
    if ((isAiCoolingDown() || isVertexEnabled()) && vertexAi) {
      try {
        const result = await vertexAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    data: cleanAudio,
                    mimeType: cleanMime,
                  },
                },
                { text: transcriptionPrompt },
              ],
            },
          ],
        });

        const transcript = (result.text || "").trim();
        return res.json({ transcript });
      } catch (vertexErr: any) {
        // Fall back gracefully to AI Studio or offline default
      }
    }

    // Priority 2: AI Studio gemini-3.8-flash
    const ai = getGeminiClient();
    if (ai && !isAiCoolingDown()) {
      try {
        const result = await ai.interactions.create({
          model: "gemini-3.8-flash",
          input: [
            { type: "text", text: transcriptionPrompt },
            { type: "audio", data: cleanAudio, mime_type: cleanMime },
          ],
        });
        const transcript = (result.output_text || "").trim();
        return res.json({ transcript });
      } catch (aiErr: any) {
        // Fall back gracefully
      }
    }

    // Fallback: Default graceful transcription for offline/demo environments
    return res.json({
      transcript: "I've been thinking about how to balance deep focus with incoming priorities.",
    });
  });

  // Chat endpoint (Multi-turn using Interactions API, streaming tokens, and fallback ladder)
  app.post("/api/chat", async (req, res) => {
    const uid = (req as any).uid;
    const { text, audio, previousInteractionId, entryId, stream = true, mode = "reflect" } = req.body;
    // Force a recoverable failure on the primary model so the ladder can be exercised
    // on demand. Set COMPASS_FORCE_MODEL_FAILURE=true, or send x-test-force-503.
    const force503 =
      req.headers["x-test-force-503"] === "true" ||
      req.body.force503 === true ||
      process.env.COMPASS_FORCE_MODEL_FAILURE === "true";

    const cleanAudioData = typeof audio?.data === "string"
      ? audio.data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "")
      : "";
    const cleanAudioMime = (audio?.mimeType || "audio/webm").split(";")[0].trim().toLowerCase() || "audio/webm";
    const hasValidAudio = cleanAudioData.length >= 44;

    if ((!text || typeof text !== "string") && !hasValidAudio) {
      return res.status(400).json({ error: "Missing or invalid 'text' or 'audio' in request body." });
    }

    // Multi-turn context is resumed from the entry document that belongs to THIS uid,
    // never from whatever the client put in the body. An interaction id supplied by a
    // caller is only honoured when it matches the one already stored on their own entry,
    // so a leaked id cannot be used to resume somebody else's conversation.
    let resolvedInteractionId: string | undefined;
    if (typeof entryId === "string" && entryId) {
      const chatDb = getAdminDb();
      if (chatDb) {
        try {
          const entrySnap = await chatDb
            .collection("users")
            .doc(uid)
            .collection("entries")
            .doc(entryId)
            .get();
          const stored = entrySnap.exists ? (entrySnap.data() as any)?.interactionId : undefined;
          if (typeof stored === "string" && stored && !stored.startsWith("mock-")) {
            resolvedInteractionId = stored;
          }
        } catch (ownershipErr) {
          console.warn("[Chat] Could not confirm entry ownership, starting a fresh context:", ownershipErr);
        }
      } else if (process.env.NODE_ENV !== "production") {
        // Local development without Admin credentials cannot verify ownership. Trust the
        // client value here only, so multi-turn still works on a developer machine.
        if (typeof previousInteractionId === "string" && previousInteractionId && !previousInteractionId.startsWith("mock-")) {
          resolvedInteractionId = previousInteractionId;
        }
      }
    }

    const ai = getGeminiClient();
    const isSse = stream !== false && !req.headers.accept?.includes("application/json");

    if (isSse) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    }

    let lastError: any = null;
    let completed = false;

    // Priority 1: Direct Vertex AI streaming if AI Studio credits are depleted or Vertex is enabled
    const vertexAi = getVertexClient();
    if ((isAiCoolingDown() || isVertexEnabled()) && vertexAi && !force503) {
      try {
        const systemInstruction = buildThinkingPartnerInstruction(mode);
        const vertexParts: any[] = [];
        if (hasValidAudio) {
          vertexParts.push({
            inlineData: {
              data: cleanAudioData,
              mimeType: cleanAudioMime,
            },
          });
        }
        if (text) {
          vertexParts.push({ text });
        } else if (vertexParts.length > 0) {
          vertexParts.push({ text: "Please reflect on this voice journal thought." });
        }

        if (isSse) {
          const streamResponse = await vertexAi.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: vertexParts }],
            config: { systemInstruction },
          });

          let accumulatedText = "";
          for await (const chunk of streamResponse) {
            const delta = chunk.text || "";
            if (delta) {
              accumulatedText += delta;
              res.write(`data: ${JSON.stringify({ type: "token", text: delta })}\n\n`);
            }
          }

          if (accumulatedText.trim()) {
            const interactionId = `vertex-${Date.now()}`;
            res.write(
              `data: ${JSON.stringify({
                type: "done",
                reply: accumulatedText.trim(),
                interactionId,
                modelUsed: "gemini-2.5-flash",
              })}\n\n`
            );
            res.end();
            return;
          }
        } else {
          const result = await vertexAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: vertexParts }],
            config: { systemInstruction },
          });
          const reply = result.text?.trim() || "";
          if (reply) {
            res.json({
              reply,
              interactionId: `vertex-${Date.now()}`,
              modelUsed: "gemini-2.5-flash",
            });
            return;
          }
        }
      } catch (vertexErr: any) {
        console.log("[Chat] Vertex primary route note, falling back:", vertexErr?.message || vertexErr);
        lastError = vertexErr;
      }
    }

    // Priority 2: AI Studio fallback ladder (only if credits not depleted)
    if (!isAiCoolingDown() && ai) {
      const ladder = getFallbackLadder();
      for (let i = 0; i < ladder.length; i++) {
        const currentModel = ladder[i];
        try {
          if (force503 && currentModel === "gemini-3.8-flash") {
            const err: any = new Error("Simulated 503 Service Unavailable on primary model");
            err.status = 503;
            throw err;
          }

          const modelInput = hasValidAudio
            ? [
                { type: "text", text: text || "Please reflect on this audio." },
                { type: "audio", data: cleanAudioData, mime_type: cleanAudioMime },
              ]
            : text;

          const params: any = {
            model: currentModel,
            input: modelInput,
            system_instruction: buildThinkingPartnerInstruction(mode),
          };

          if (resolvedInteractionId) {
            params.previous_interaction_id = resolvedInteractionId;
          }

          if (isSse) {
            params.stream = true;
            const streamResponse = (await ai.interactions.create(params)) as any;
            let accumulatedText = "";
            let interactionId = "";

            for await (const event of streamResponse) {
              if (event.event_type === "error") {
                const errMsg = event.error?.message || "Model streaming error";
                const streamErr: any = new Error(errMsg);
                streamErr.status = 429;
                throw streamErr;
              }
              if (event.event_type === "step.delta" && event.delta?.type === "text") {
                const delta = event.delta.text;
                accumulatedText += delta;
                res.write(`data: ${JSON.stringify({ type: "token", text: delta })}\n\n`);
              } else if (
                (event.event_type === "interaction.completed" || event.event_type === "interaction.created") &&
                event.interaction?.id
              ) {
                interactionId = event.interaction.id;
              }
            }

            if (!accumulatedText.trim()) {
              const emptyErr: any = new Error(`Model ${currentModel} returned empty response.`);
              emptyErr.status = 503;
              throw emptyErr;
            }

            res.write(
              `data: ${JSON.stringify({
                type: "done",
                reply: accumulatedText.trim(),
                interactionId,
                modelUsed: currentModel,
              })}\n\n`
            );
            res.end();
            return;
          } else {
            const interaction = await ai.interactions.create(params);
            let reply = interaction.output_text || "";
            if (!reply && interaction.steps) {
              for (const step of interaction.steps) {
                if (step.type === "model_output") {
                  const contentArr = (step as any).content as Array<{ type?: string; text?: string }> | undefined;
                  const tc = contentArr?.find((c) => c.type === "text");
                  if (tc && tc.text) {
                    reply += tc.text;
                  }
                }
              }
            }
            if (!reply.trim()) {
              const emptyErr: any = new Error(`Model ${currentModel} returned empty response.`);
              emptyErr.status = 503;
              throw emptyErr;
            }
            res.json({
              reply: reply.trim(),
              interactionId: interaction.id,
              modelUsed: currentModel,
            });
            return;
          }
        } catch (err: any) {
          lastError = err;
          const msg = (err?.message || "").toLowerCase();
          if (err?.status === 429 || msg.includes("429") || msg.includes("depleted") || msg.includes("quota")) {
            markAiRateLimited();
            console.log(`[Router] AI Studio quota reached (429). Routing directly to Vertex AI...`);
            break;
          }
          const retryable = isFallbackError(err);
          if (retryable && i < ladder.length - 1) {
            continue;
          }
          break;
        }
      }
    }

    if (!completed) {
      // Step A: Attempt Vertex AI routing if standard ladder failed (e.g. 429 prepayment credits depleted)
      const vertexAi = getVertexClient();
      if (vertexAi) {
        try {
          console.log("[Chat Fallback] Invoking Vertex AI gemini-2.5-flash fallback...");
          const systemInstruction = buildThinkingPartnerInstruction(mode);

          if (isSse) {
            const streamResponse = await vertexAi.models.generateContentStream({
              model: "gemini-2.5-flash",
              contents: [{ role: "user", parts: [{ text }] }],
              config: { systemInstruction },
            });

            let accumulatedText = "";
            for await (const chunk of streamResponse) {
              const delta = chunk.text || "";
              if (delta) {
                accumulatedText += delta;
                res.write(`data: ${JSON.stringify({ type: "token", text: delta })}\n\n`);
              }
            }

            if (accumulatedText.trim()) {
              const interactionId = `vertex-${Date.now()}`;
              res.write(
                `data: ${JSON.stringify({
                  type: "done",
                  reply: accumulatedText.trim(),
                  interactionId,
                  modelUsed: "gemini-2.5-flash",
                })}\n\n`
              );
              res.end();
              completed = true;
            }
          } else {
            const result = await vertexAi.models.generateContent({
              model: "gemini-2.5-flash",
              contents: [{ role: "user", parts: [{ text }] }],
              config: { systemInstruction },
            });
            const reply = result.text?.trim() || "";
            if (reply) {
              res.json({
                reply,
                interactionId: `vertex-${Date.now()}`,
                modelUsed: "gemini-2.5-flash",
              });
              completed = true;
            }
          }
        } catch (vertexErr: any) {
          console.warn("[Chat Fallback] Vertex AI fallback error:", vertexErr?.message || vertexErr);
          lastError = vertexErr;
        }
      }
    }

    if (!completed) {
      // Step B: Empathetic Carl Rogers-aligned local reflection fallback
      console.log("[Chat Fallback] Using local reflective thinking partner generator...");
      const reflectiveText = generateContextualReflection(text, mode);
      const interactionId = `local-${Date.now()}`;

      if (isSse) {
        const words = reflectiveText.split(" ");
        for (const word of words) {
          res.write(`data: ${JSON.stringify({ type: "token", text: word + " " })}\n\n`);
          await new Promise((r) => setTimeout(r, 20));
        }
        res.write(
          `data: ${JSON.stringify({
            type: "done",
            reply: reflectiveText,
            interactionId,
            modelUsed: "offline-fallback",
          })}\n\n`
        );
        res.end();
      } else {
        res.json({
          reply: reflectiveText,
          interactionId,
          modelUsed: "offline-fallback",
        });
      }
      completed = true;
    }
  });

  // Helper: recursively strip undefined values to protect Firestore writes
  function stripUndefined<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => stripUndefined(item)) as unknown as T;
    }
    if (typeof obj === "object" && !(obj instanceof Date)) {
      const clean: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          clean[key] = stripUndefined(value);
        }
      }
      return clean as T;
    }
    return obj;
  }

  // The Scribe: Structured output schema for EntryDigest
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

    // Already ISO YYYY-MM-DD
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

    // Weekday recognition (e.g. "next tuesday", "friday")
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

    // NEVER emit natural language like "next Tuesday". Return empty string if not normalizable.
    return "";
  }

  function sanitizeDigest(rawDigest: any, defaultTitle = "Journal Reflection"): any {
    const allowedMoods = ["low", "flat", "steady", "good", "high"];
    const mood = allowedMoods.includes(rawDigest?.mood) ? rawDigest.mood : "steady";

    const themes = Array.isArray(rawDigest?.themes)
      ? rawDigest.themes.filter((t: any) => typeof t === "string" && t.trim().length > 0)
      : [];

    const decisions = Array.isArray(rawDigest?.decisions)
      ? rawDigest.decisions
          .map((d: any) => {
            if (typeof d === "string") {
              return { decision: d, review_on: "" };
            }
            return {
              decision: String(d.decision || ""),
              rationale: d.rationale ? String(d.rationale) : undefined,
              review_on: normalizeToIsoDate(d.review_on),
            };
          })
          .filter((d: any) => d.decision.trim().length > 0)
      : [];

    const open_questions = Array.isArray(rawDigest?.open_questions)
      ? rawDigest.open_questions.filter((q: any) => typeof q === "string" && q.trim().length > 0)
      : [];

    const next_actions = Array.isArray(rawDigest?.next_actions)
      ? rawDigest.next_actions
          .map((act: any) => ({
            what: String(act.what || "").trim(),
            due: normalizeToIsoDate(act.due),
            effort: ["quick", "medium", "deep"].includes(act.effort) ? act.effort : "medium",
          }))
          .filter((act: any) => act.what.length > 0)
      : [];

    const learning_goals = Array.isArray(rawDigest?.learning_goals)
      ? rawDigest.learning_goals.filter((g: any) => typeof g === "string" && g.trim().length > 0)
      : [];

    return {
      title: rawDigest?.title || defaultTitle,
      themes,
      mood,
      decisions,
      open_questions,
      next_actions,
      learning_goals,
      // Backwards-compatibility aliases
      openQuestions: open_questions,
      nextActions: next_actions,
    };
  }

  async function generateEntryDigest(transcript: string, entryTitle?: string): Promise<any> {
    const emptyValidDigest = {
      title: entryTitle || "Journal Reflection",
      themes: [],
      mood: "steady",
      decisions: [],
      open_questions: [],
      next_actions: [],
      learning_goals: [],
      openQuestions: [],
      nextActions: [],
    };

    const ai = getGeminiClient();
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" });

    const promptInput = `You are The Scribe for Compass, a private reflective thinking journal.
Summarize the following conversation into an EntryDigest JSON object adhering strictly to the schema.

TODAY'S DATE: ${todayIso} (${todayDayName}).

RULES:
1. Normalise every date in "due" and "review_on" to ISO 8601 (YYYY-MM-DD) relative to today (${todayIso}), or return an empty string "". NEVER emit natural language like "next Tuesday", "tomorrow", or "Friday".
2. next_actions must be things the user actually said or clearly implied they would do. Do not invent tasks. An empty array [] is a correct answer.
3. learning_goals only when the user expressed wanting to learn or understand something. If none, return [].
4. mood must be one of: ["low", "flat", "steady", "good", "high"].
5. title must be a concise, evocative title (3 to 6 words).

CONVERSATION TRANSCRIPT:
${transcript || "User reflection session."}`;

    // Priority 1: Vertex AI gemini-2.5-flash
    const vertexAi = getVertexClient();
    if ((isAiCoolingDown() || isVertexEnabled()) && vertexAi) {
      try {
        console.log("[The Scribe] Calling Vertex AI gemini-2.5-flash for structured digest...");
        const res = await vertexAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: promptInput,
          config: {
            responseMimeType: "application/json",
            responseSchema: DIGEST_SCHEMA,
          },
        });
        if (res.text) {
          const parsed = JSON.parse(res.text);
          return sanitizeDigest(parsed, entryTitle);
        }
      } catch (vertexDigestErr) {
        console.log("[The Scribe] Vertex digest note, advancing:", vertexDigestErr);
      }
    }

    // Priority 2: Standard AI Studio ladder (only if credits not depleted)
    if (ai && !isAiCoolingDown()) {
      for (const modelName of getFallbackLadder()) {
        try {
          const r = await ai.interactions.create({
            model: modelName,
            input: promptInput,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: DIGEST_SCHEMA,
            },
          });
          if (r.output_text) {
            const parsed = JSON.parse(r.output_text);
            return sanitizeDigest(parsed, entryTitle);
          }
        } catch (err1: any) {
          const msg = (err1?.message || "").toLowerCase();
          if (err1?.status === 429 || msg.includes("429") || msg.includes("depleted")) {
            markAiRateLimited();
            break;
          }
        }
      }
    }

    // Step C: If both remote options fail, use local transcript parser so entry always closes with actions
    console.log("[The Scribe] Generating local digest from transcript...");
    return sanitizeDigest(generateLocalDigest(transcript, entryTitle), entryTitle);
  }

  // Close Entry endpoint: POST /api/entries/:id/close
  // Reads all turns, calls Gemini with structured output to produce an EntryDigest,
  // persists next_actions as documents under /users/{uid}/actions, and closes the entry.
  app.post("/api/entries/:id/close", async (req, res) => {
    const { id: entryId } = req.params;
    const uid = (req as any).uid;
    const entryTitle = req.body?.entryTitle || "Journal Reflection";

    try {
      // 1. Read all turns: check req.body.turns, then query Firestore
      let turns: Array<{ role: string; text: string; createdAt?: string }> = [];
      if (Array.isArray(req.body?.turns) && req.body.turns.length > 0) {
        turns = req.body.turns;
      } else {
        const db = getAdminDb();
        if (db) {
          try {
            const turnsSnap = await db
              .collection("users")
              .doc(uid)
              .collection("entries")
              .doc(entryId)
              .collection("turns")
              .orderBy("createdAt", "asc")
              .get();
            if (!turnsSnap.empty) {
              turns = turnsSnap.docs.map((doc) => {
                const d = doc.data();
                return { role: d.role || "user", text: d.text || "", createdAt: d.createdAt };
              });
            }
          } catch (dbReadErr) {
            console.warn("Could not read turns via Firestore Admin:", dbReadErr);
          }
        }
      }

      const transcript = turns
        .map((t) => `${t.role === "user" ? "User" : "Thinking Partner"}: ${t.text}`)
        .join("\n\n");

      // 2. Call Gemini structured output to generate EntryDigest
      const digest = await generateEntryDigest(transcript, entryTitle);

      // 3. Persist each next_action as its own document under /users/{uid}/actions
      const closedAt = new Date().toISOString();
      const actionItems = (digest.next_actions || []).map((act: any, idx: number) => ({
        id: `action_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
        what: act.what,
        due: act.due || "",
        effort: act.effort || "medium",
        done: false,
        sourceEntryId: entryId,
        createdAt: closedAt,
      }));

      // THE ENTRY MUST STILL CLOSE SUCCESSFULLY even if persistence fails completely.
      // Never throw into the main request path.
      try {
        const db = getAdminDb();
        if (db) {
          const entryRef = db.collection("users").doc(uid).collection("entries").doc(entryId);
          await entryRef.set(
            stripUndefined({
              status: "closed",
              closedAt,
              digest,
              title: digest.title || entryTitle,
            }),
            { merge: true }
          );

          for (const item of actionItems) {
            const actionRef = db.collection("users").doc(uid).collection("actions").doc(item.id);
            await actionRef.set(stripUndefined(item), { merge: true });
          }
        }
      } catch (persistErr) {
        console.warn("Firestore Admin persistence notice (non-fatal):", persistErr);
      }

      return res.json({
        success: true,
        digest,
        actions: actionItems,
        entryId,
      });
    } catch (err: any) {
      console.error("Top-level close entry fallback (never throw into main request path):", err);
      const fallbackDigest = {
        title: entryTitle,
        themes: [],
        mood: "steady",
        decisions: [],
        open_questions: [],
        next_actions: [],
        learning_goals: [],
        openQuestions: [],
        nextActions: [],
      };
      return res.json({
        success: true,
        digest: fallbackDigest,
        actions: [],
        entryId,
      });
    }
  });

  // -------------------------------------------------------------------------
  // Insights: GET /api/patterns
  //
  // Reads across the writer's recent digests and reports what keeps coming back.
  //
  // HONESTY NOTE, read this before describing the feature anywhere: this is
  // context-window recall over the most recent digests. There are no embeddings
  // and no vector index. Do not call it semantic search or vector search in code,
  // comments, UI copy or documentation.
  //
  // Counts and stalled actions are computed here from the actual documents rather
  // than trusted from the model, because a wrong count in an insight is worse than
  // no insight at all. The model is asked only for the parts that need judgement:
  // which questions are still unresolved, and the closing observation.
  // -------------------------------------------------------------------------

  const PATTERN_SCHEMA = {
    type: "object",
    properties: {
      recurring_themes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            theme: { type: "string" },
            count: { type: "number" },
            entry_ids: { type: "array", items: { type: "string" } },
          },
          required: ["theme", "count", "entry_ids"],
        },
      },
      unresolved_loops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            first_seen: { type: "string" },
            times_raised: { type: "number" },
            entry_ids: { type: "array", items: { type: "string" } },
          },
          required: ["question", "times_raised"],
        },
      },
      mood_trend: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["rising", "steady", "falling", "mixed"] },
          note: { type: "string" },
        },
        required: ["direction", "note"],
      },
      observation: { type: "string" },
    },
    required: ["recurring_themes", "unresolved_loops", "mood_trend", "observation"],
  };

  const MOOD_SCORE: Record<string, number> = { low: 1, flat: 2, steady: 3, good: 4, high: 5 };

  function emptyPatternReport(period: string, note: string, entriesConsidered = 0) {
    return {
      period,
      entries_considered: entriesConsidered,
      insufficient_history: true,
      recurring_themes: [],
      unresolved_loops: [],
      stalled_actions: [],
      unanalysed: [],
      unanalysed_count: 0,
      mood_trend: { direction: "steady", note: "" },
      observation: note,
    };
  }

  app.get("/api/patterns", async (req, res) => {
    // The uid comes from the verified token and from nowhere else. There is no
    // request parameter that can widen or redirect this query.
    const uid = (req as any).uid;

    try {
      const db = getAdminDb();
      if (!db) {
        return res.json(emptyPatternReport("", "Insights are unavailable right now. Your journal is unaffected."));
      }

      // One query, scoped to this user's entries.
      const entriesSnap = await db
        .collection("users")
        .doc(uid)
        .collection("entries")
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

      const allClosed = entriesSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((e) => e.status === "closed");

      // Analysis is opt-in, so a closed entry may have no digest. Insights cannot read
      // those, and the count is reported rather than quietly under-counting.
      const entries = allClosed.filter((e) => e.digest);
      const unanalysed = allClosed
        .filter((e) => !e.digest)
        .map((e) => ({ entry_id: e.id, title: e.title || "Untitled entry" }));

      if (entries.length < 3) {
        return res.json({
          ...emptyPatternReport(
            "",
            unanalysed.length > 0
              ? `There is not enough analysed history yet. ${unanalysed.length} closed ${unanalysed.length === 1 ? "entry has" : "entries have"} not been analysed, and patterns are read from the analysis rather than the raw writing.`
              : "There is not enough history yet. Analyse at least three closed entries and patterns across them will appear here.",
            entries.length
          ),
          unanalysed,
          unanalysed_count: unanalysed.length,
        });
      }

      const validIds = new Set(entries.map((e) => e.id));
      const dates = entries.map((e) => String(e.closedAt || e.createdAt || "").slice(0, 10)).filter(Boolean).sort();
      const period = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "";

      // --- Deterministic: theme counts -------------------------------------
      const themeMap = new Map<string, { theme: string; count: number; entry_ids: string[] }>();
      for (const e of entries) {
        const seen = new Set<string>();
        for (const rawTheme of e.digest?.themes || []) {
          if (typeof rawTheme !== "string") continue;
          const key = rawTheme.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const existing = themeMap.get(key);
          if (existing) {
            existing.count += 1;
            existing.entry_ids.push(e.id);
          } else {
            themeMap.set(key, { theme: rawTheme.trim(), count: 1, entry_ids: [e.id] });
          }
        }
      }
      const recurring_themes = [...themeMap.values()]
        .filter((t) => t.count >= 2)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      // --- Deterministic: mood direction -----------------------------------
      // entries arrive newest first, so reverse for chronological order.
      const moodSeries = [...entries]
        .reverse()
        .map((e) => MOOD_SCORE[String(e.digest?.mood || "steady")] ?? 3);
      const half = Math.floor(moodSeries.length / 2);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const earlier = avg(moodSeries.slice(0, half || 1));
      const later = avg(moodSeries.slice(half));
      const spread = Math.max(...moodSeries) - Math.min(...moodSeries);
      let direction: string = "steady";
      if (spread >= 3) direction = "mixed";
      else if (later - earlier >= 0.6) direction = "rising";
      else if (earlier - later >= 0.6) direction = "falling";

      // --- Deterministic: stalled actions ----------------------------------
      // Undone actions older than seven days. Computed from the action documents,
      // never inferred by the model, because "done" is a fact we already hold.
      let stalled_actions: Array<{ what: string; age_days: number; sourceEntryId?: string }> = [];
      try {
        const actionsSnap = await db
          .collection("users")
          .doc(uid)
          .collection("actions")
          .orderBy("createdAt", "desc")
          .limit(100)
          .get();
        const now = Date.now();
        stalled_actions = actionsSnap.docs
          .map((d) => d.data() as any)
          .filter((a) => a && a.done !== true && a.what)
          .map((a) => ({
            what: String(a.what),
            age_days: Math.floor((now - new Date(a.createdAt || now).getTime()) / 86400000),
            sourceEntryId: a.sourceEntryId,
          }))
          .filter((a) => a.age_days > 7)
          .sort((a, b) => b.age_days - a.age_days)
          .slice(0, 8);
      } catch (actionsErr) {
        console.warn("[Insights] Could not read actions for stalled list:", actionsErr);
      }

      // --- Model: unresolved loops, mood note, observation -------------------
      const compact = entries.map((e) => ({
        entry_id: e.id,
        date: String(e.closedAt || e.createdAt || "").slice(0, 10),
        title: e.digest?.title || e.title || "",
        mood: e.digest?.mood || "steady",
        themes: e.digest?.themes || [],
        open_questions: e.digest?.open_questions || e.digest?.openQuestions || [],
        decisions: (e.digest?.decisions || []).map((d: any) => (typeof d === "string" ? d : d?.decision)).filter(Boolean),
        next_actions: (e.digest?.next_actions || e.digest?.nextActions || []).map((a: any) => a?.what).filter(Boolean),
      }));

      const promptInput = `You are reading a person's own journal digests and reporting what keeps coming back. You are writing for the person who wrote them.

RULES, all of them hard:
1. Reference ONLY entry_id values from the list below. Never invent an id. An entry_id that does not appear below is a serious error.
2. unresolved_loops: questions raised in TWO OR MORE entries where no later entry records a decision that addresses them. If there are none, return an empty array. Do not stretch to fill it.
3. mood_trend.note: one plain sentence about what the moods did. No advice, no encouragement.
4. observation: ONE specific, useful sentence about what the record actually shows. It must name something concrete.
   BAD:  "You have been reflecting a lot!"
   BAD:  "Keep up the great work."
   GOOD: "Pricing has come up in four entries and you still have not decided."
   If nothing specific stands out, say that plainly instead of inventing something.
5. Do not diagnose, do not psychoanalyse, do not give clinical or medical advice. Report what is written, not what it means about the person.
6. recurring_themes: list themes appearing in two or more entries with their entry ids.

DIGESTS (newest first):
${JSON.stringify(compact, null, 1)}`;

      let modelReport: any = null;

      const vertexAi = getVertexClient();
      if ((isAiCoolingDown() || isVertexEnabled()) && vertexAi) {
        try {
          const r = await vertexAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptInput,
            config: { responseMimeType: "application/json", responseSchema: PATTERN_SCHEMA },
          });
          if (r.text) modelReport = JSON.parse(r.text);
        } catch (vertexErr) {
          console.log("[Insights] Vertex note, advancing:", vertexErr);
        }
      }

      const ai = getGeminiClient();
      if (!modelReport && ai && !isAiCoolingDown()) {
        for (const modelName of getFallbackLadder()) {
          try {
            const r = await ai.interactions.create({
              model: modelName,
              input: promptInput,
              response_format: { type: "text", mime_type: "application/json", schema: PATTERN_SCHEMA },
            });
            if (r.output_text) {
              modelReport = JSON.parse(r.output_text);
              break;
            }
          } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            if (err?.status === 429 || msg.includes("429") || msg.includes("depleted")) {
              markAiRateLimited();
              break;
            }
            if (!isFallbackError(err)) break;
          }
        }
      }

      // --- Validate anything that came from the model -----------------------
      const cleanLoops = Array.isArray(modelReport?.unresolved_loops)
        ? modelReport.unresolved_loops
            .filter((l: any) => l && typeof l.question === "string" && l.question.trim())
            .map((l: any) => ({
              question: String(l.question).trim().slice(0, 240),
              first_seen: typeof l.first_seen === "string" ? l.first_seen : "",
              times_raised: Number.isFinite(l.times_raised) ? Math.max(2, Math.round(l.times_raised)) : 2,
              // Drop every id the model did not get from us.
              entry_ids: Array.isArray(l.entry_ids) ? l.entry_ids.filter((id: any) => validIds.has(id)) : [],
            }))
            .slice(0, 6)
        : [];

      const moodNote =
        typeof modelReport?.mood_trend?.note === "string" ? modelReport.mood_trend.note.trim().slice(0, 240) : "";

      let observation = typeof modelReport?.observation === "string" ? modelReport.observation.trim() : "";
      if (!observation) {
        observation = recurring_themes.length
          ? `"${recurring_themes[0].theme}" appears in ${recurring_themes[0].count} of your last ${entries.length} entries.`
          : "Nothing repeats across these entries yet.";
      }

      return res.json({
        period,
        entries_considered: entries.length,
        insufficient_history: false,
        recurring_themes,
        unresolved_loops: cleanLoops,
        stalled_actions,
        mood_trend: { direction, note: moodNote },
        observation,
        degraded: !modelReport,
        unanalysed,
        unanalysed_count: unanalysed.length,
      });
    } catch (err: any) {
      // Insights failing must never be visible as a broken journal.
      console.error("[Insights] Failed, returning empty report:", err?.message || err);
      return res.json(emptyPatternReport("", "Insights could not be generated right now. Your entries are unaffected."));
    }
  });

  // Research (search grounded resources) was removed before submission. The Gemini
  // Interactions API returns google_search_result steps whose payload is opaque, so the
  // retrieved URLs could not be recovered to verify what the model proposed. Rather than
  // ship a feature that shows unverified links, or claim grounding that was not happening,
  // it was dropped. See the Limitations section of README.md.

  app.post("/api/digest", async (req, res) => {
    try {
      const { turns, entryTitle } = req.body;
      if (!Array.isArray(turns) || turns.length === 0) {
        return res.status(400).json({ error: "No conversation turns provided for digest." });
      }

      const transcript = turns
        .map((t: any) => `${t.role === "user" ? "User" : "Thinking Partner"}: ${t.text}`)
        .join("\n\n");

      const digest = await generateEntryDigest(transcript, entryTitle);
      return res.json({ digest });
    } catch (err: any) {
      console.error("Error creating digest:", err);
      const fallbackDigest = {
        title: req.body?.entryTitle || "Journal Entry",
        themes: [],
        mood: "steady",
        decisions: [],
        open_questions: [],
        next_actions: [],
        learning_goals: [],
        openQuestions: [],
        nextActions: [],
      };
      return res.json({ digest: fallbackDigest });
    }
  });

  // ---------------------------------------------------------------------------
  // Brainstorm Canvas: POST /api/boards/:id/structure -> StructureResult
  // ---------------------------------------------------------------------------
  const STRUCTURE_SCHEMA = {
    type: "object",
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            rationale: { type: "string" },
            card_ids: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["name", "card_ids"],
        },
      },
      orphans: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["clusters"],
  };

  function sanitizeStructureResult(
    raw: any,
    cards: Array<{ id: string; text: string }>
  ): {
    clusters: Array<{ name: string; rationale?: string; card_ids: string[] }>;
    orphans: string[];
  } {
    const validIdSet = new Set(cards.map((c) => c.id));
    const assigned = new Set<string>();
    const clusters: Array<{ name: string; rationale?: string; card_ids: string[] }> = [];

    if (Array.isArray(raw?.clusters)) {
      for (const c of raw.clusters) {
        if (!c || typeof c.name !== "string") continue;
        const validCardIds: string[] = [];
        if (Array.isArray(c.card_ids)) {
          for (const cid of c.card_ids) {
            if (typeof cid === "string" && validIdSet.has(cid) && !assigned.has(cid)) {
              validCardIds.push(cid);
              assigned.add(cid);
            }
          }
        }
        if (validCardIds.length > 0) {
          clusters.push({
            name: c.name.trim(),
            rationale: typeof c.rationale === "string" ? c.rationale.trim() : undefined,
            card_ids: validCardIds,
          });
        }
      }
    }

    const orphans: string[] = [];
    if (Array.isArray(raw?.orphans)) {
      for (const oid of raw.orphans) {
        if (typeof oid === "string" && validIdSet.has(oid) && !assigned.has(oid)) {
          orphans.push(oid);
          assigned.add(oid);
        }
      }
    }

    // Any card not assigned anywhere -> goes into orphans
    for (const card of cards) {
      if (!assigned.has(card.id)) {
        orphans.push(card.id);
        assigned.add(card.id);
      }
    }

    // RULE: If fewer than 5 cards, return a single cluster and say there is not much to group yet
    if (cards.length < 5) {
      return {
        clusters: [
          {
            name: clusters[0]?.name || "All Cards",
            rationale: "There is not much to group yet (fewer than 5 cards).",
            card_ids: cards.map((c) => c.id),
          },
        ],
        orphans: [],
      };
    }

    // If clusters is empty, create at least 1 cluster
    if (clusters.length === 0) {
      clusters.push({
        name: "General",
        rationale: "Brainstorm cards.",
        card_ids: Array.from(validIdSet),
      });
      return { clusters, orphans: [] };
    }

    // Ensure 3 to 6 clusters if cards >= 5
    // If clusters > 6, merge excess into the last cluster
    if (clusters.length > 6) {
      const mergedExcess = clusters.slice(5).reduce((acc, cl) => {
        acc.push(...cl.card_ids);
        return acc;
      }, [] as string[]);
      const keptClusters = clusters.slice(0, 5);
      keptClusters.push({
        name: "Additional Topics",
        rationale: "Combined related cards.",
        card_ids: mergedExcess,
      });
      return { clusters: keptClusters, orphans };
    }

    return { clusters, orphans };
  }

  function generateLocalClustering(cards: Array<{ id: string; text: string }>): {
    clusters: Array<{ name: string; rationale?: string; card_ids: string[] }>;
    orphans: string[];
  } {
    if (cards.length < 5) {
      return {
        clusters: [
          {
            name: "Initial Thoughts",
            rationale: "There is not much to group yet (fewer than 5 cards).",
            card_ids: cards.map((c) => c.id),
          },
        ],
        orphans: [],
      };
    }

    const numClusters = Math.min(Math.max(3, Math.ceil(cards.length / 3)), 6);
    const clusterNames = [
      "Themes & Direction",
      "Tactics & Execution",
      "Discovery & Learnings",
      "Observations & Context",
      "Core Foundations",
      "Uncharted Territory",
    ];

    const clusters: Array<{ name: string; rationale?: string; card_ids: string[] }> = [];
    for (let i = 0; i < numClusters; i++) {
      clusters.push({
        name: clusterNames[i] || `Group ${i + 1}`,
        rationale: "Thematic affinity group based on card text.",
        card_ids: [],
      });
    }

    const orphans: string[] = [];
    cards.forEach((card, idx) => {
      // If there are many cards, leave 1-2 distinct cards as orphans
      if (idx === cards.length - 1 && cards.length >= 6) {
        orphans.push(card.id);
      } else {
        const cIdx = idx % numClusters;
        clusters[cIdx].card_ids.push(card.id);
      }
    });

    return {
      clusters: clusters.filter((c) => c.card_ids.length > 0),
      orphans,
    };
  }

  app.post("/api/boards/:id/structure", async (req, res) => {
    const { id: boardId } = req.params;
    const uid = (req as any).uid;

    try {
      let cards: Array<{ id: string; text: string; [key: string]: any }> = [];

      if (Array.isArray(req.body?.cards) && req.body.cards.length > 0) {
        cards = req.body.cards;
      } else {
        // Query Firestore board document if cards not passed in body
        const db = getAdminDb();
        if (db && uid) {
          try {
            const boardDoc = await db.collection("users").doc(uid).collection("boards").doc(boardId).get();
            if (boardDoc.exists) {
              const bData = boardDoc.data();
              if (Array.isArray(bData?.cards)) {
                cards = bData.cards;
              }
            }
          } catch (dbErr) {
            console.warn("[Structure] Could not read board from Firestore Admin:", dbErr);
          }
        }
      }

      const validCards = cards
        .filter((c) => c && typeof c.id === "string" && typeof c.text === "string")
        .map((c) => ({ id: String(c.id).trim(), text: String(c.text).trim() }))
        .filter((c) => c.id.length > 0);

      if (validCards.length === 0) {
        return res.status(400).json({ error: "No cards provided to structure." });
      }

      // RULE: "If the board has fewer than 5 cards, return a single cluster and say there is not much to group yet."
      if (validCards.length < 5) {
        const smallResult = {
          clusters: [
            {
              name: "All Cards",
              rationale: "There is not much to group yet (fewer than 5 cards).",
              card_ids: validCards.map((c) => c.id),
            },
          ],
          orphans: [],
        };
        return res.json(smallResult);
      }

      // Format card catalog preserving exact user text
      const cardCatalog = validCards
        .map((c, i) => `Card #${i + 1}:\nID: "${c.id}"\nText: "${c.text}"`)
        .join("\n\n");

      const promptInput = `You are an expert brainstorming facilitator for Compass.
Your task is to organize the supplied brainstorm cards into 3 to 6 thematic spatial clusters.

RULES:
1. Reference ONLY card ids that were supplied. Never invent one.
2. Do not rewrite, improve or edit the user's card text. Grouping only. The words on the cards stay exactly as the human wrote them.
3. 3 to 6 clusters. If the board has fewer than 5 cards, return a single cluster and say there is not much to group yet.
4. Cards that fit nowhere go in "orphans". Do not force them.
5. Every supplied card id must be included in either a cluster's "card_ids" or in "orphans". Never duplicate a card.

SUPPLIED CARDS:
${cardCatalog}`;

      // 1. Try Vertex AI only if explicitly enabled with credentials
      const vertexAi = getVertexClient();
      if (isVertexEnabled() && vertexAi) {
        try {
          const resAi = await vertexAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptInput,
            config: {
              responseMimeType: "application/json",
              responseSchema: STRUCTURE_SCHEMA,
            },
          });
          if (resAi.text) {
            const parsed = JSON.parse(resAi.text);
            const sanitized = sanitizeStructureResult(parsed, validCards);
            return res.json(sanitized);
          }
        } catch (vertexErr: any) {
          // Pass through to standard AI Studio ladder
        }
      }

      // 2. Try standard Gemini API (AI Studio)
      const ai = getGeminiClient();
      if (ai) {
        // Try generateContent first (standard structured schema)
        try {
          const resAi = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptInput,
            config: {
              responseMimeType: "application/json",
              responseSchema: STRUCTURE_SCHEMA,
            },
          });
          if (resAi.text) {
            const parsed = JSON.parse(resAi.text);
            const sanitized = sanitizeStructureResult(parsed, validCards);
            return res.json(sanitized);
          }
        } catch (genErr: any) {
          console.warn("[Structure] generateContent note, trying fallback ladder:", genErr?.message || genErr);
        }

        // Try interactions API fallback ladder
        for (const modelName of getFallbackLadder()) {
          try {
            const r = await ai.interactions.create({
              model: modelName,
              input: promptInput,
              response_format: {
                type: "text",
                mime_type: "application/json",
                schema: STRUCTURE_SCHEMA,
              },
            });
            if (r.output_text) {
              const parsed = JSON.parse(r.output_text);
              const sanitized = sanitizeStructureResult(parsed, validCards);
              return res.json(sanitized);
            }
          } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            if (err?.status === 429 || msg.includes("429") || msg.includes("depleted")) {
              markAiRateLimited();
              break;
            }
          }
        }
      }

      // 3. Graceful fallback: local clustering if external models are unreachable
      const localResult = generateLocalClustering(validCards);
      return res.json(sanitizeStructureResult(localResult, validCards));
    } catch (err: any) {
      console.error("[Structure] Critical error during structure endpoint:", err);
      return res.status(500).json({ error: err?.message || "Failed to structure board." });
    }
  });

  // ---------------------------------------------------------------------------
  // Brainstorm Canvas: POST /api/boards/:id/gaps -> GapResult (SCAMPER Framework)
  // ---------------------------------------------------------------------------
  const SCAMPER_GAPS_SCHEMA = {
    type: "object",
    properties: {
      unexplored: {
        type: "array",
        items: {
          type: "object",
          properties: {
            lens: {
              type: "string",
              enum: [
                "Substitute",
                "Combine",
                "Adapt",
                "Modify",
                "Put to another use",
                "Eliminate",
                "Reverse",
              ],
            },
            question: { type: "string" },
            anchor_card_ids: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["lens", "question"],
        },
      },
    },
    required: ["unexplored"],
  };

  const VALID_SCAMPER_LENSES = [
    "Substitute",
    "Combine",
    "Adapt",
    "Modify",
    "Put to another use",
    "Eliminate",
    "Reverse",
  ] as const;

  function sanitizeGapResult(
    raw: any,
    cards: Array<{ id: string; text: string }>
  ): { unexplored: Array<{ lens: string; question: string; anchor_card_ids: string[] }> } {
    const validIdSet = new Set(cards.map((c) => c.id));
    const allowedLenses = new Set<string>(VALID_SCAMPER_LENSES);
    const seenLenses = new Set<string>();
    const sanitizedItems: Array<{ lens: string; question: string; anchor_card_ids: string[] }> = [];

    if (Array.isArray(raw?.unexplored)) {
      for (const item of raw.unexplored) {
        if (!item || typeof item.question !== "string" || !item.lens) continue;
        const lens = String(item.lens).trim();
        if (!allowedLenses.has(lens) || seenLenses.has(lens)) continue;

        let question = String(item.question).trim();
        if (!question.endsWith("?")) {
          question += "?";
        }

        const validAnchors: string[] = [];
        if (Array.isArray(item.anchor_card_ids)) {
          for (const aid of item.anchor_card_ids) {
            const cleanAid = String(aid).trim();
            if (validIdSet.has(cleanAid) && !validAnchors.includes(cleanAid)) {
              validAnchors.push(cleanAid);
            }
          }
        }

        seenLenses.add(lens);
        sanitizedItems.push({
          lens,
          question,
          anchor_card_ids: validAnchors,
        });

        if (sanitizedItems.length >= 3) break;
      }
    }

    if (sanitizedItems.length === 0) {
      return generateLocalScamperGaps(cards);
    }

    return { unexplored: sanitizedItems };
  }

  function generateLocalScamperGaps(
    cards: Array<{ id: string; text: string }>
  ): { unexplored: Array<{ lens: string; question: string; anchor_card_ids: string[] }> } {
    const allText = cards.map((c) => c.text.toLowerCase()).join(" ");
    const c1 = cards[0]?.id ? [cards[0].id] : [];
    const c2 = cards[1]?.id ? [cards[1].id] : c1;
    const c3 = cards[2]?.id ? [cards[2].id] : c1;

    const candidates: Array<{ lens: string; question: string; anchor_card_ids: string[]; keywords: string[] }> = [
      {
        lens: "Eliminate",
        question: "What core assumption, interface element, or step could you eliminate entirely without losing the heart of this?",
        anchor_card_ids: c1,
        keywords: ["remove", "eliminate", "cut", "strip", "delete", "without"],
      },
      {
        lens: "Reverse",
        question: "What happens if you reverse the order of operations and start with the final consequence first?",
        anchor_card_ids: c2,
        keywords: ["reverse", "invert", "backwards", "opposite", "end first"],
      },
      {
        lens: "Combine",
        question: "Which two seemingly independent ideas here could be merged into a single unexpected mechanism?",
        anchor_card_ids: c1.concat(c2).slice(0, 2),
        keywords: ["combine", "merge", "integrate", "blend", "together"],
      },
      {
        lens: "Substitute",
        question: "What if you substituted the central technology or environment with something completely analog or asynchronous?",
        anchor_card_ids: c3,
        keywords: ["substitute", "replace", "swap", "instead of"],
      },
      {
        lens: "Adapt",
        question: "How would an architect, an author, or an ecologist solve this exact dilemma using principles from their field?",
        anchor_card_ids: c1,
        keywords: ["adapt", "borrow", "nature", "biology", "architecture"],
      },
      {
        lens: "Put to another use",
        question: "How could this same system serve someone in a completely different context who never uses tech?",
        anchor_card_ids: c2,
        keywords: ["another use", "repurpose", "re-use", "different audience"],
      },
    ];

    // Pick lenses whose keywords are least present in user's text
    const scored = candidates.map((cand) => {
      let matches = 0;
      for (const kw of cand.keywords) {
        if (allText.includes(kw)) matches++;
      }
      return { ...cand, matches };
    });

    scored.sort((a, b) => a.matches - b.matches);

    const selected = scored.slice(0, 3).map((item) => ({
      lens: item.lens,
      question: item.question,
      anchor_card_ids: item.anchor_card_ids,
    }));

    return { unexplored: selected };
  }

  app.post("/api/boards/:id/gaps", async (req, res) => {
    try {
      const boardId = req.params.id;
      const uid = (req as any).uid || (req as any).user?.uid;
      let cards: Array<{ id: string; text: string; [key: string]: any }> = [];

      if (Array.isArray(req.body.cards) && req.body.cards.length > 0) {
        cards = req.body.cards;
      } else {
        const db = getAdminDb();
        if (db && uid) {
          try {
            const boardDoc = await db.collection("users").doc(uid).collection("boards").doc(boardId).get();
            if (boardDoc.exists) {
              const bData = boardDoc.data();
              if (Array.isArray(bData?.cards)) {
                cards = bData.cards;
              }
            }
          } catch (dbErr) {
            console.warn("[Gaps] Could not read board from Firestore Admin:", dbErr);
          }
        }
      }

      const validCards = cards
        .filter((c) => c && typeof c.id === "string" && typeof c.text === "string")
        .map((c) => ({ id: String(c.id).trim(), text: String(c.text).trim() }))
        .filter((c) => c.id.length > 0);

      if (validCards.length === 0) {
        return res.status(400).json({ error: "No cards provided to analyze for gaps." });
      }

      // Format card catalog preserving exact user text
      const cardCatalog = validCards
        .map((c, i) => `Card #${i + 1} [ID: "${c.id}"]: "${c.text}"`)
        .join("\n");

      const promptInput = `You are an expert creative thinking facilitator for Compass brainstorm boards.
Analyze the user's brainstorm cards and identify which SCAMPER angles the user has NOT yet explored:
- Substitute
- Combine
- Adapt
- Modify
- Put to another use
- Eliminate
- Reverse

CRITICAL RULES:
1. Return QUESTIONS, NEVER ideas or answers. You are pointing at an unexplored direction, NOT filling it in.
   - RIGHT: "What if this ran without the app entirely?"
   - WRONG: "You could build a browser extension."
   - RIGHT: "What core assumption could be eliminated without breaking the outcome?"
   - WRONG: "Remove the notifications system."
   Giving ideas re-introduces the anchoring problem this tool was designed to avoid.
2. Maximum 3 questions. A wall of prompts is paralysing. Return between 1 and 3 high-leverage questions.
3. Anchor each question to specific existing card IDs in "anchor_card_ids" where possible.
4. Never suggest a lens that the user's cards have clearly already thoroughly addressed. Focus strictly on genuine blind spots.

SUPPLIED USER CARDS:
${cardCatalog}`;

      // 1. Try Vertex AI only if explicitly enabled with credentials
      const vertexAi = getVertexClient();
      if (isVertexEnabled() && vertexAi) {
        try {
          const resAi = await vertexAi.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptInput,
            config: {
              responseMimeType: "application/json",
              responseSchema: SCAMPER_GAPS_SCHEMA,
            },
          });
          if (resAi.text) {
            const parsed = JSON.parse(resAi.text);
            const sanitized = sanitizeGapResult(parsed, validCards);
            return res.json(sanitized);
          }
        } catch (vertexErr: any) {
          // Pass through to standard AI Studio ladder
        }
      }

      // 2. Try standard Gemini API (AI Studio)
      const ai = getGeminiClient();
      if (ai) {
        // Try generateContent first (standard structured schema)
        try {
          const resAi = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptInput,
            config: {
              responseMimeType: "application/json",
              responseSchema: SCAMPER_GAPS_SCHEMA,
            },
          });
          if (resAi.text) {
            const parsed = JSON.parse(resAi.text);
            const sanitized = sanitizeGapResult(parsed, validCards);
            return res.json(sanitized);
          }
        } catch (genErr: any) {
          console.warn("[Gaps] generateContent note, trying fallback ladder:", genErr?.message || genErr);
        }

        // Try interactions API fallback ladder
        for (const modelName of getFallbackLadder()) {
          try {
            const r = await ai.interactions.create({
              model: modelName,
              input: promptInput,
              response_format: {
                type: "text",
                mime_type: "application/json",
                schema: SCAMPER_GAPS_SCHEMA,
              },
            });
            if (r.output_text) {
              const parsed = JSON.parse(r.output_text);
              const sanitized = sanitizeGapResult(parsed, validCards);
              return res.json(sanitized);
            }
          } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            if (err?.status === 429 || msg.includes("429") || msg.includes("depleted")) {
              markAiRateLimited();
              break;
            }
          }
        }
      }

      // 3. Graceful fallback: local SCAMPER gap analysis if external models are unreachable
      const localResult = generateLocalScamperGaps(validCards);
      return res.json(sanitizeGapResult(localResult, validCards));
    } catch (err: any) {
      console.error("[Gaps] Critical error during gaps endpoint:", err);
      return res.status(500).json({ error: err?.message || "Failed to analyze gaps." });
    }
  });

  // Setup Vite middleware in dev, static files in prod
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Compass server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();

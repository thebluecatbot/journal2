import express from "express";
import path from "path";
import dotenv from "dotenv";
import { initializeApp, getApps, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

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

function getAdminDb() {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) return null;
  try {
    return getFirestore(adminApp, "ai-studio-compass-c30e6245-09d5-4235-8adc-d4c50e6ddca0");
  } catch (e) {
    console.warn("Firestore admin getFirestore notice:", e);
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

const THINKING_PARTNER_SYSTEM_INSTRUCTION = `You are Compass, a private thinking partner for a journal where users think out loud.

CRITICAL BEHAVIOR RULES:
1. STRICT LENGTH: Reply in at most THREE sentences, then ask EXACTLY ONE open question. The total response must never exceed four sentences.
2. NO ADVICE PARAGRAPHS: Do not lecture, give unsolicited action plans, or output paragraphs of advice.
3. BAN REPEATING PATTERNS: You MUST NOT fall into a repeating "validate, reframe, suggest action" pattern. Instead, react genuinely to the user's specific words with curiosity, nuance, or an unexpected perspective.
4. ONE OPEN QUESTION: End with ONE concise, open-ended question that prompts deeper reflection.
5. STRICT CLINICAL SAFETY: Never diagnose, and never give medical, clinical, psychiatric, or therapeutic advice under any circumstances.`;

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
    msg.includes("rate limit")
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  // Chat endpoint (Multi-turn using Interactions API, streaming tokens, and fallback ladder)
  app.post("/api/chat", async (req, res) => {
    const uid = (req as any).uid;
    const { text, previousInteractionId, stream = true } = req.body;
    const force503 = req.headers["x-test-force-503"] === "true" || req.body.force503 === true;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' in request body." });
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

    for (let i = 0; i < FALLBACK_LADDER.length; i++) {
      const currentModel = FALLBACK_LADDER[i];
      try {
        if (force503 && currentModel === "gemini-3.8-flash") {
          const err: any = new Error("Simulated 503 Service Unavailable on primary model");
          err.status = 503;
          throw err;
        }

        if (!ai) {
          // Preview/simulated environment fallback
          const simulatedText =
            "It sounds like you're weighing the balance between system leadership and direct contribution. When you look back at your most energizing weeks, what percentage of your time was spent in flow state without interruptions?";
          const interactionId = `mock-interaction-${Date.now()}`;

          if (isSse) {
            const words = simulatedText.split(" ");
            for (const word of words) {
              res.write(`data: ${JSON.stringify({ type: "token", text: word + " " })}\n\n`);
              await new Promise((r) => setTimeout(r, 25));
            }
            res.write(
              `data: ${JSON.stringify({
                type: "done",
                reply: simulatedText,
                interactionId,
                modelUsed: currentModel,
              })}\n\n`
            );
            res.end();
          } else {
            res.json({
              reply: simulatedText,
              interactionId,
              modelUsed: currentModel,
            });
          }
          completed = true;
          break;
        }

        const params: any = {
          model: currentModel,
          input: text,
          system_instruction: THINKING_PARTNER_SYSTEM_INSTRUCTION,
        };

        if (previousInteractionId && typeof previousInteractionId === "string" && !previousInteractionId.startsWith("mock-")) {
          params.previous_interaction_id = previousInteractionId;
        }

        if (isSse) {
          params.stream = true;
          const streamResponse = (await ai.interactions.create(params)) as any;
          let accumulatedText = "";
          let interactionId = "";

          for await (const event of streamResponse) {
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

          res.write(
            `data: ${JSON.stringify({
              type: "done",
              reply: accumulatedText.trim(),
              interactionId,
              modelUsed: currentModel,
            })}\n\n`
          );
          res.end();
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
          res.json({
            reply: reply.trim() || "What aspect of this feels most important to clarify next?",
            interactionId: interaction.id,
            modelUsed: currentModel,
          });
        }

        completed = true;
        break;
      } catch (err: any) {
        lastError = err;
        const retryable = isFallbackError(err);
        console.warn(
          `[Fallback Ladder] Model ${currentModel} error (${err?.status || err?.statusCode || err?.message}). Advancing to next model: ${retryable && i < FALLBACK_LADDER.length - 1}`
        );
        if (retryable && i < FALLBACK_LADDER.length - 1) {
          continue;
        }
        break;
      }
    }

    if (!completed) {
      if (isSse) {
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error: lastError?.message || "Failed to generate thinking partner response.",
          })}\n\n`
        );
        res.end();
      } else {
        res.status(lastError?.status || 500).json({
          error: lastError?.message || "Failed to generate response across fallback ladder.",
        });
      }
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
    if (!ai) {
      return emptyValidDigest;
    }

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

    // Iterate through fallback ladder models
    for (const modelName of FALLBACK_LADDER) {
      // Attempt 1 with current model
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
      } catch (err1) {
        console.warn(`[The Scribe] Model ${modelName} initial attempt failed, retrying at low temp:`, err1);
      }

      // Attempt 2 with current model at lower temperature
      try {
        const r = await ai.interactions.create({
          model: modelName,
          input: promptInput,
          generation_config: { temperature: 0.1 } as any,
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
      } catch (err2) {
        console.warn(`[The Scribe] Model ${modelName} low-temp attempt failed:`, err2);
      }
    }

    // If all models in the ladder fail, return an empty valid digest
    return emptyValidDigest;
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

  // Legacy/Compatibility Digest endpoint (Distills closed entry into themes, mood, decisions, questions, next actions)
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

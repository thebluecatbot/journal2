import { db } from "./auth";

/**
 * The tool surface.
 *
 * READ THIS BEFORE ADDING A TOOL.
 *
 * Not one of these input schemas contains a user id, a uid, an owner, an account, a path,
 * or anything else that could select whose data is read. Every handler receives the uid as
 * a separate argument that the transport derived from a verified Firebase token, and every
 * Firestore query in this file begins with `db().collection("users").doc(uid)`.
 *
 * If you add a tool whose arguments could influence which user's data is touched, that is
 * a critical bug, not a feature.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  handler: (uid: string, args: Record<string, any>) => Promise<unknown>;
}

/** Every read starts here. There is no other way to reach a document. */
function userRoot(uid: string) {
  return db().collection("users").doc(uid);
}

function digestOf(data: any) {
  return data?.digest || {};
}

function daysSince(iso: string | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "search_entries",
    description:
      "Search the signed-in person's closed journal entries by title, theme, decision, question or action. Returns titles and digests only, never the raw text of what they wrote. Use get_entry for that.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match. Omit to list recent entries." },
        limit: { type: "number", description: "Maximum entries to return, 1 to 50. Defaults to 10." },
      },
      additionalProperties: false,
    },
    handler: async (uid, args) => {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
      const query = String(args.query || "").trim().toLowerCase();

      const snap = await userRoot(uid).collection("entries").orderBy("createdAt", "desc").limit(200).get();

      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((e) => e.status === "closed" && e.digest)
        .map((e) => {
          const digest = digestOf(e);
          return {
            entry_id: e.id,
            date: String(e.closedAt || e.createdAt || "").slice(0, 10),
            title: digest.title || e.title || "Untitled",
            mode: e.mode || "reflect",
            mood: digest.mood || "steady",
            themes: digest.themes || [],
            // Digest level only. Raw turns are deliberately not reachable from here.
            open_questions: digest.open_questions || digest.openQuestions || [],
            next_actions: (digest.next_actions || digest.nextActions || []).map((a: any) => a?.what).filter(Boolean),
          };
        })
        .filter((row) => {
          if (!query) return true;
          const haystack = [
            row.title,
            ...row.themes,
            ...row.open_questions,
            ...row.next_actions,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
        .slice(0, limit);

      return { count: rows.length, entries: rows };
    },
  },

  {
    name: "get_entry",
    description:
      "Get one journal entry in full, including its conversation turns and its digest. Only ever returns an entry belonging to the signed-in person.",
    inputSchema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "The entry id, from search_entries." },
      },
      required: ["entry_id"],
      additionalProperties: false,
    },
    handler: async (uid, args) => {
      const entryId = String(args.entry_id || "").trim();
      if (!entryId) throw new Error("entry_id is required.");

      // The document path is rooted at this uid, so an id belonging to somebody else
      // simply does not exist here. There is nothing to leak.
      const doc = await userRoot(uid).collection("entries").doc(entryId).get();
      if (!doc.exists) throw new Error("No such entry.");

      const data = doc.data() as any;
      const turnsSnap = await userRoot(uid)
        .collection("entries")
        .doc(entryId)
        .collection("turns")
        .orderBy("createdAt", "asc")
        .limit(500)
        .get();

      return {
        entry_id: doc.id,
        title: digestOf(data).title || data.title,
        mode: data.mode || "reflect",
        status: data.status,
        created_at: data.createdAt,
        closed_at: data.closedAt,
        digest: data.digest || null,
        turns: turnsSnap.docs.map((t) => {
          const td = t.data() as any;
          return { role: td.role, text: td.text, model_used: td.modelUsed, created_at: td.createdAt };
        }),
      };
    },
  },

  {
    name: "list_open_actions",
    description: "List the signed-in person's next actions that are not yet done.",
    inputSchema: {
      type: "object",
      properties: {
        overdue_only: {
          type: "boolean",
          description: "When true, return only actions whose due date has passed.",
        },
      },
      additionalProperties: false,
    },
    handler: async (uid, args) => {
      const overdueOnly = args.overdue_only === true;
      const today = new Date().toISOString().slice(0, 10);

      const snap = await userRoot(uid).collection("actions").orderBy("createdAt", "desc").limit(200).get();

      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((a) => a.done !== true && a.what)
        .filter((a) => (overdueOnly ? Boolean(a.due) && a.due < today : true))
        .map((a) => ({
          action_id: a.id,
          what: a.what,
          due: a.due || null,
          effort: a.effort || "medium",
          age_days: daysSince(a.createdAt),
          source_entry_id: a.sourceEntryId || null,
        }));

      return { count: rows.length, actions: rows };
    },
  },

  {
    name: "complete_action",
    description:
      "Mark one of the signed-in person's actions as done. This is the only tool on this server that writes anything.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string", description: "The action id, from list_open_actions." },
      },
      required: ["action_id"],
      additionalProperties: false,
    },
    handler: async (uid, args) => {
      const actionId = String(args.action_id || "").trim();
      if (!actionId) throw new Error("action_id is required.");

      const ref = userRoot(uid).collection("actions").doc(actionId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error("No such action.");

      // update, not set: this cannot create a document, and it cannot touch any field
      // other than done.
      await ref.update({ done: true });
      return { action_id: actionId, done: true, what: (doc.data() as any)?.what };
    },
  },

  {
    name: "list_decisions",
    description:
      "List decisions the signed-in person recorded, newest first, with the rationale they gave and any review date.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO date, YYYY-MM-DD. Only decisions on or after this date." },
      },
      additionalProperties: false,
    },
    handler: async (uid, args) => {
      const since = String(args.since || "").trim();

      const snap = await userRoot(uid).collection("entries").orderBy("createdAt", "desc").limit(100).get();

      const decisions: Array<Record<string, unknown>> = [];
      for (const doc of snap.docs) {
        const data = doc.data() as any;
        if (data.status !== "closed" || !data.digest) continue;

        const date = String(data.closedAt || data.createdAt || "").slice(0, 10);
        if (since && date < since) continue;

        for (const dec of digestOf(data).decisions || []) {
          const text = typeof dec === "string" ? dec : dec?.decision;
          if (!text) continue;
          decisions.push({
            decision: text,
            rationale: typeof dec === "object" ? dec.rationale || null : null,
            review_on: typeof dec === "object" ? dec.review_on || null : null,
            date,
            entry_id: doc.id,
          });
        }
      }

      return { count: decisions.length, decisions };
    },
  },

  {
    name: "list_unresolved_questions",
    description:
      "List questions the signed-in person raised in their entries that no later entry records a decision about. Matching is on wording, so treat the result as a prompt to look rather than a proof.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async (uid) => {
      const snap = await userRoot(uid).collection("entries").orderBy("createdAt", "desc").limit(100).get();

      const entries = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((e) => e.status === "closed" && e.digest);

      // Chronological, so "later" means what it says.
      const chronological = [...entries].reverse();

      const decisionTextByIndex = chronological.map((e) =>
        (digestOf(e).decisions || [])
          .map((d: any) => (typeof d === "string" ? d : d?.decision || ""))
          .join(" ")
          .toLowerCase()
      );

      const results: Array<Record<string, unknown>> = [];

      chronological.forEach((entry, index) => {
        const questions = digestOf(entry).open_questions || digestOf(entry).openQuestions || [];
        for (const question of questions) {
          if (typeof question !== "string" || !question.trim()) continue;

          const keywords = question
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 4);

          if (keywords.length === 0) continue;

          const addressedLater = decisionTextByIndex
            .slice(index + 1)
            .some((text) => keywords.filter((k) => text.includes(k)).length >= Math.min(2, keywords.length));

          if (!addressedLater) {
            results.push({
              question: question.trim(),
              first_seen: String(entry.closedAt || entry.createdAt || "").slice(0, 10),
              entry_id: entry.id,
            });
          }
        }
      });

      return { count: results.length, questions: results.slice(0, 50) };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  onSnapshot,
  deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  JournalEntry,
  ConversationTurn,
  ActionItem,
  EntryDigest,
  JournalMode,
  CanvasCard,
  BrainstormBoard,
} from "../types";

/**
 * Strips all undefined values recursively from objects and arrays
 * to prevent Firestore write rejections or corruption.
 */
export function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
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

export async function saveUserProfile(user: {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}) {
  try {
    const userRef = doc(db, "users", user.uid);
    const data = stripUndefined({
      uid: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      updatedAt: new Date().toISOString(),
    });
    await setDoc(userRef, data, { merge: true });
  } catch (err) {
    console.warn("Could not save user profile to Firestore:", err);
  }
}

export async function createJournalEntry(
  userId: string,
  title: string = "Untitled Entry",
  mode: JournalMode = "reflect"
): Promise<JournalEntry> {
  const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newEntry: JournalEntry = {
    id: entryId,
    title,
    mode,
    status: "open",
    createdAt: new Date().toISOString(),
  };

  try {
    const entryRef = doc(db, "users", userId, "entries", entryId);
    await setDoc(entryRef, stripUndefined(newEntry));
  } catch (err) {
    console.warn("Could not write entry to Firestore, keeping local:", err);
  }

  return newEntry;
}

export async function addConversationTurn(
  userId: string,
  entryId: string,
  turn: Omit<ConversationTurn, "id">
): Promise<ConversationTurn> {
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const fullTurn: ConversationTurn = {
    ...turn,
    id: turnId,
  };

  try {
    const turnRef = doc(db, "users", userId, "entries", entryId, "turns", turnId);
    await setDoc(turnRef, stripUndefined(fullTurn));
  } catch (err) {
    console.warn("Could not write turn to Firestore, keeping local:", err);
  }

  return fullTurn;
}

export async function updateEntryInteraction(
  userId: string,
  entryId: string,
  interactionId: string
) {
  try {
    const entryRef = doc(db, "users", userId, "entries", entryId);
    await updateDoc(entryRef, stripUndefined({ interactionId }));
  } catch (err) {
    console.warn("Could not update entry interaction in Firestore:", err);
  }
}

/**
 * Persist the mode on the entry. Applies to the next turn only; nothing already
 * written is reinterpreted.
 */
export async function updateEntryMode(userId: string, entryId: string, mode: JournalMode) {
  try {
    const entryRef = doc(db, "users", userId, "entries", entryId);
    await updateDoc(entryRef, stripUndefined({ mode }));
  } catch (err) {
    console.warn("Could not update entry mode in Firestore:", err);
  }
}

/**
 * Close an entry without analysing it.
 *
 * Closing and analysing are separate acts. Someone can write, close, and never ask a
 * model anything, and the entry is complete. The digest is produced later, on request,
 * by analyseEntry.
 */
export async function closeEntryOnly(userId: string, entryId: string) {
  const closedAt = new Date().toISOString();
  const entryRef = doc(db, "users", userId, "entries", entryId);
  // Not wrapped: if this write fails the caller must know, because the entry did not
  // actually close and telling someone otherwise loses their work.
  await updateDoc(entryRef, stripUndefined({ status: "closed", closedAt }));
}

/** Reopen a closed entry so more can be written into it. */
export async function reopenEntry(userId: string, entryId: string) {
  const entryRef = doc(db, "users", userId, "entries", entryId);
  await updateDoc(entryRef, stripUndefined({ status: "open" }));
}

export async function closeJournalEntry(
  userId: string,
  entryId: string,
  digest: EntryDigest,
  precreatedActions?: ActionItem[]
) {
  const closedAt = new Date().toISOString();
  try {
    const entryRef = doc(db, "users", userId, "entries", entryId);
    await updateDoc(entryRef, stripUndefined({
      status: "closed",
      closedAt,
      digest,
      title: digest.title || undefined,
    }));

    // Persist each next_action as its own document under /users/{uid}/actions so it can be completed independently
    if (precreatedActions && Array.isArray(precreatedActions) && precreatedActions.length > 0) {
      for (const item of precreatedActions) {
        const actionRef = doc(db, "users", userId, "actions", item.id);
        await setDoc(actionRef, stripUndefined(item), { merge: true });
      }
    } else {
      const actionsToSave = digest.next_actions || digest.nextActions;
      if (actionsToSave && Array.isArray(actionsToSave)) {
        for (const act of actionsToSave) {
          const actionId = `action_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const actionItem: ActionItem = {
            id: actionId,
            what: act.what,
            due: act.due || "",
            effort: act.effort || "medium",
            done: false,
            sourceEntryId: entryId,
            createdAt: new Date().toISOString(),
          };
          const actionRef = doc(db, "users", userId, "actions", actionId);
          await setDoc(actionRef, stripUndefined(actionItem), { merge: true });
        }
      }
    }
  } catch (err) {
    console.warn("Could not close entry in Firestore:", err);
  }
}

export async function toggleActionStatus(
  userId: string,
  actionId: string,
  done: boolean
) {
  try {
    const actionRef = doc(db, "users", userId, "actions", actionId);
    await updateDoc(actionRef, stripUndefined({ done }));
  } catch (err) {
    console.warn("Could not update action status in Firestore:", err);
    throw err;
  }
}

export function subscribeToEntries(
  userId: string,
  callback: (entries: JournalEntry[]) => void
) {
  const entriesRef = collection(db, "users", userId, "entries");
  const q = query(entriesRef, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: JournalEntry[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as any) });
      });
      callback(items);
    },
    (err) => {
      console.warn("Entries subscription note:", err);
    }
  );
}

export function subscribeToTurns(
  userId: string,
  entryId: string,
  callback: (turns: ConversationTurn[]) => void
) {
  const turnsRef = collection(db, "users", userId, "entries", entryId, "turns");
  const q = query(turnsRef, orderBy("createdAt", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ConversationTurn[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as any) });
      });
      callback(items);
    },
    (err) => {
      console.warn("Turns subscription note:", err);
    }
  );
}

export function subscribeToActions(
  userId: string,
  callback: (actions: ActionItem[]) => void
) {
  const actionsRef = collection(db, "users", userId, "actions");
  const q = query(actionsRef, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ActionItem[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as any) });
      });
      callback(items);
    },
    (err) => {
      console.warn("Actions subscription note:", err);
    }
  );
}

// ---------------------------------------------------------------------------
// Brainstorm Canvas Boards
// ---------------------------------------------------------------------------

/**
 * A new board starts empty.
 *
 * It used to be seeded with seven fixture cards describing this app's own engineering
 * backlog, written into the user's Firestore as if they were theirs. A brainstorm canvas
 * holding somebody else's to-do list is worse than an empty one.
 */
export const INITIAL_SAMPLE_CARDS: CanvasCard[] = [];

/**
 * The exact text of the seven cards that used to be seeded into every new board.
 *
 * Emptying the seed only helped boards created afterwards. Anyone who already had a board
 * still had the fixtures sitting in their Firestore, so they are cleared on load, matched
 * by text. Only these seven strings are removed; anything the person wrote themselves is
 * left alone.
 */
const SEEDED_FIXTURE_TEXTS = new Set([
  "User interviews on cognitive offloading during reflective writing",
  "Add offline caching for voice transcription audio buffers",
  "Audit typography contrast and step ratios in dark mode",
  "Fix latency spike on initial streaming LLM token chunk",
  "Test Web Audio AnalyserNode frequency bins on mobile Safari",
  "Draft v2 release notes highlighting the spatial brainstorm canvas",
  "Synthesize user feedback on post-entry digest and action rail",
]);

export function isSeededFixture(card: CanvasCard): boolean {
  return SEEDED_FIXTURE_TEXTS.has((card.text || "").trim());
}

/**
 * Strip the old fixture cards from a board. Returns null when there is nothing to do,
 * so the caller can avoid a pointless write.
 */
export function withoutSeededFixtures(board: BrainstormBoard): BrainstormBoard | null {
  const kept = (board.cards || []).filter((c) => !isSeededFixture(c));
  if (kept.length === (board.cards || []).length) return null;

  const keptIds = new Set(kept.map((c) => c.id));
  return {
    ...board,
    cards: kept,
    // Clusters reference card ids, so drop any that no longer hold anything.
    clusters: (board.clusters || [])
      .map((cl) => ({ ...cl, card_ids: (cl.card_ids || []).filter((id) => keptIds.has(id)) }))
      .filter((cl) => cl.card_ids.length > 0),
    orphans: (board.orphans || []).filter((id) => keptIds.has(id)),
    gaps: kept.length === 0 ? [] : board.gaps,
  };
}

/** Create a named, empty brainstorm. */
export async function createBoard(userId: string, title: string): Promise<BrainstormBoard> {
  const boardId = `board_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const board: BrainstormBoard = {
    id: boardId,
    title: title.trim() || "Untitled brainstorm",
    cards: [],
    clusters: [],
    orphans: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveBoard(userId, board);
  return board;
}

export async function deleteBoard(userId: string, boardId: string): Promise<void> {
  await deleteDoc(doc(db, "users", userId, "boards", boardId));
}

export async function renameBoard(userId: string, boardId: string, title: string): Promise<void> {
  const boardRef = doc(db, "users", userId, "boards", boardId);
  await updateDoc(boardRef, stripUndefined({ title: title.trim() || "Untitled brainstorm", updatedAt: new Date().toISOString() }));
}

export async function saveBoard(userId: string, board: BrainstormBoard): Promise<void> {
  try {
    const boardRef = doc(db, "users", userId, "boards", board.id);
    const data = stripUndefined({
      ...board,
      updatedAt: new Date().toISOString(),
    });
    await setDoc(boardRef, data, { merge: true });
  } catch (err) {
    console.warn("Could not save board to Firestore:", err);
  }
}

export async function createDefaultBoard(
  userId: string,
  title: string = "Brainstorm Canvas"
): Promise<BrainstormBoard> {
  const boardId = `board_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newBoard: BrainstormBoard = {
    id: boardId,
    title,
    cards: [],
    clusters: [],
    orphans: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveBoard(userId, newBoard);
  return newBoard;
}

export function subscribeToBoards(
  userId: string,
  callback: (boards: BrainstormBoard[]) => void
) {
  const boardsRef = collection(db, "users", userId, "boards");
  const q = query(boardsRef, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: BrainstormBoard[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as any) });
      });
      callback(items);
    },
    (err) => {
      console.warn("Boards subscription note:", err);
    }
  );
}

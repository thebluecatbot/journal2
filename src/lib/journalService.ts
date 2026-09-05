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
} from "firebase/firestore";
import { db } from "./firebase";
import { JournalEntry, ConversationTurn, ActionItem, EntryDigest } from "../types";

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
  title: string = "Untitled Entry"
): Promise<JournalEntry> {
  const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newEntry: JournalEntry = {
    id: entryId,
    title,
    mode: "thinking-partner",
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

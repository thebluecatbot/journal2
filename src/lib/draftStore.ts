/**
 * The composer is sacred: what someone typed must survive a reload, a failed save,
 * a dropped network, and a crash in any other part of the app.
 *
 * Drafts are per entry and stay on the writer's own device. They are cleared only
 * once the turn is confirmed written to Firestore.
 */

const PREFIX = "compass.draft.";

function keyFor(entryId: string) {
  return `${PREFIX}${entryId}`;
}

export function loadDraft(entryId: string): string {
  if (!entryId) return "";
  try {
    return window.localStorage.getItem(keyFor(entryId)) || "";
  } catch {
    // Private windows and blocked site data both throw here. A missing draft is
    // recoverable; a crash on read is not.
    return "";
  }
}

export function saveDraft(entryId: string, text: string): void {
  if (!entryId) return;
  try {
    if (text) {
      window.localStorage.setItem(keyFor(entryId), text);
    } else {
      window.localStorage.removeItem(keyFor(entryId));
    }
  } catch {
    // Losing the backup is acceptable. Losing the session is not.
  }
}

export function clearDraft(entryId: string): void {
  saveDraft(entryId, "");
}

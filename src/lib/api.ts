import { getIdToken } from "./firebase";
import { StructureResult, GapResult, PatternReport } from "../types";

export async function streamChatMessage(
  text: string,
  previousInteractionId: string | undefined,
  entryId: string | undefined,
  onToken: (token: string) => void,
  options?: {
    force503?: boolean;
    mode?: string;
    audio?: { data: string; mimeType?: string };
  }
): Promise<{ reply: string; interactionId: string; modelUsed: string }> {
  const token = await getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token || ""}`,
  };

  if (options?.force503) {
    headers["x-test-force-503"] = "true";
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      audio: options?.audio,
      previousInteractionId,
      entryId,
      mode: options?.mode || "reflect",
      stream: true,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Server responded with ${res.status}`);
  }

  if (!res.body) {
    throw new Error("ReadableStream is not supported in this browser.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullReply = "";
  let finalInteractionId = "";
  let finalModelUsed = "gemini-3.8-flash";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const jsonStr = trimmed.slice(6);
      try {
        const event = JSON.parse(jsonStr);
        if (event.type === "token") {
          fullReply += event.text;
          onToken(event.text);
        } else if (event.type === "done") {
          if (event.reply) fullReply = event.reply;
          if (event.interactionId) finalInteractionId = event.interactionId;
          if (event.modelUsed) finalModelUsed = event.modelUsed;
        } else if (event.type === "error") {
          throw new Error(event.error || "Failed to receive response from thinking partner.");
        }
      } catch (err: any) {
        throw err;
      }
    }
  }

  if (!fullReply.trim()) {
    throw new Error("No response received from thinking partner. Please retry.");
  }

  return {
    reply: fullReply,
    interactionId: finalInteractionId,
    modelUsed: finalModelUsed,
  };
}

export async function sendChatMessage(
  text: string,
  previousInteractionId?: string,
  entryId?: string
): Promise<{ reply: string; interactionId: string; modelUsed: string }> {
  return streamChatMessage(text, previousInteractionId, entryId, () => {});
}

export async function closeEntryApi(
  entryId: string,
  turns?: Array<{ role: string; text: string }>,
  entryTitle?: string
): Promise<{ success: boolean; digest: any; actions: any[]; entryId: string }> {
  const token = await getIdToken();
  const res = await fetch(`/api/entries/${encodeURIComponent(entryId)}/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify({ turns, entryTitle }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Server responded with ${res.status}`);
  }

  return res.json();
}

export async function closeEntryDigest(
  turns: Array<{ role: string; text: string }>,
  entryTitle: string,
  entryId: string
): Promise<{ digest: any; actions?: any[] }> {
  try {
    const result = await closeEntryApi(entryId, turns, entryTitle);
    return { digest: result.digest, actions: result.actions };
  } catch {
    const token = await getIdToken();
    const res = await fetch("/api/digest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token || ""}`,
      },
      body: JSON.stringify({ turns, entryTitle, entryId }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Server responded with ${res.status}`);
    }

    return res.json();
  }
}

export async function transcribeAudioApi(
  base64Audio: string,
  mimeType: string = "audio/webm"
): Promise<{ transcript: string }> {
  const token = await getIdToken();
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify({
      audio: base64Audio,
      mimeType,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Transcription failed with status ${res.status}`);
  }

  return res.json();
}

export async function structureBoardApi(
  boardId: string,
  cards: Array<{ id: string; text: string; [key: string]: any }>
): Promise<StructureResult> {
  const token = await getIdToken();
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/structure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify({ cards }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to structure board (HTTP ${res.status})`);
  }

  return res.json();
}

export async function fetchBoardGapsApi(
  boardId: string,
  cards: Array<{ id: string; text: string; [key: string]: any }>
): Promise<GapResult> {
  const token = await getIdToken();
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/gaps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || ""}`,
    },
    body: JSON.stringify({ cards }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to analyze gaps (HTTP ${res.status})`);
  }

  return res.json();
}


/**
 * Insights across recent entries.
 *
 * This is context-window recall over the most recent digests, not vector search.
 * The uid is never sent; the server takes it from the verified token.
 */
export async function fetchPatterns(): Promise<PatternReport> {
  const token = await getIdToken();
  const res = await fetch("/api/patterns", {
    headers: { Authorization: `Bearer ${token || ""}` },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Could not load insights (HTTP ${res.status}).`);
  }

  return res.json();
}

/**
 * Analyse a closed entry that was never analysed.
 *
 * Used by Insights to fill its own blind spot. Each entry is a separate request and a
 * failure on one does not stop the rest.
 */
export async function analyseEntryById(entryId: string): Promise<boolean> {
  try {
    await closeEntryApi(entryId);
    return true;
  } catch (err) {
    console.warn("Could not analyse entry", entryId, err);
    return false;
  }
}

import { getIdToken } from "./firebase";

export async function streamChatMessage(
  text: string,
  previousInteractionId: string | undefined,
  entryId: string | undefined,
  onToken: (token: string) => void,
  options?: { force503?: boolean }
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
    body: JSON.stringify({ text, previousInteractionId, entryId, stream: true }),
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
          throw new Error(event.error || "Streaming failed from thinking partner.");
        }
      } catch (err: any) {
        if (err.message && err.message.includes("Streaming failed")) {
          throw err;
        }
      }
    }
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

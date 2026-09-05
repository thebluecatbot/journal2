import React, { useState, useRef, useEffect } from "react";
import { JournalEntry, ConversationTurn } from "../types";
import { streamChatMessage, closeEntryDigest } from "../lib/api";
import { addConversationTurn, updateEntryInteraction, closeJournalEntry } from "../lib/journalService";

interface JournalConversationProps {
  userId: string;
  entry: JournalEntry;
  turns: ConversationTurn[];
  onDigestUpdated?: (digest: any) => void;
  onNewEntryRequested?: () => void;
  onClosingStateChange?: (isClosing: boolean) => void;
}

export const JournalConversation: React.FC<JournalConversationProps> = ({
  userId,
  entry,
  turns,
  onDigestUpdated,
  onNewEntryRequested,
  onClosingStateChange,
}) => {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [streamingReply, setStreamingReply] = useState<string>("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [turns, isSending, isClosing, streamingReply]);

  // Adjust textarea height dynamically to accommodate free-writing
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [draft]);

  const handleSend = async () => {
    const textToSend = draft.trim();
    if (!textToSend || isSending || isClosing || entry.status === "closed") return;

    setInlineError(null);
    setIsSending(true);
    setStreamingReply("");

    // CRITICAL: We NEVER clear the composer here.
    // The draft text is preserved in the composer until write is fully confirmed.

    try {
      // 1. Record user turn in Firestore
      await addConversationTurn(userId, entry.id, {
        role: "user",
        text: textToSend,
        createdAt: new Date().toISOString(),
      });

      // 2. Stream the thinking partner reply token by token
      let accumulatedTokens = "";
      const { reply, interactionId, modelUsed } = await streamChatMessage(
        textToSend,
        entry.interactionId,
        entry.id,
        (token) => {
          accumulatedTokens += token;
          setStreamingReply(accumulatedTokens);
        }
      );

      const finalReply = reply || accumulatedTokens;

      // 3. Save model turn to Firestore, recording which model answered
      await addConversationTurn(userId, entry.id, {
        role: "model",
        text: finalReply,
        modelUsed: modelUsed || "gemini-3.8-flash",
        createdAt: new Date().toISOString(),
      });

      // 4. Update entry document with interactionId so conversation resumes after page refresh
      if (interactionId) {
        await updateEntryInteraction(userId, entry.id, interactionId);
        entry.interactionId = interactionId;
      }

      // 5. WRITE CONFIRMED: Now and ONLY now clear the composer
      setDraft("");
      setStreamingReply("");
      setInlineError(null);
    } catch (err: any) {
      console.error("Failed to send message to thinking partner:", err);
      // On failure: preserve what user typed in composer and display inline error banner with Retry
      setInlineError(err.message || "Failed to reach your thinking partner. Please check your connection and retry.");
      setStreamingReply("");
    } finally {
      setIsSending(false);
    }
  };

  const handleCloseEntry = async () => {
    if (isClosing || entry.status === "closed") return;

    setIsClosing(true);
    onClosingStateChange?.(true);
    setInlineError(null);

    try {
      // If user typed some unsubmitted free write, submit it first as a user turn
      let currentTurns = [...turns];
      const pendingText = draft.trim();
      if (pendingText) {
        const addedTurn = await addConversationTurn(userId, entry.id, {
          role: "user",
          text: pendingText,
          createdAt: new Date().toISOString(),
        });
        currentTurns.push(addedTurn);
      }

      if (currentTurns.length === 0) {
        setInlineError("Please write something before closing your entry.");
        setIsClosing(false);
        onClosingStateChange?.(false);
        return;
      }

      // Call server digest / close endpoint
      const result = await closeEntryDigest(
        currentTurns.map((t) => ({ role: t.role, text: t.text })),
        entry.title,
        entry.id
      );

      await closeJournalEntry(userId, entry.id, result.digest, result.actions);
      setDraft("");
      onDigestUpdated?.(result.digest);
    } catch (err: any) {
      console.warn("Closing entry fallback:", err);
      // THE ENTRY MUST STILL CLOSE SUCCESSFULLY even if digest generation fails
      const fallbackDigest: any = {
        title: entry.title,
        themes: [],
        mood: "steady",
        decisions: [],
        open_questions: [],
        next_actions: [],
        learning_goals: [],
      };
      await closeJournalEntry(userId, entry.id, fallbackDigest);
      setDraft("");
      onDigestUpdated?.(fallbackDigest);
    } finally {
      setIsClosing(false);
      onClosingStateChange?.(false);
    }
  };

  const formatTurnTime = (isoString?: string) => {
    if (!isoString) return "";
    try {
      return new Date(isoString).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const isEntryClosed = entry.status === "closed";

  return (
    <section className="rail-conversation-col flex flex-col border-r border-[#EBEBEB] bg-[#FAF9F6] h-full overflow-hidden">
      {/* Scrollable Conversation Stream */}
      <div className="flex-1 p-8 space-y-8 overflow-y-auto">
        {turns.length === 0 && !isSending && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16 px-6">
            <div className="w-9 h-9 bg-stone-200/60 rounded-full flex items-center justify-center mb-3">
              <div className="w-1.5 h-4 bg-stone-500 rotate-45 rounded-full" />
            </div>
            <h3 className="text-base font-serif italic text-stone-700 mb-1">
              A private space to think out loud.
            </h3>
            <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
              Write as long and as freely as you wish. When you are ready for a thoughtful reflection, press Send. Or simply click Close Entry whenever you are done.
            </p>
          </div>
        )}

        {turns.map((turn) => {
          if (turn.role === "user") {
            return (
              <div key={turn.id} className="flex flex-col gap-2 max-w-[85%]">
                <span className="text-[10px] uppercase tracking-widest text-[#999] font-semibold">
                  Journal Entry • {formatTurnTime(turn.createdAt)}
                </span>
                <p className="text-lg leading-relaxed text-[#2D2D2D] whitespace-pre-wrap font-sans">
                  {turn.text}
                </p>
              </div>
            );
          }

          return (
            <div key={turn.id} className="flex flex-col gap-2 max-w-[85%] ml-auto items-end">
              <span className="text-[10px] uppercase tracking-widest text-[#999] font-semibold flex items-center gap-1.5">
                Gemini • Thinking Partner
                {turn.modelUsed && (
                  <span className="text-[9px] text-[#BBB] font-normal lowercase">
                    ({turn.modelUsed})
                  </span>
                )}
              </span>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#F0F0F0] text-left">
                <p className="text-lg leading-relaxed text-[#1A1A1A] whitespace-pre-wrap font-sans">
                  {turn.text}
                </p>
              </div>
            </div>
          );
        })}

        {/* Real-time Streaming Indicator & Tokens */}
        {isSending && (
          <div className="flex flex-col gap-2 max-w-[85%] ml-auto items-end">
            <span className="text-[10px] uppercase tracking-widest text-[#999] font-semibold">
              Gemini • Thinking Partner
            </span>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#F0F0F0] text-left">
              {streamingReply ? (
                <p className="text-lg leading-relaxed text-[#1A1A1A] whitespace-pre-wrap font-sans">
                  {streamingReply}
                  <span className="inline-block w-1.5 h-4 ml-1 bg-black animate-pulse" />
                </p>
              ) : (
                <div className="flex items-center gap-2 py-1">
                  <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Distilling Indicator */}
        {isClosing && (
          <div className="flex flex-col items-center justify-center p-6 bg-white/70 rounded-xl border border-[#EBEBEB] text-center space-y-2">
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <span className="text-xs uppercase tracking-widest text-[#666] font-semibold">
              Distilling your entry into themes, mood & next actions...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input / Free-Writing Bottom Bar */}
      <div className="p-6 bg-white border-t border-[#EBEBEB] flex-shrink-0">
        {/* Inline Error Banner Above Composer with Retry Button */}
        {inlineError && (
          <div
            id="composer-inline-error-banner"
            className="mb-3 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3 text-xs text-red-800"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-medium">{inlineError}</span>
            </div>
            <button
              id="composer-retry-button"
              onClick={handleSend}
              disabled={isSending}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-xs transition-colors cursor-pointer flex-shrink-0 shadow-xs"
            >
              Retry
            </button>
          </div>
        )}

        {isEntryClosed ? (
          <div className="flex items-center justify-between py-2 px-3 bg-[#FAF9F6] rounded-xl border border-[#EBEBEB]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span className="text-xs font-medium text-[#555]">
                This entry is closed and preserved. Actions and themes are recorded in your Action Rail.
              </span>
            </div>
            {onNewEntryRequested && (
              <button
                onClick={onNewEntryRequested}
                className="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-medium hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                + New Entry
              </button>
            )}
          </div>
        ) : (
          <div className="relative flex items-end">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Think out loud..."
              disabled={isSending || isClosing}
              className="w-full p-4 pr-48 bg-[#F5F5F5] border-none rounded-xl focus:ring-1 focus:ring-black outline-none text-base resize-none min-h-[58px] max-h-[180px] font-sans text-[#1A1A1A] placeholder:text-[#999] leading-relaxed"
            />
            <div className="absolute right-2 bottom-2.5 flex items-center gap-2">
              <button
                id="send-turn-button"
                onClick={handleSend}
                disabled={!draft.trim() || isSending || isClosing}
                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:hover:bg-black cursor-pointer"
              >
                {isSending ? "Sending..." : "Send"}
              </button>
              <button
                id="close-entry-button"
                onClick={handleCloseEntry}
                disabled={isClosing || isSending || (turns.length === 0 && !draft.trim())}
                className="px-4 py-2 border border-[#EBEBEB] bg-white rounded-lg text-sm font-medium text-[#222] hover:bg-gray-50 transition-colors disabled:opacity-40 cursor-pointer"
              >
                {isClosing ? "Distilling..." : "Close Entry"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

// RATIONALE (Law 1): the human generates, the AI structures, and never the reverse.
// Sending saves what you wrote and nothing else happens. Closing an entry saves and
// closes it and nothing else happens. A model is called only when you press a button
// that says so. You can write, close, and never ask anything of it.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { JournalEntry, ConversationTurn, ActionItem } from "../types";
import { streamChatMessage, closeEntryDigest } from "../lib/api";
import {
  addConversationTurn,
  updateEntryInteraction,
  closeJournalEntry,
  closeEntryOnly,
  reopenEntry,
  updateEntryMode,
} from "../lib/journalService";
import { loadDraft, saveDraft, clearDraft } from "../lib/draftStore";
import { ModeId, getMode, normalizeMode, scaffoldFor } from "../lib/modes";
import { PostEntryRecap } from "./PostEntryRecap";
import { VoiceComposer } from "./VoiceComposer";
import { ModePicker } from "./ModePicker";
import { ModeGuide } from "./ModeGuide";
import { ErrorBoundary } from "./ErrorBoundary";
import { loadDemoContent } from "../lib/demoContent";

interface JournalConversationProps {
  userId: string;
  entry: JournalEntry;
  turns: ConversationTurn[];
  actions?: ActionItem[];
  onDigestUpdated?: (digest: any) => void;
  onEntryClosed?: () => void;
  onEntryReopened?: () => void;
  onNewEntryRequested?: () => void;
  onSelectTheme?: (theme: string) => void;
  firstName?: string;
}

const STARTERS = [
  "Something that happened today that I am still thinking about",
  "A decision I keep going back and forth on",
  "An idea I want to poke holes in",
];

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
const SEND_HINT = isMac ? "Cmd and Enter to save" : "Ctrl and Enter to save";

export const JournalConversation: React.FC<JournalConversationProps> = ({
  userId,
  entry,
  turns,
  actions = [],
  onDigestUpdated,
  onEntryClosed,
  onEntryReopened,
  onNewEntryRequested,
  onSelectTheme,
  firstName,
}) => {
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeId>(normalizeMode(entry.mode));
  const [guideOpen, setGuideOpen] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // A ref, not state: two clicks in the same tick both read the old state value,
  // so a state flag alone does not stop a double submit.
  const inFlightRef = useRef(false);

  const isEntryClosed = entry.status === "closed";
  const hasDigest = Boolean(entry.digest);
  const activeMode = getMode(mode);

  // --- Draft persistence --------------------------------------------------
  useEffect(() => {
    setDraft(loadDraft(entry.id));
    setInlineError(null);
    setStreamingReply("");
    setMode(normalizeMode(entry.mode));
    setGuideOpen(false);
  }, [entry.id]);

  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(entry.id, draft), 250);
    return () => window.clearTimeout(id);
  }, [draft, entry.id]);

  // --- Layout -------------------------------------------------------------
  const growTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, []);

  useEffect(growTextarea, [draft, growTextarea]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, isAsking, isAnalysing, streamingReply]);

  useEffect(() => {
    if (!isEntryClosed) textareaRef.current?.focus();
  }, [entry.id, isEntryClosed]);

  const focusComposer = (toEnd = true) => {
    window.setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      if (toEnd) el.setSelectionRange(el.value.length, el.value.length);
      growTextarea();
    }, 50);
  };

  const handleVoiceTranscript = (transcript: string) => {
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${transcript}` : transcript));
    focusComposer();
  };

  // Switching mode opens the explainer. It is dismissible and never blocks writing.
  const handleModeChange = (next: ModeId) => {
    if (next === mode) return;
    setMode(next);
    setGuideOpen(true);
    void updateEntryMode(userId, entry.id, next);
  };

  const applyScaffold = () => {
    const scaffold = scaffoldFor(mode);
    if (!scaffold) return;
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${scaffold}` : scaffold));
    setGuideOpen(false);
    focusComposer(false);
  };

  // --- Saving. No model is called here. -----------------------------------
  const handleSave = async () => {
    const text = draft.trim();
    if (!text || inFlightRef.current || isEntryClosed) return;

    inFlightRef.current = true;
    setInlineError(null);
    setIsSaving(true);

    try {
      await addConversationTurn(userId, entry.id, {
        role: "user",
        text,
        createdAt: new Date().toISOString(),
      });
      // Write confirmed. Only now is the composer released.
      setDraft("");
      clearDraft(entry.id);
    } catch (err: any) {
      console.error("Save failed:", err?.message || err);
      setInlineError(friendlyError(err));
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  };

  // --- Asking. The only path that calls a model. --------------------------
  const handleAsk = async () => {
    if (inFlightRef.current || isEntryClosed) return;

    // Anything unsaved is saved first, so nothing is lost and the model sees it.
    const pending = draft.trim();
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    const promptText = pending || lastUser?.text || "";
    if (!promptText) {
      setInlineError("Write something first, then Compass has something to respond to.");
      return;
    }

    inFlightRef.current = true;
    setInlineError(null);
    setIsAsking(true);
    setStreamingReply("");

    try {
      if (pending) {
        await addConversationTurn(userId, entry.id, {
          role: "user",
          text: pending,
          createdAt: new Date().toISOString(),
        });
        setDraft("");
        clearDraft(entry.id);
      }

      let accumulated = "";
      const { reply, interactionId, modelUsed } = await streamChatMessage(
        promptText,
        entry.interactionId,
        entry.id,
        (token) => {
          accumulated += token;
          setStreamingReply(accumulated);
        },
        { mode }
      );

      const finalReply = (reply || accumulated || "").trim();
      if (!finalReply) {
        throw new Error("No reply came back. Everything you wrote is saved.");
      }

      await addConversationTurn(userId, entry.id, {
        role: "model",
        text: finalReply,
        modelUsed: modelUsed || "unknown",
        createdAt: new Date().toISOString(),
      });

      if (interactionId) {
        await updateEntryInteraction(userId, entry.id, interactionId);
        entry.interactionId = interactionId;
      }
      setStreamingReply("");
    } catch (err: any) {
      console.error("Ask failed:", err?.message || err);
      setInlineError(friendlyError(err));
      setStreamingReply("");
    } finally {
      inFlightRef.current = false;
      setIsAsking(false);
    }
  };

  // --- Closing. Saves and closes. No model is called. ---------------------
  const handleClose = async () => {
    if (inFlightRef.current || isEntryClosed) return;

    const pending = draft.trim();
    if (turns.length === 0 && !pending) {
      setInlineError("There is nothing in this entry yet. Write a line first.");
      return;
    }

    inFlightRef.current = true;
    setIsClosing(true);
    setInlineError(null);

    try {
      if (pending) {
        await addConversationTurn(userId, entry.id, {
          role: "user",
          text: pending,
          createdAt: new Date().toISOString(),
        });
        setDraft("");
        clearDraft(entry.id);
      }
      await closeEntryOnly(userId, entry.id);
      onEntryClosed?.();
    } catch (err: any) {
      console.error("Close failed:", err?.message || err);
      setInlineError("The entry could not be closed just now. Everything you wrote is saved. Try again.");
    } finally {
      inFlightRef.current = false;
      setIsClosing(false);
    }
  };

  const handleReopen = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await reopenEntry(userId, entry.id);
      onEntryReopened?.();
    } catch (err) {
      console.error("Reopen failed:", err);
      setInlineError("Could not reopen this entry. Try again.");
    } finally {
      inFlightRef.current = false;
    }
  };

  // --- Analysing. Explicit, and never automatic. --------------------------
  const handleAnalyse = async () => {
    if (inFlightRef.current || isAnalysing) return;
    if (turns.length === 0) {
      setInlineError("There is nothing to analyse in this entry yet.");
      return;
    }

    inFlightRef.current = true;
    setIsAnalysing(true);
    setInlineError(null);

    try {
      const result = await closeEntryDigest(
        turns.map((t) => ({ role: t.role, text: t.text })),
        entry.title,
        entry.id
      );
      await closeJournalEntry(userId, entry.id, result.digest, result.actions);
      onDigestUpdated?.(result.digest);
    } catch (err: any) {
      // Analysis is an enhancement. Failing it must never touch the entry itself.
      console.warn("Analysis failed:", err?.message || err);
      setInlineError("The analysis did not run. Your entry is unchanged and still saved. Try again.");
    } finally {
      inFlightRef.current = false;
      setIsAnalysing(false);
    }
  };

  // --- Keyboard -----------------------------------------------------------
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter makes a new line. This is a journal; people write paragraphs here.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSave();
    }
  };

  const validTurns = turns.filter((t) => t.role === "user" || (t.text && t.text.trim()));
  const hasWriting = validTurns.length > 0;
  const busy = isSaving || isAsking || isClosing || isAnalysing;

  const entryDate = new Date(entry.createdAt || Date.now()).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
      <article
        style={{
          maxWidth: "var(--measure)",
          margin: "0 auto",
          padding: "var(--s8) var(--s5) var(--s7)",
          display: "flex",
          flexDirection: "column",
          minHeight: "100%",
        }}
      >
        <header style={{ marginBottom: "var(--s6)" }}>
          <time className="eyebrow" dateTime={entry.createdAt}>
            {entryDate}
          </time>
          <h1
            style={{
              fontFamily: "var(--font-user)",
              fontSize: 30,
              fontWeight: 500,
              lineHeight: 1.25,
              color: "var(--text)",
              marginTop: "var(--s2)",
            }}
          >
            {isEntryClosed ? entry.digest?.title || entry.title : greeting(firstName, hasWriting)}
          </h1>
        </header>

        {!isEntryClosed && (
          <div style={{ marginBottom: "var(--s6)" }}>
            <ModePicker
              value={mode}
              onChange={handleModeChange}
              disabled={busy}
              guideOpen={guideOpen}
              onToggleGuide={() => setGuideOpen((v) => !v)}
            />
            {guideOpen && (
              <ModeGuide
                mode={activeMode}
                onDismiss={() => setGuideOpen(false)}
                onUseScaffold={activeMode.scaffold ? applyScaffold : undefined}
              />
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s6)", flex: 1 }}>
          {!hasWriting && !isEntryClosed && !guideOpen && (
            <section>
              <p
                style={{
                  fontFamily: "var(--font-ai)",
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: "var(--text-muted)",
                  marginBottom: "var(--s5)",
                  maxWidth: "48ch",
                }}
              >
                Write as much or as little as you like. Saving keeps it and nothing else happens.
                Compass replies only when you ask it to, and analyses the entry only when you press
                Analyse.
              </p>
              <p className="eyebrow" style={{ marginBottom: "var(--s3)" }}>
                Or start from one of these
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)", alignItems: "flex-start" }}>
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    className="btn btn-secondary"
                    style={{
                      fontFamily: "var(--font-user)",
                      fontSize: 17,
                      textAlign: "left",
                      justifyContent: "flex-start",
                      width: "100%",
                    }}
                    onClick={() => {
                      setDraft((prev) => (prev.trim() ? prev : `${starter}\n\n`));
                      focusComposer();
                    }}
                  >
                    {starter}
                  </button>
                ))}
              </div>

              <p className="chrome" style={{ fontSize: 13, marginTop: "var(--s5)", lineHeight: 1.6, maxWidth: "48ch" }}>
                  Nothing written yet.{" "}
                  <button
                    className="btn btn-quiet"
                    style={{ fontSize: 13, minHeight: 0, padding: 0, textDecoration: "underline" }}
                    disabled={loadingDemo}
                    onClick={async () => {
                      setLoadingDemo(true);
                      try {
                        await loadDemoContent(userId);
                      } catch (err) {
                        console.error("Could not load example content:", err);
                        setInlineError("The examples could not be loaded. Try again.");
                      }
                      setLoadingDemo(false);
                    }}
                  >
                    {loadingDemo ? "Loading examples" : "Load example content"}
                  </button>{" "}
                to see a filled in Compass, including History and Insights.
              </p>
            </section>
          )}

          {validTurns.map((turn) =>
            turn.role === "user" ? (
              <div key={turn.id}>
                <p className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
                  You, {formatTime(turn.createdAt)}
                </p>
                <div className="text-user-body">{turn.text}</div>
              </div>
            ) : (
              <div key={turn.id}>
                <p className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
                  Compass
                </p>
                <div className="panel-ai">{turn.text}</div>
              </div>
            )
          )}

          {isAsking && (
            <div>
              <p className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
                Compass is writing
              </p>
              <div className="panel-ai" aria-live="polite">
                {streamingReply || <span style={{ color: "var(--text-muted)" }}>Reading what you wrote</span>}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div style={{ marginTop: "var(--s7)" }}>
          {inlineError && (
            <div
              role="alert"
              style={{
                background: "var(--danger-soft)",
                border: "1px solid var(--danger)",
                borderRadius: "var(--radius)",
                padding: "var(--s3) var(--s4)",
                marginBottom: "var(--s4)",
              }}
            >
              <span style={{ fontFamily: "var(--font-ai)", fontSize: 14, color: "var(--danger)" }}>
                {inlineError}
              </span>
            </div>
          )}

          {isEntryClosed ? (
            <ClosedEntryBar
              hasDigest={hasDigest}
              isAnalysing={isAnalysing}
              hasTurns={validTurns.length > 0}
              onAnalyse={handleAnalyse}
              onReopen={handleReopen}
              onNewEntry={onNewEntryRequested}
            />
          ) : (
            <VoiceComposer onTranscriptReady={handleVoiceTranscript} isThinking={isAsking} disabled={busy}>
              {({ isRecording, micSupported, startRecording }) => (
                <>
                  <textarea
                    id="composer"
                    ref={textareaRef}
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder={activeMode.placeholder}
                    disabled={isClosing}
                    aria-label={`Write, ${activeMode.label} mode`}
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      resize: "none",
                      padding: 0,
                      fontFamily: "var(--font-user)",
                      fontSize: 19,
                      lineHeight: 1.7,
                      color: "var(--text)",
                      minHeight: "6rem",
                      maxHeight: "40vh",
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "var(--s4)",
                      marginTop: "var(--s3)",
                      paddingTop: "var(--s3)",
                      borderTop: "1px solid var(--border)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="chrome" style={{ fontSize: 13 }}>
                      {SEND_HINT}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", flexWrap: "wrap" }}>
                      {activeMode.scaffold && !draft.trim() && (
                        <button className="btn btn-quiet" style={{ fontSize: 14 }} onClick={applyScaffold}>
                          Use structure
                        </button>
                      )}
                      {micSupported && !isRecording && (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          style={{ fontSize: 14 }}
                          onClick={startRecording}
                          disabled={busy}
                        >
                          Voice
                        </button>
                      )}
                      {/* Calling a model is always a deliberate, separate act. */}
                      <button
                        id="ask-compass-button"
                        className="btn btn-secondary"
                        style={{ fontSize: 14 }}
                        onClick={handleAsk}
                        disabled={busy || (!draft.trim() && !hasWriting)}
                      >
                        {isAsking ? "Asking" : "Ask Compass"}
                      </button>
                      <button
                        id="close-entry-button"
                        className="btn btn-secondary"
                        style={{ fontSize: 14 }}
                        onClick={handleClose}
                        disabled={busy || (turns.length === 0 && !draft.trim())}
                      >
                        {isClosing ? "Closing" : "Close entry"}
                      </button>
                      <button
                        id="save-turn-button"
                        className={draft.trim() ? "btn btn-primary" : "btn btn-quiet"}
                        style={{ fontSize: 14 }}
                        onClick={handleSave}
                        disabled={!draft.trim() || busy}
                      >
                        {isSaving ? "Saving" : "Save"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </VoiceComposer>
          )}
        </div>

        {isEntryClosed && hasDigest && (
          <ErrorBoundary
            title="The analysis could not be shown"
            detail="Everything you wrote in this entry is saved and readable above."
          >
            <PostEntryRecap
              userId={userId}
              entry={entry}
              digest={entry.digest || null}
              actions={actions}
              onNewEntry={onNewEntryRequested}
              onSelectTheme={onSelectTheme}
            />
          </ErrorBoundary>
        )}
      </article>
    </div>
  );
};

/**
 * A closed entry is finished. Analysis is offered, never performed on the way out.
 */
const ClosedEntryBar: React.FC<{
  hasDigest: boolean;
  isAnalysing: boolean;
  hasTurns: boolean;
  onAnalyse: () => void;
  onReopen: () => void;
  onNewEntry?: () => void;
}> = ({ hasDigest, isAnalysing, hasTurns, onAnalyse, onReopen, onNewEntry }) => (
  <div style={{ background: "var(--bg-sunk)", borderRadius: "var(--radius)", padding: "var(--s4)" }}>
    <p className="chrome" style={{ marginBottom: "var(--s3)", lineHeight: 1.6 }}>
      {hasDigest
        ? "This entry is closed and analysed. The analysis is below."
        : "This entry is closed and saved. Nothing has read it. Analyse it whenever you want themes, decisions and next actions pulled out, or leave it as it is."}
    </p>
    <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
      {hasTurns && (
        <button
          id="analyse-entry-button"
          className={hasDigest ? "btn btn-secondary" : "btn btn-primary"}
          style={{ fontSize: 14 }}
          onClick={onAnalyse}
          disabled={isAnalysing}
        >
          {isAnalysing ? "Reading it back" : hasDigest ? "Analyse again" : "Analyse this entry"}
        </button>
      )}
      <button className="btn btn-secondary" style={{ fontSize: 14 }} onClick={onReopen}>
        Reopen and keep writing
      </button>
      {onNewEntry && (
        <button className="btn btn-quiet" style={{ fontSize: 14 }} onClick={onNewEntry}>
          Start a new entry
        </button>
      )}
    </div>
  </div>
);

function greeting(firstName: string | undefined, hasWriting: boolean): string {
  if (hasWriting) return "Today";
  return firstName ? `What is on your mind, ${firstName}?` : "What is on your mind?";
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function friendlyError(err: any): string {
  const raw = String(err?.message || "");
  if (/prepayment credits|billing#prepay/i.test(raw)) {
    return "The Gemini project is out of credit. Everything you wrote is saved.";
  }
  if (/429|quota|rate limit|exhausted/i.test(raw)) {
    return "The model is rate limited right now. Everything you wrote is saved. Try again shortly.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "No connection to the server. Your writing is kept on this device until it saves.";
  }
  return raw || "That did not go through. Your writing is saved.";
}

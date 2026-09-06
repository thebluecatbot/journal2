// RATIONALE (Law 2): analysis shown while someone is still writing interferes with the
// cognitive offloading that makes journalling work. Everything in this file appears only
// after the entry is closed.

import React, { useState, useMemo } from "react";
import { JournalEntry, ActionItem, EntryDigest } from "../types";
import { toggleActionStatus } from "../lib/journalService";
import { calendarUrl, downloadIcsFile } from "../lib/calendar";
import { MoodIndicator } from "./MoodIndicator";

interface PostEntryRecapProps {
  userId: string;
  entry: JournalEntry;
  digest: EntryDigest | null;
  actions: ActionItem[];
  onNewEntry?: () => void;
  onSelectTheme?: (theme: string) => void;
}

const sectionLabel: React.CSSProperties = {
  fontFamily: "var(--font-ai)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  marginBottom: "var(--s3)",
};

export const PostEntryRecap: React.FC<PostEntryRecapProps> = ({
  userId,
  entry,
  digest,
  actions,
  onNewEntry,
  onSelectTheme,
}) => {
  const [optimisticDone, setOptimisticDone] = useState<Record<string, boolean>>({});
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [icsNote, setIcsNote] = useState<string | null>(null);

  const displayedActions = useMemo<ActionItem[]>(() => {
    const entryActions = actions.filter((a) => a.sourceEntryId === entry.id);
    if (entryActions.length > 0) return entryActions;

    // The Firestore listener may not have caught up yet. Render from the digest so the
    // payoff appears immediately after closing.
    const fromDigest = digest?.next_actions || digest?.nextActions || [];
    return fromDigest.map((na, idx) => ({
      id: `digest-action-${entry.id}-${idx}`,
      what: na.what,
      due: na.due || "",
      effort: na.effort || "medium",
      done: false,
      sourceEntryId: entry.id,
      createdAt: entry.closedAt || new Date().toISOString(),
    }));
  }, [entry, actions, digest]);

  const handleToggleAction = async (action: ActionItem) => {
    const current = optimisticDone[action.id] ?? action.done;
    const next = !current;

    setOptimisticDone((prev) => ({ ...prev, [action.id]: next }));
    setSyncErrors((prev) => {
      const copy = { ...prev };
      delete copy[action.id];
      return copy;
    });

    if (action.id.startsWith("digest-action-")) return;

    try {
      await toggleActionStatus(userId, action.id, next);
    } catch (err) {
      console.error("Action toggle did not save, reverting:", err);
      setOptimisticDone((prev) => ({ ...prev, [action.id]: current }));
      setSyncErrors((prev) => ({ ...prev, [action.id]: "That did not save. It is unchanged." }));
      window.setTimeout(() => {
        setSyncErrors((prev) => {
          const copy = { ...prev };
          delete copy[action.id];
          return copy;
        });
      }, 4000);
    }
  };

  const handleExportIcs = () => {
    if (displayedActions.length === 0) return;
    downloadIcsFile(
      displayedActions.map((a) => ({ what: a.what, dueISO: a.due, id: a.id })),
      `compass-actions-${new Date().toISOString().slice(0, 10)}.ics`
    );
    setIcsNote("Calendar file downloaded.");
    window.setTimeout(() => setIcsNote(null), 3000);
  };

  const themes = digest?.themes || [];
  const decisions = digest?.decisions || [];
  const openQuestions = digest?.open_questions || digest?.openQuestions || [];
  const learningGoals = digest?.learning_goals || [];
  const mood = digest?.mood || "steady";

  const nothingFound =
    themes.length === 0 &&
    decisions.length === 0 &&
    openQuestions.length === 0 &&
    displayedActions.length === 0;

  return (
    <section
      id="post-entry-recap"
      aria-label="What this entry contained"
      style={{
        marginTop: "var(--s8)",
        background: "var(--bg-sunk)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--s6)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--s4)",
          flexWrap: "wrap",
          marginBottom: "var(--s6)",
        }}
      >
        <div>
          <p className="eyebrow">What this entry held</p>
          <h2
            style={{
              fontFamily: "var(--font-user)",
              fontSize: 24,
              fontWeight: 500,
              color: "var(--text)",
              marginTop: "var(--s1)",
            }}
          >
            {digest?.title || entry.title}
          </h2>
        </div>
        <MoodIndicator mood={mood} />
      </div>

      {nothingFound && (
        <p className="chrome" style={{ lineHeight: 1.6 }}>
          Nothing stood out as a theme, a decision or a next action in this one. That is a normal
          result for a short entry, and the entry itself is saved in full above.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s6)" }}>
        {themes.length > 0 && (
          <div className="rise">
            <p style={sectionLabel}>Themes</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s2)" }}>
              {themes.map((theme) => (
                <button
                  key={theme}
                  className="chip"
                  onClick={() => onSelectTheme?.(theme)}
                  title={onSelectTheme ? `Show every entry tagged ${theme}` : undefined}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
        )}

        {decisions.length > 0 && (
          <div className="rise" style={{ animationDelay: "40ms" }}>
            <p style={sectionLabel}>What you decided</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s3)" }}>
              {decisions.map((dec, i) => {
                const text = typeof dec === "string" ? dec : dec.decision;
                const rationale = typeof dec === "object" ? dec.rationale : null;
                const reviewOn = typeof dec === "object" ? dec.review_on : null;
                return (
                  <div
                    key={i}
                    style={{
                      background: "var(--surface)",
                      borderRadius: "var(--radius)",
                      padding: "var(--s4)",
                    }}
                  >
                    <p style={{ fontFamily: "var(--font-ai)", fontSize: 15, color: "var(--text)", lineHeight: 1.5 }}>
                      {text}
                    </p>
                    {rationale && (
                      <p className="chrome" style={{ fontSize: 13, marginTop: "var(--s2)", lineHeight: 1.6 }}>
                        {rationale}
                      </p>
                    )}
                    {reviewOn && (
                      <p className="chrome" style={{ fontSize: 13, marginTop: "var(--s2)" }}>
                        Review on {reviewOn}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {displayedActions.length > 0 && (
          <div className="rise" style={{ animationDelay: "80ms" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: "var(--s3)",
                flexWrap: "wrap",
              }}
            >
              <p style={sectionLabel}>Next actions</p>
              <button className="btn btn-quiet" style={{ fontSize: 13 }} onClick={handleExportIcs}>
                Export calendar file
              </button>
            </div>

            {icsNote && (
              <p className="chrome" style={{ fontSize: 13, marginBottom: "var(--s2)" }} role="status">
                {icsNote}
              </p>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
              {displayedActions.map((action) => {
                const isDone = optimisticDone[action.id] ?? action.done;
                const syncError = syncErrors[action.id];
                return (
                  <li
                    key={action.id}
                    style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: "var(--s3) var(--s4)" }}
                  >
                    <div style={{ display: "flex", gap: "var(--s3)", alignItems: "flex-start" }}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isDone}
                        aria-label={isDone ? `Mark not done: ${action.what}` : `Mark done: ${action.what}`}
                        onClick={() => handleToggleAction(action)}
                        style={{
                          width: 20,
                          height: 20,
                          marginTop: 2,
                          flexShrink: 0,
                          borderRadius: 4,
                          cursor: "pointer",
                          border: `1px solid ${isDone ? "var(--accent)" : "var(--border)"}`,
                          background: isDone ? "var(--accent)" : "var(--surface)",
                          display: "grid",
                          placeItems: "center",
                          padding: 0,
                        }}
                      >
                        {isDone && (
                          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                            <path d="M2 6.5 4.6 9 10 3" fill="none" stroke="#2C303A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-ai)",
                            fontSize: 15,
                            lineHeight: 1.5,
                            color: isDone ? "var(--text-muted)" : "var(--text)",
                            textDecoration: isDone ? "line-through" : "none",
                          }}
                        >
                          {action.what}
                        </span>
                        <div
                          style={{
                            display: "flex",
                            gap: "var(--s3)",
                            alignItems: "center",
                            marginTop: "var(--s2)",
                            flexWrap: "wrap",
                          }}
                        >
                          {action.due && <span className="chrome" style={{ fontSize: 13 }}>Due {action.due}</span>}
                          {action.effort && (
                            <span className="chrome" style={{ fontSize: 13, textTransform: "capitalize" }}>
                              {action.effort}
                            </span>
                          )}
                          <a
                            href={calendarUrl({ what: action.what, dueISO: action.due, id: action.id })}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontFamily: "var(--font-ai)",
                              fontSize: 13,
                              color: "var(--accent-ink)",
                              textDecoration: "underline",
                            }}
                          >
                            Add to calendar
                          </a>
                        </div>
                        {syncError && (
                          <p style={{ fontFamily: "var(--font-ai)", fontSize: 13, color: "var(--danger)", marginTop: "var(--s2)" }} role="alert">
                            {syncError}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {openQuestions.length > 0 && (
          <div className="rise" style={{ animationDelay: "120ms" }}>
            <p style={sectionLabel}>Still open</p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s3)" }}>
              {openQuestions.map((q, i) => (
                <li
                  key={i}
                  style={{
                    fontFamily: "var(--font-user)",
                    fontSize: 18,
                    lineHeight: 1.6,
                    color: "var(--text)",
                    borderLeft: "2px solid var(--accent)",
                    paddingLeft: "var(--s4)",
                  }}
                >
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        {learningGoals.length > 0 && (
          <div className="rise" style={{ animationDelay: "160ms" }}>
            <p style={sectionLabel}>Things you wanted to understand</p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
              {learningGoals.map((goal) => (
                <li
                  key={goal}
                  style={{
                    background: "var(--surface)",
                    borderRadius: "var(--radius)",
                    padding: "var(--s3) var(--s4)",
                    fontFamily: "var(--font-ai)",
                    fontSize: 15,
                    lineHeight: 1.5,
                    color: "var(--text)",
                  }}
                >
                  {goal}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {onNewEntry && (
        <div style={{ marginTop: "var(--s7)", display: "flex", justifyContent: "flex-start" }}>
          <button className="btn btn-secondary" style={{ fontSize: 14 }} onClick={onNewEntry}>
            Write a new entry
          </button>
        </div>
      )}
    </section>
  );
};

import React, { useState, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Calendar, Download, Plus, AlertCircle } from "lucide-react";
import { JournalEntry, ActionItem, EntryDigest } from "../types";
import { toggleActionStatus } from "../lib/journalService";
import { calendarUrl, downloadIcsFile } from "../lib/calendar";

interface ActionRailProps {
  userId: string;
  activeEntry: JournalEntry | null;
  digest: EntryDigest | null;
  actions: ActionItem[];
  entries: JournalEntry[];
  isLoading?: boolean;
  onSelectEntry: (entry: JournalEntry) => void;
  onNewEntry: () => void;
}

export const ActionRail: React.FC<ActionRailProps> = ({
  userId,
  activeEntry,
  digest,
  actions,
  entries,
  isLoading = false,
  onSelectEntry,
  onNewEntry,
}) => {
  const shouldReduceMotion = useReducedMotion();

  // Optimistic status overrides map: actionId -> done
  const [optimisticDone, setOptimisticDone] = useState<Record<string, boolean>>({});
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  // Track actions added to Google Calendar inline
  const [addedToCalendar, setAddedToCalendar] = useState<Record<string, boolean>>({});
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  // Resolve actions to display:
  const displayedActions = useMemo<ActionItem[]>(() => {
    if (activeEntry) {
      const entryActions = actions.filter((a) => a.sourceEntryId === activeEntry.id);
      if (entryActions.length > 0) {
        return entryActions;
      }
      const digestNextActions = digest?.next_actions || digest?.nextActions;
      if (digestNextActions && digestNextActions.length > 0) {
        return digestNextActions.map((na, idx) => ({
          id: `digest-action-${activeEntry.id}-${idx}`,
          what: na.what,
          due: na.due || "",
          effort: na.effort || "medium",
          done: false,
          sourceEntryId: activeEntry.id,
          createdAt: activeEntry.closedAt || new Date().toISOString(),
        }));
      }
    }
    return actions.slice(0, 10);
  }, [activeEntry, actions, digest]);

  const handleToggleAction = async (action: ActionItem) => {
    const currentStatus = optimisticDone[action.id] ?? action.done;
    const nextStatus = !currentStatus;

    setOptimisticDone((prev) => ({ ...prev, [action.id]: nextStatus }));
    setSyncErrors((prev) => {
      const copy = { ...prev };
      delete copy[action.id];
      return copy;
    });

    if (!action.id.startsWith("digest-action-")) {
      try {
        await toggleActionStatus(userId, action.id, nextStatus);
      } catch (err) {
        console.error("Reconciling action status due to sync failure:", err);
        setOptimisticDone((prev) => ({ ...prev, [action.id]: currentStatus }));
        setSyncErrors((prev) => ({
          ...prev,
          [action.id]: "Sync failed. Reverted to previous state.",
        }));
        setTimeout(() => {
          setSyncErrors((prev) => {
            const copy = { ...prev };
            delete copy[action.id];
            return copy;
          });
        }, 3500);
      }
    }
  };

  const handleAddToCalendar = (action: ActionItem) => {
    const url = calendarUrl({
      what: action.what,
      dueISO: action.due,
      id: action.id,
    });
    window.open(url, "_blank", "noopener,noreferrer");
    setAddedToCalendar((prev) => ({ ...prev, [action.id]: true }));
  };

  const handleDownloadAllIcs = () => {
    if (displayedActions.length === 0) return;
    const exportItems = displayedActions.map((a) => ({
      what: a.what,
      dueISO: a.due,
      id: a.id,
    }));
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadIcsFile(exportItems, `compass-actions-${dateStr}.ics`);
    setDownloadFeedback("Downloaded .ics file");
    setTimeout(() => setDownloadFeedback(null), 2500);
  };

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  const staggerItemVariants = {
    hidden: {
      opacity: 0,
      y: shouldReduceMotion ? 0 : 4,
    },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: shouldReduceMotion
        ? { duration: 0 }
        : {
            duration: 0.18,
            delay: i * 0.04,
            ease: "easeOut",
          },
    }),
  };

  const themes = digest?.themes || [];
  const rawDecisions = digest?.decisions || [];
  const openQuestions = digest?.open_questions || digest?.openQuestions || [];

  return (
    <aside
      id="action-rail"
      className="rail-action-col flex flex-col overflow-hidden h-full select-text border-l bg-[var(--surface)] border-[var(--border)]"
    >
      <div className="p-8 flex flex-col h-full overflow-y-auto space-y-8">
        {/* Action Rail Heading */}
        <div className="flex items-center justify-between flex-shrink-0 pb-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <h2 className="text-[0.6875rem] uppercase tracking-[0.2em] font-bold font-ai text-[var(--text)]">
              Action Rail
            </h2>
            {activeEntry?.title && (
              <span className="text-xs font-normal truncate max-w-[10rem] font-ai text-[var(--text-muted)]">
                • {activeEntry.title}
              </span>
            )}
          </div>
          <button
            id="btn-new-entry-rail"
            onClick={onNewEntry}
            className="text-xs font-medium font-ai transition-colors cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-transparent text-[var(--text)] hover:bg-[var(--bg-sunk)] hover:border-[var(--border)]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Entry</span>
          </button>
        </div>

        {/* LOADING SKELETON STATE */}
        {isLoading ? (
          <div className="space-y-8 flex-1 animate-pulse" aria-label="Loading entry digest">
            <section className="space-y-3">
              <div className="h-3.5 w-24 rounded bg-[var(--bg-sunk)]" />
              <div className="flex flex-wrap gap-2 pt-1">
                <div className="h-6 w-20 rounded-full bg-[var(--bg-sunk)]" />
                <div className="h-6 w-28 rounded-full bg-[var(--bg-sunk)]" />
                <div className="h-6 w-16 rounded-full bg-[var(--bg-sunk)]" />
              </div>
            </section>

            <section className="space-y-3">
              <div className="h-3.5 w-28 rounded bg-[var(--bg-sunk)]" />
              <div className="p-3 rounded-lg space-y-2 bg-[var(--bg-sunk)] border border-[var(--border)]">
                <div className="h-4 w-4/5 rounded bg-[var(--border)]" />
                <div className="h-3 w-1/2 rounded bg-[var(--border)]" />
              </div>
              <div className="p-3 rounded-lg space-y-2 bg-[var(--bg-sunk)] border border-[var(--border)]">
                <div className="h-4 w-3/4 rounded bg-[var(--border)]" />
              </div>
            </section>

            <section className="space-y-3">
              <div className="h-3.5 w-32 rounded bg-[var(--bg-sunk)]" />
              <div className="space-y-3 pt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3 p-2 rounded-md bg-[var(--bg-sunk)]">
                    <div className="w-4 h-4 rounded mt-0.5 flex-shrink-0 bg-[var(--border)]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-5/6 rounded bg-[var(--border)]" />
                      <div className="h-3 w-1/3 rounded bg-[var(--border)]" />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="h-3.5 w-36 rounded bg-[var(--bg-sunk)]" />
              <div className="space-y-2">
                <div className="h-4 w-full rounded bg-[var(--bg-sunk)]" />
                <div className="h-4 w-4/5 rounded bg-[var(--bg-sunk)]" />
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-8 flex-1">
            {/* SECTION 1: THEMES */}
            <section id="rail-section-themes" aria-label="Themes">
              <h3 className="text-xs font-semibold mb-3 flex items-center gap-2 font-ai text-[var(--text)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                Themes
              </h3>

              {themes.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {themes.map((theme, idx) => (
                    <motion.li
                      key={`${theme}-${idx}`}
                      custom={idx}
                      initial="hidden"
                      animate="visible"
                      variants={staggerItemVariants}
                      className="px-3 py-1 transition-colors rounded-full text-xs font-medium font-ai inline-flex items-center gap-1.5 bg-[var(--bg-sunk)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--accent)]"
                    >
                      <span>{theme}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-[var(--bg-sunk)] border border-dashed border-[var(--border)]">
                  <p className="text-xs leading-relaxed font-ai text-[var(--text)]">
                    Key themes and central threads distilled from your session reflections will
                    appear here as quick-reference chips once your entry is closed.
                  </p>
                </div>
              )}
            </section>

            {/* SECTION 2: DECISIONS */}
            <section id="rail-section-decisions" aria-label="Decisions">
              <h3 className="text-xs font-semibold mb-3 flex items-center gap-2 font-ai text-[var(--text)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-ink)]" />
                Decisions
              </h3>

              {rawDecisions.length > 0 ? (
                <ul className="space-y-3">
                  {rawDecisions.map((dec: any, idx) => {
                    const decisionText = typeof dec === "string" ? dec : dec.decision;
                    const rationale = typeof dec === "object" ? dec.rationale : undefined;
                    const reviewOn = typeof dec === "object" ? dec.review_on : undefined;

                    return (
                      <motion.li
                        key={`decision-${idx}`}
                        custom={idx}
                        initial="hidden"
                        animate="visible"
                        variants={staggerItemVariants}
                        className="p-3 rounded-lg space-y-1.5 bg-[var(--bg-sunk)] border border-[var(--border)]"
                      >
                        <div className="flex items-start gap-2">
                          <span className="font-bold mt-0.5 text-[var(--accent-ink)]">•</span>
                          <span className="text-sm font-medium leading-snug font-ai text-[var(--text)]">
                            {decisionText}
                          </span>
                        </div>
                        {rationale && (
                          <p className="text-xs ml-4 leading-relaxed font-user italic text-[var(--text)]">
                            {rationale}
                          </p>
                        )}
                        {reviewOn && (
                          <div className="ml-4 pt-1">
                            <span className="text-[0.625rem] px-2 py-0.5 rounded inline-flex items-center gap-1 font-mono bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]">
                              Review on: {reviewOn}
                            </span>
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-[var(--bg-sunk)] border border-dashed border-[var(--border)]">
                  <p className="text-xs leading-relaxed font-ai text-[var(--text)]">
                    Firm choices, boundaries, and strategic conclusions reached during your writing
                    will be catalogued here with rationales and review dates.
                  </p>
                </div>
              )}
            </section>

            {/* SECTION 3: NEXT ACTIONS */}
            <section id="rail-section-next-actions" aria-label="Next actions">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold flex items-center gap-2 font-ai text-[var(--text)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                  Next Actions
                  {displayedActions.length > 0 && (
                    <span className="text-[0.625rem] font-normal font-ai text-[var(--text-muted)]">
                      (
                      {
                        displayedActions.filter((a) => optimisticDone[a.id] ?? a.done)
                          .length
                      }
                      /{displayedActions.length})
                    </span>
                  )}
                </h3>

                {displayedActions.length > 0 && (
                  <div className="flex items-center gap-2">
                    {downloadFeedback && (
                      <span className="text-[0.625rem] font-medium font-ai animate-fadeIn text-[var(--accent-ink)]">
                        {downloadFeedback}
                      </span>
                    )}
                    <button
                      id="btn-download-ics"
                      onClick={handleDownloadAllIcs}
                      className="inline-flex items-center gap-1 text-[0.6875rem] font-medium font-ai px-2.5 py-1 rounded-md transition-colors cursor-pointer text-[var(--text)] bg-[var(--bg-sunk)] hover:bg-[var(--accent)] border border-[var(--border)]"
                      title="Download all next actions as an iCalendar (.ics) file"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download .ics</span>
                    </button>
                  </div>
                )}
              </div>

              {displayedActions.length > 0 ? (
                <ul className="space-y-3">
                  {displayedActions.map((action, idx) => {
                    const isDone = optimisticDone[action.id] ?? action.done;
                    const isAddedToCal = addedToCalendar[action.id];
                    const syncError = syncErrors[action.id];

                    return (
                      <motion.li
                        key={action.id}
                        custom={idx}
                        initial="hidden"
                        animate="visible"
                        variants={staggerItemVariants}
                        className={`p-3 rounded-lg border transition-all ${
                          isDone
                            ? "bg-[var(--bg-sunk)] border-[var(--border)] opacity-60"
                            : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent)] shadow-xs"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => handleToggleAction(action)}
                            className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
                              isDone
                                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--text)]"
                                : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent)]"
                            }`}
                            aria-label={`Mark "${action.what}" as ${isDone ? "incomplete" : "complete"}`}
                          >
                            {isDone && <Check className="w-3 h-3 stroke-[3]" />}
                          </button>

                          <div className="flex-1 min-w-0">
                            <span
                              onClick={() => handleToggleAction(action)}
                              className={`text-sm leading-snug cursor-pointer select-none transition-colors block font-ai ${
                                isDone
                                  ? "line-through text-[var(--text-muted)]"
                                  : "text-[var(--text)]"
                              }`}
                            >
                              {action.what}
                            </span>

                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <span className="text-[0.625rem] px-2 py-0.5 rounded font-mono bg-[var(--bg-sunk)] border border-[var(--border)] text-[var(--text)]">
                                {action.due ? `Due ${action.due}` : "Due today"}
                              </span>

                              {action.effort && (
                                <span className="text-[0.625rem] px-1.5 py-0.5 rounded capitalize font-ai bg-[var(--bg-sunk)] border border-[var(--border)] text-[var(--text)]">
                                  {action.effort} effort
                                </span>
                              )}

                              {isAddedToCal ? (
                                <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium font-ai px-2 py-0.5 rounded bg-[var(--accent)] text-[var(--text)] border border-[var(--accent-ink)]">
                                  <Check className="w-2.5 h-2.5" />
                                  Added to calendar
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddToCalendar(action);
                                  }}
                                  className="inline-flex items-center gap-1 text-[0.625rem] font-medium font-ai px-2 py-0.5 rounded transition-colors cursor-pointer text-[var(--text)] bg-[var(--bg-sunk)] hover:bg-[var(--accent)] border border-[var(--border)]"
                                  title="Add to Google Calendar (Template URL)"
                                >
                                  <Calendar className="w-2.5 h-2.5" />
                                  <span>Add to calendar</span>
                                </button>
                              )}
                            </div>

                            {syncError && (
                              <div
                                className="flex items-center gap-1.5 mt-2 text-[0.6875rem] px-2 py-1 rounded font-ai"
                                style={{
                                  color: "var(--danger)",
                                  backgroundColor: "color-mix(in srgb, var(--danger) 10%, var(--surface))",
                                  border: "1px solid color-mix(in srgb, var(--danger) 35%, var(--border))",
                                }}
                              >
                                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                <span>{syncError}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-[var(--bg-sunk)] border border-dashed border-[var(--border)]">
                  <p className="text-xs leading-relaxed font-ai text-[var(--text)]">
                    Concrete next actions and commitments identified in your writing will populate
                    here with calendar syncing, due dates, and completion tracking.
                  </p>
                </div>
              )}
            </section>

            {/* SECTION 4: OPEN QUESTIONS */}
            <section id="rail-section-open-questions" aria-label="Open questions">
              <h3 className="text-xs font-semibold mb-3 flex items-center gap-2 font-ai text-[var(--text)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-ink)]" />
                Open Questions
              </h3>

              {openQuestions.length > 0 ? (
                <ul className="space-y-2.5">
                  {openQuestions.map((question, idx) => (
                    <motion.li
                      key={`question-${idx}`}
                      custom={idx}
                      initial="hidden"
                      animate="visible"
                      variants={staggerItemVariants}
                      className="p-3 rounded-lg bg-[var(--bg-sunk)] border border-[var(--border)]"
                    >
                      <p className="text-sm leading-relaxed italic font-user text-[var(--text)]">
                        &ldquo;{question}&rdquo;
                      </p>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-[var(--bg-sunk)] border border-dashed border-[var(--border)]">
                  <p className="text-xs leading-relaxed font-ai text-[var(--text)]">
                    Unresolved questions, philosophical inquiries, and thought prompts to ponder or
                    explore in future sessions will surface here.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* PAST ENTRIES DRAWER */}
        <div className="pt-6 border-t flex-shrink-0 border-[var(--border)]">
          <h2 className="text-[0.6875rem] uppercase tracking-[0.2em] font-bold mb-3 font-ai text-[var(--text)]">
            Past Entries
          </h2>
          {entries.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {entries.map((ent) => {
                const isCurrent = activeEntry?.id === ent.id;
                return (
                  <div
                    key={ent.id}
                    onClick={() => onSelectEntry(ent)}
                    className={`p-2.5 rounded-lg border flex justify-between items-center cursor-pointer transition-colors ${
                      isCurrent
                        ? "bg-[var(--bg-sunk)] border-[var(--accent)] shadow-2xs"
                        : "border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-sunk)]"
                    }`}
                  >
                    <div className="flex flex-col truncate pr-2">
                      <span className="text-xs font-medium truncate font-ai text-[var(--text)]">
                        {ent.title || "Untitled Entry"}
                      </span>
                      {ent.digest?.themes && ent.digest.themes.length > 0 && (
                        <span className="text-[0.625rem] truncate mt-0.5 font-ai text-[var(--text-muted)]">
                          {ent.digest.themes.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                    <span className="text-[0.625rem] flex-shrink-0 font-mono text-[var(--text-muted)]">
                      {formatRelativeTime(ent.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs italic font-user text-[var(--text-muted)]">No previous entries saved yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
};

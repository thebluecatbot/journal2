import React, { useState, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Calendar, Download, Plus, AlertCircle, Sparkles, ExternalLink } from "lucide-react";
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
  // 1. Specific actions linked to this entry from Firestore
  // 2. Or fallback to digest.next_actions if Firestore actions haven't synced yet
  // 3. Or user's latest actions if entry has none
  const displayedActions = useMemo<ActionItem[]>(() => {
    if (activeEntry) {
      const entryActions = actions.filter((a) => a.sourceEntryId === activeEntry.id);
      if (entryActions.length > 0) {
        return entryActions;
      }
      // If Firestore hasn't returned them yet, but digest has next_actions:
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
    // Default to recent actions across entries if no specific entry actions
    return actions.slice(0, 10);
  }, [activeEntry, actions, digest]);

  // Handle optimistic checkbox toggle with reconciliation on failure
  const handleToggleAction = async (action: ActionItem) => {
    const currentStatus = optimisticDone[action.id] ?? action.done;
    const nextStatus = !currentStatus;

    // 1. Optimistic update
    setOptimisticDone((prev) => ({ ...prev, [action.id]: nextStatus }));
    setSyncErrors((prev) => {
      const copy = { ...prev };
      delete copy[action.id];
      return copy;
    });

    // 2. If it's a real Firestore action, persist with reconciliation on failure
    if (!action.id.startsWith("digest-action-")) {
      try {
        await toggleActionStatus(userId, action.id, nextStatus);
      } catch (err) {
        console.error("Reconciling action status due to sync failure:", err);
        // Reconcile back to original state on failure
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

  // One-click Add to Google Calendar via TEMPLATE URL (no OAuth, no tokens)
  const handleAddToCalendar = (action: ActionItem) => {
    const url = calendarUrl({
      what: action.what,
      dueISO: action.due,
      id: action.id,
    });
    window.open(url, "_blank", "noopener,noreferrer");
    setAddedToCalendar((prev) => ({ ...prev, [action.id]: true }));
  };

  // Whole action list iCalendar (.ics) download
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

  // Format relative timestamp for past entries
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

  // Stagger animation configuration: 40ms stagger, <= 200ms duration, respects prefers-reduced-motion
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
            duration: 0.18, // 180ms <= 200ms
            delay: i * 0.04, // 40ms stagger
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
      className="rail-action-col flex flex-col bg-white overflow-hidden h-full select-text border-l border-[#EBEBEB]"
    >
      <div className="p-8 flex flex-col h-full overflow-y-auto space-y-8">
        {/* Action Rail Heading */}
        <div className="flex items-center justify-between flex-shrink-0 pb-2 border-b border-[#F2F2F0]">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#888] font-bold">
              Action Rail
            </h2>
            {activeEntry?.title && (
              <span className="text-xs text-stone-400 font-normal truncate max-w-[160px]">
                • {activeEntry.title}
              </span>
            )}
          </div>
          <button
            id="btn-new-entry-rail"
            onClick={onNewEntry}
            className="text-xs font-medium text-black hover:text-stone-600 transition-colors cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-stone-50 border border-transparent hover:border-stone-200"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Entry</span>
          </button>
        </div>

        {/* LOADING SKELETON STATE - NO SPINNERS */}
        {isLoading ? (
          <div className="space-y-8 flex-1 animate-pulse" aria-label="Loading entry digest">
            {/* 1. Themes Skeleton */}
            <section className="space-y-3">
              <div className="h-3.5 w-24 bg-stone-200 rounded" />
              <div className="flex flex-wrap gap-2 pt-1">
                <div className="h-6 w-20 bg-stone-200 rounded-full" />
                <div className="h-6 w-28 bg-stone-200 rounded-full" />
                <div className="h-6 w-16 bg-stone-200 rounded-full" />
              </div>
            </section>

            {/* 2. Decisions Skeleton */}
            <section className="space-y-3">
              <div className="h-3.5 w-28 bg-stone-200 rounded" />
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-100 space-y-2">
                <div className="h-4 w-4/5 bg-stone-200 rounded" />
                <div className="h-3 w-1/2 bg-stone-200 rounded" />
              </div>
              <div className="p-3 bg-stone-50 rounded-lg border border-stone-100 space-y-2">
                <div className="h-4 w-3/4 bg-stone-200 rounded" />
              </div>
            </section>

            {/* 3. Next Actions Skeleton */}
            <section className="space-y-3">
              <div className="h-3.5 w-32 bg-stone-200 rounded" />
              <div className="space-y-3 pt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3 p-2 bg-stone-50/50 rounded-md">
                    <div className="w-4 h-4 rounded bg-stone-200 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-5/6 bg-stone-200 rounded" />
                      <div className="h-3 w-1/3 bg-stone-200 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 4. Open Questions Skeleton */}
            <section className="space-y-3">
              <div className="h-3.5 w-36 bg-stone-200 rounded" />
              <div className="space-y-2">
                <div className="h-4 w-full bg-stone-200 rounded" />
                <div className="h-4 w-4/5 bg-stone-200 rounded" />
              </div>
            </section>
          </div>
        ) : (
          /* POPULATED CONTENT SECTIONS IN EXACT REQUIRED ORDER:
             1. Themes (as chips)
             2. Decisions
             3. Next actions
             4. Open questions
          */
          <div className="space-y-8 flex-1">
            {/* ========================================================
                SECTION 1: THEMES (AS CHIPS)
               ======================================================== */}
            <section id="rail-section-themes" aria-label="Themes">
              <h3 className="text-xs font-semibold text-[#1A1A1A] mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
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
                      className="px-3 py-1 bg-[#F5F5F4] hover:bg-stone-200/70 transition-colors rounded-full text-xs text-[#444] border border-[#E7E5E4] font-medium inline-flex items-center gap-1.5"
                    >
                      <span>{theme}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-stone-50/70 border border-dashed border-stone-200">
                  <p className="text-xs text-[#777] leading-relaxed">
                    Key themes and central threads distilled from your session reflections will
                    appear here as quick-reference chips once your entry is closed.
                  </p>
                </div>
              )}
            </section>

            {/* ========================================================
                SECTION 2: DECISIONS
               ======================================================== */}
            <section id="rail-section-decisions" aria-label="Decisions">
              <h3 className="text-xs font-semibold text-[#1A1A1A] mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-zinc-700 rounded-full" />
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
                        className="p-3 rounded-lg bg-[#FAF9F6] border border-[#EBEBEA] space-y-1.5"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-zinc-500 font-bold mt-0.5">•</span>
                          <span className="text-sm font-medium text-[#1A1A1A] leading-snug">
                            {decisionText}
                          </span>
                        </div>
                        {rationale && (
                          <p className="text-xs text-[#666] ml-4 leading-relaxed font-sans italic">
                            {rationale}
                          </p>
                        )}
                        {reviewOn && (
                          <div className="ml-4 pt-1">
                            <span className="text-[10px] text-[#777] bg-white px-2 py-0.5 rounded border border-stone-200 inline-flex items-center gap-1 font-mono">
                              Review on: {reviewOn}
                            </span>
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-stone-50/70 border border-dashed border-stone-200">
                  <p className="text-xs text-[#777] leading-relaxed">
                    Firm choices, boundaries, and strategic conclusions reached during your writing
                    will be catalogued here with rationales and review dates.
                  </p>
                </div>
              )}
            </section>

            {/* ========================================================
                SECTION 3: NEXT ACTIONS
               ======================================================== */}
            <section id="rail-section-next-actions" aria-label="Next actions">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-[#1A1A1A] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full" />
                  Next Actions
                  {displayedActions.length > 0 && (
                    <span className="text-[10px] text-stone-400 font-normal">
                      (
                      {
                        displayedActions.filter((a) => optimisticDone[a.id] ?? a.done)
                          .length
                      }
                      /{displayedActions.length})
                    </span>
                  )}
                </h3>

                {/* Download .ics button for the whole action list */}
                {displayedActions.length > 0 && (
                  <div className="flex items-center gap-2">
                    {downloadFeedback && (
                      <span className="text-[10px] text-emerald-600 font-medium animate-fadeIn">
                        {downloadFeedback}
                      </span>
                    )}
                    <button
                      id="btn-download-ics"
                      onClick={handleDownloadAllIcs}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-600 hover:text-black bg-stone-50 hover:bg-stone-100 px-2.5 py-1 rounded-md border border-stone-200 transition-colors cursor-pointer"
                      title="Download all next actions as an iCalendar (.ics) file"
                    >
                      <Download className="w-3 h-3 text-stone-500" />
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
                            ? "bg-stone-50/60 border-stone-200 text-stone-400"
                            : "bg-white border-[#EBEBEB] hover:border-stone-300 shadow-xs"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Checkbox with optimistic updates */}
                          <button
                            type="button"
                            onClick={() => handleToggleAction(action)}
                            className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
                              isDone
                                ? "bg-black border-black text-white"
                                : "border-stone-300 bg-white hover:border-black"
                            }`}
                            aria-label={`Mark "${action.what}" as ${isDone ? "incomplete" : "complete"}`}
                          >
                            {isDone && <Check className="w-3 h-3 stroke-[3]" />}
                          </button>

                          {/* Action Details */}
                          <div className="flex-1 min-w-0">
                            <span
                              onClick={() => handleToggleAction(action)}
                              className={`text-sm leading-snug cursor-pointer select-none transition-colors block ${
                                isDone
                                  ? "line-through text-stone-400"
                                  : "text-[#222] hover:text-black"
                              }`}
                            >
                              {action.what}
                            </span>

                            {/* Metadata Badges & Calendar Action */}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              {/* Due Date Badge - defaults to today if absent */}
                              <span className="text-[10px] text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 font-mono">
                                {action.due ? `Due ${action.due}` : "Due today"}
                              </span>

                              {/* Effort Badge */}
                              {action.effort && (
                                <span className="text-[10px] text-stone-500 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-200 capitalize">
                                  {action.effort} effort
                                </span>
                              )}

                              {/* "Add to Calendar" button (Google Calendar TEMPLATE URL, NO OAuth) */}
                              {isAddedToCal ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  Added to calendar
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddToCalendar(action);
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium text-stone-600 hover:text-black bg-stone-50 hover:bg-stone-100 px-2 py-0.5 rounded border border-stone-200 transition-colors cursor-pointer"
                                  title="Add to Google Calendar (Template URL)"
                                >
                                  <Calendar className="w-2.5 h-2.5 text-stone-500" />
                                  <span>Add to calendar</span>
                                </button>
                              )}
                            </div>

                            {/* Reconciliation Failure Message */}
                            {syncError && (
                              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-rose-600 bg-rose-50 px-2 py-1 rounded border border-rose-200">
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
                <div className="p-3.5 rounded-lg bg-stone-50/70 border border-dashed border-stone-200">
                  <p className="text-xs text-[#777] leading-relaxed">
                    Concrete next actions and commitments identified in your writing will populate
                    here with calendar syncing, due dates, and completion tracking.
                  </p>
                </div>
              )}
            </section>

            {/* ========================================================
                SECTION 4: OPEN QUESTIONS
               ======================================================== */}
            <section id="rail-section-open-questions" aria-label="Open questions">
              <h3 className="text-xs font-semibold text-[#1A1A1A] mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
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
                      className="p-3 rounded-lg bg-[#FCFBFA] border border-[#F0EFEB]"
                    >
                      <p className="text-xs text-[#555] leading-relaxed italic font-serif">
                        &ldquo;{question}&rdquo;
                      </p>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="p-3.5 rounded-lg bg-stone-50/70 border border-dashed border-stone-200">
                  <p className="text-xs text-[#777] leading-relaxed">
                    Unresolved questions, philosophical inquiries, and thought prompts to ponder or
                    explore in future sessions will surface here.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ========================================================
            PAST ENTRIES DRAWER / RECENT HISTORY
           ======================================================== */}
        <div className="pt-6 border-t border-[#F0F0F0] flex-shrink-0">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-[#999] font-bold mb-3">
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
                        ? "bg-[#FAF9F6] border-[#E2E0DB] shadow-2xs"
                        : "border-transparent hover:border-[#EBEBEB] hover:bg-[#FAF9F6]/60"
                    }`}
                  >
                    <div className="flex flex-col truncate pr-2">
                      <span className="text-xs font-medium text-[#222] truncate">
                        {ent.title || "Untitled Entry"}
                      </span>
                      {ent.digest?.themes && ent.digest.themes.length > 0 && (
                        <span className="text-[10px] text-[#888] truncate mt-0.5">
                          {ent.digest.themes.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#AAA] flex-shrink-0 font-mono">
                      {formatRelativeTime(ent.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#AAA] italic">No previous entries saved yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
};

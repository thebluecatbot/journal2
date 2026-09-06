import React, { useEffect, useState } from "react";
import { PatternReport } from "../types";
import { fetchPatterns, analyseEntryById } from "../lib/api";

interface InsightsPanelProps {
  onOpenEntry: (entryId: string) => void;
  onSelectTheme: (theme: string) => void;
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

const DIRECTION_WORD: Record<string, string> = {
  rising: "Lifting",
  falling: "Dropping",
  steady: "Level",
  mixed: "Up and down",
};

/**
 * Reads across recent digests and reports what keeps coming back.
 *
 * This is context-window recall over the most recent digests. There is no embedding
 * index behind it and it must not be described as semantic or vector search.
 */
export const InsightsPanel: React.FC<InsightsPanelProps> = ({ onOpenEntry, onSelectTheme }) => {
  const [report, setReport] = useState<PatternReport | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [analysing, setAnalysing] = useState(false);
  const [analyseNote, setAnalyseNote] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    try {
      setReport(await fetchPatterns());
      setState("ready");
    } catch (err) {
      console.warn("Insights failed to load:", err);
      setState("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /**
   * Analyse the closed entries that were never analysed, then reload.
   * Analysis is opt-in, so Insights is otherwise blind to them and would under-report
   * without saying why.
   */
  const analyseMissing = async () => {
    const pending = report?.unanalysed || [];
    if (pending.length === 0 || analysing) return;

    setAnalysing(true);
    setAnalyseNote(null);
    let done = 0;
    for (const item of pending) {
      if (await analyseEntryById(item.entry_id)) done += 1;
    }
    setAnalysing(false);
    setAnalyseNote(
      done === pending.length
        ? null
        : `${pending.length - done} of ${pending.length} could not be analysed. Your entries are unchanged.`
    );
    await load();
  };

  const unanalysedCount = report?.unanalysed_count ?? 0;
  const unanalysedNotice =
    state === "ready" && unanalysedCount > 0 ? (
      <div
        style={{
          background: "var(--bg-sunk)",
          borderRadius: "var(--radius)",
          padding: "var(--s4)",
          marginBottom: "var(--s6)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--s4)",
          flexWrap: "wrap",
        }}
      >
        <span className="chrome" style={{ lineHeight: 1.6, maxWidth: "46ch" }}>
          {unanalysedCount === 1
            ? "1 closed entry has not been analysed, so it is not counted here."
            : `${unanalysedCount} closed entries have not been analysed, so they are not counted here.`}
        </span>
        <button className="btn btn-secondary" style={{ fontSize: 14 }} onClick={analyseMissing} disabled={analysing}>
          {analysing ? "Analysing" : unanalysedCount === 1 ? "Analyse it" : "Analyse them"}
        </button>
      </div>
    ) : null;

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: "46rem", margin: "0 auto", padding: "var(--s8) var(--s5)" }}>
        <h1
          style={{
            fontFamily: "var(--font-user)",
            fontSize: 30,
            fontWeight: 500,
            color: "var(--text)",
          }}
        >
          Insights
        </h1>
        <p className="chrome" style={{ marginTop: "var(--s2)", marginBottom: "var(--s7)", maxWidth: "52ch", lineHeight: 1.6 }}>
          What comes back across your recent entries. This reads the summaries of your last twenty
          entries, nothing older.
        </p>

        {state === "loading" && (
          <div aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 68,
                  background: "var(--bg-sunk)",
                  borderRadius: "var(--radius)",
                  marginBottom: "var(--s3)",
                }}
              />
            ))}
            <span className="chrome">Reading your recent entries</span>
          </div>
        )}

        {state === "error" && (
          <div>
            <p className="chrome" style={{ lineHeight: 1.7, maxWidth: "48ch", marginBottom: "var(--s4)" }}>
              Insights could not be loaded. Your entries are unaffected and everything else still
              works.
            </p>
            <button className="btn btn-secondary" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {state === "ready" && report && (
          <>
            {unanalysedNotice}
            {analyseNote && (
              <p className="chrome" style={{ marginBottom: "var(--s5)" }} role="status">
                {analyseNote}
              </p>
            )}
            {report.insufficient_history ? (
              <p style={{ fontFamily: "var(--font-user)", fontSize: 19, lineHeight: 1.7, color: "var(--text)", maxWidth: "48ch" }}>
                {report.observation}
              </p>
            ) : (
              <>
                <p
                  style={{
                    fontFamily: "var(--font-user)",
                    fontSize: 21,
                    lineHeight: 1.6,
                    color: "var(--text)",
                    maxWidth: "48ch",
                    borderLeft: "2px solid var(--accent)",
                    paddingLeft: "var(--s5)",
                    marginBottom: "var(--s7)",
                  }}
                >
                  {report.observation}
                </p>

                <p className="chrome" style={{ marginBottom: "var(--s7)" }}>
                  {report.entries_considered} entries
                  {report.period ? `, ${report.period}` : ""}
                  {report.degraded ? ". Some parts of this report are unavailable right now." : ""}
                </p>

                {report.recurring_themes.length > 0 && (
                  <section style={{ marginBottom: "var(--s7)" }}>
                    <p style={sectionLabel}>What keeps coming up</p>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
                      {report.recurring_themes.map((theme) => (
                        <li
                          key={theme.theme}
                          style={{
                            background: "var(--bg-sunk)",
                            borderRadius: "var(--radius)",
                            padding: "var(--s3) var(--s4)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "var(--s3)",
                            flexWrap: "wrap",
                          }}
                        >
                          <button className="chip" onClick={() => onSelectTheme(theme.theme)}>
                            {theme.theme}
                          </button>
                          <span className="chrome" style={{ fontSize: 13 }}>
                            {theme.count} entries
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {report.unresolved_loops.length > 0 && (
                  <section style={{ marginBottom: "var(--s7)" }}>
                    <p style={sectionLabel}>Questions you keep returning to</p>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s4)" }}>
                      {report.unresolved_loops.map((loop, i) => (
                        <li key={i}>
                          <p style={{ fontFamily: "var(--font-user)", fontSize: 18, lineHeight: 1.6, color: "var(--text)" }}>
                            {loop.question}
                          </p>
                          <div style={{ display: "flex", gap: "var(--s3)", flexWrap: "wrap", alignItems: "center", marginTop: "var(--s2)" }}>
                            <span className="chrome" style={{ fontSize: 13 }}>
                              Raised in {loop.times_raised} entries
                              {loop.first_seen ? `, first on ${loop.first_seen}` : ""}
                            </span>
                            {(loop.entry_ids || []).slice(0, 4).map((id, n) => (
                              <button
                                key={id}
                                className="btn btn-quiet"
                                style={{ fontSize: 13, padding: "var(--s1) var(--s2)", minHeight: 0 }}
                                onClick={() => onOpenEntry(id)}
                              >
                                Entry {n + 1}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {report.stalled_actions.length > 0 && (
                  <section style={{ marginBottom: "var(--s7)" }}>
                    <p style={sectionLabel}>Actions that have not moved</p>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
                      {report.stalled_actions.map((action, i) => (
                        <li
                          key={i}
                          style={{
                            background: "var(--bg-sunk)",
                            borderRadius: "var(--radius)",
                            padding: "var(--s3) var(--s4)",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "var(--s3)",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontFamily: "var(--font-ai)", fontSize: 15, color: "var(--text)" }}>
                            {action.what}
                          </span>
                          <span className="chrome" style={{ fontSize: 13 }}>
                            {action.age_days} days old
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <p style={sectionLabel}>Mood across these entries</p>
                  <p style={{ fontFamily: "var(--font-ai)", fontSize: 15, lineHeight: 1.6, color: "var(--text)", maxWidth: "48ch" }}>
                    {DIRECTION_WORD[report.mood_trend.direction] || "Level"}
                    {report.mood_trend.note ? `. ${report.mood_trend.note}` : "."}
                  </p>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
};

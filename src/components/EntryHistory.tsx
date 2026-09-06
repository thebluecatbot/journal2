import React, { useEffect, useMemo, useRef, useState } from "react";
import { JournalEntry } from "../types";
import { MoodIndicator } from "./MoodIndicator";
import { getMode } from "../lib/modes";

interface EntryHistoryProps {
  entries: JournalEntry[];
  activeThemes: string[];
  onToggleTheme: (theme: string) => void;
  onClearFilters: () => void;
  onOpenEntry: (entry: JournalEntry) => void;
}

const MOODS = ["low", "flat", "steady", "good", "high"];

/**
 * Reverse chronological history with search and filters.
 *
 * Only entry documents are read here, never their turns. Turns load when an entry is
 * opened, so a long history stays cheap.
 */
export const EntryHistory: React.FC<EntryHistoryProps> = ({
  entries,
  activeThemes,
  onToggleTheme,
  onClearFilters,
  onOpenEntry,
}) => {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [moodFilter, setMoodFilter] = useState<string | null>(null);
  const [visible, setVisible] = useState(50);
  const searchRef = useRef<HTMLInputElement>(null);

  // 200ms debounce, so typing does not re-filter on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(rawQuery.trim().toLowerCase()), 200);
    return () => window.clearTimeout(id);
  }, [rawQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closed = useMemo(
    () =>
      entries
        .filter((e) => e.status === "closed")
        .sort((a, b) => String(b.closedAt || b.createdAt).localeCompare(String(a.closedAt || a.createdAt))),
    [entries]
  );

  const filtered = useMemo(() => {
    return closed.filter((e) => {
      const themes = (e.digest?.themes || []).map((t) => t.toLowerCase());

      if (activeThemes.length && !activeThemes.every((t) => themes.includes(t.toLowerCase()))) {
        return false;
      }
      if (moodFilter && String(e.digest?.mood || "steady") !== moodFilter) return false;

      if (!query) return true;

      // Title, themes and the digest body text. Raw turns are not loaded here.
      const haystack = [
        e.digest?.title || e.title || "",
        ...(e.digest?.themes || []),
        ...(e.digest?.open_questions || e.digest?.openQuestions || []),
        ...(e.digest?.next_actions || e.digest?.nextActions || []).map((a) => a.what),
        ...(e.digest?.decisions || []).map((d: any) => (typeof d === "string" ? d : d?.decision || "")),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [closed, query, activeThemes, moodFilter]);

  const shown = filtered.slice(0, visible);

  // Group by month, keeping the reverse chronological order.
  const groups = useMemo(() => {
    const map: Array<{ label: string; items: JournalEntry[] }> = [];
    for (const entry of shown) {
      const date = new Date(entry.closedAt || entry.createdAt || Date.now());
      const label = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const last = map[map.length - 1];
      if (last && last.label === label) last.items.push(entry);
      else map.push({ label, items: [entry] });
    }
    return map;
  }, [shown]);

  const filtersActive = activeThemes.length > 0 || Boolean(moodFilter) || Boolean(query);

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: "46rem", margin: "0 auto", padding: "var(--s8) var(--s5) var(--s8)" }}>
        <h1
          style={{
            fontFamily: "var(--font-user)",
            fontSize: 30,
            fontWeight: 500,
            color: "var(--text)",
            marginBottom: "var(--s5)",
          }}
        >
          History
        </h1>

        <label htmlFor="entry-search" className="eyebrow" style={{ display: "block", marginBottom: "var(--s2)" }}>
          Search your entries
        </label>
        <input
          id="entry-search"
          ref={searchRef}
          type="search"
          value={rawQuery}
          onChange={(e) => {
            setRawQuery(e.target.value);
            setVisible(50);
          }}
          placeholder="Title, theme, question or action"
          style={{
            width: "100%",
            fontFamily: "var(--font-ai)",
            fontSize: 15,
            padding: "var(--s3) var(--s4)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--text)",
            outline: "none",
            minHeight: 44,
          }}
        />

        <div
          style={{
            display: "flex",
            gap: "var(--s2)",
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: "var(--s4)",
          }}
        >
          {MOODS.map((m) => (
            <button
              key={m}
              className="chip"
              data-active={moodFilter === m}
              aria-pressed={moodFilter === m}
              onClick={() => setMoodFilter((prev) => (prev === m ? null : m))}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          {activeThemes.map((t) => (
            <button key={t} className="chip" data-active="true" onClick={() => onToggleTheme(t)}>
              {t} ×
            </button>
          ))}
          {filtersActive && (
            <button
              className="btn btn-quiet"
              style={{ fontSize: 13 }}
              onClick={() => {
                setRawQuery("");
                setQuery("");
                setMoodFilter(null);
                onClearFilters();
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <p className="chrome" style={{ marginTop: "var(--s4)", marginBottom: "var(--s6)" }} aria-live="polite">
          {filtered.length === 1 ? "1 entry" : `${filtered.length} entries`}
          {filtersActive ? ` of ${closed.length}` : ""}
        </p>

        {closed.length === 0 && (
          <p className="chrome" style={{ lineHeight: 1.7, maxWidth: "48ch" }}>
            Closed entries appear here, grouped by month, with their themes and what came out of
            them. Nothing has been closed yet.
          </p>
        )}

        {closed.length > 0 && filtered.length === 0 && (
          <p className="chrome" style={{ lineHeight: 1.7, maxWidth: "48ch" }}>
            No entry matches that. Try a shorter search, or clear the filters.
          </p>
        )}

        {groups.map((group) => (
          <section key={group.label} style={{ marginBottom: "var(--s6)" }}>
            <h2
              className="eyebrow"
              style={{
                position: "sticky",
                top: 0,
                background: "var(--bg)",
                paddingTop: "var(--s3)",
                paddingBottom: "var(--s3)",
                zIndex: 5,
              }}
            >
              {group.label}
            </h2>

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
              {group.items.map((entry) => {
                const themes = entry.digest?.themes || [];
                const date = new Date(entry.closedAt || entry.createdAt || Date.now());
                return (
                  <li key={entry.id}>
                    <div
                      style={{
                        background: "var(--surface)",
                        borderRadius: "var(--radius)",
                        padding: "var(--s4)",
                      }}
                    >
                      <button
                        onClick={() => onOpenEntry(entry)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        <span className="eyebrow">
                          {date.toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                          {" · "}
                          {getMode(entry.mode).label}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontFamily: "var(--font-user)",
                            fontSize: 20,
                            lineHeight: 1.35,
                            color: "var(--text)",
                            marginTop: "var(--s1)",
                          }}
                        >
                          {entry.digest?.title || entry.title}
                        </span>
                      </button>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--s3)",
                          flexWrap: "wrap",
                          marginTop: "var(--s3)",
                        }}
                      >
                        <MoodIndicator mood={entry.digest?.mood || "steady"} compact />
                        {themes.slice(0, 3).map((theme) => (
                          <button
                            key={theme}
                            className="chip"
                            data-active={activeThemes.some((t) => t.toLowerCase() === theme.toLowerCase())}
                            onClick={() => onToggleTheme(theme)}
                          >
                            {theme}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {filtered.length > visible && (
          <button className="btn btn-secondary" onClick={() => setVisible((v) => v + 50)}>
            Show 50 more
          </button>
        )}
      </div>
    </main>
  );
};

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./lib/firebase";
import { UserProfile, JournalEntry, ConversationTurn, ActionItem } from "./types";
import { LandingPage } from "./components/LandingPage";
import { Header, Space } from "./components/Header";
import { JournalConversation } from "./components/JournalConversation";
import { BrainstormCanvas } from "./components/BrainstormCanvas";
import { BrainstormBoards } from "./components/BrainstormBoards";
import { EntryHistory } from "./components/EntryHistory";
import { InsightsPanel } from "./components/InsightsPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CompassMark } from "./components/CompassMark";
import {
  saveUserProfile,
  createJournalEntry,
  subscribeToEntries,
  subscribeToTurns,
  subscribeToActions,
} from "./lib/journalService";

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [space, setSpace] = useState<Space>("journal");

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [themeFilters, setThemeFilters] = useState<string[]>([]);
  // null means the boards list. A board id means that board is open.
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // 1. Firebase authentication. Google sign-in only.
  useEffect(() => {
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        const profile: UserProfile = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        };
        setCurrentUser(profile);
        await saveUserProfile(profile);
      } else {
        setCurrentUser(null);
        setActiveEntryId(null);
        setEntries([]);
        setTurns([]);
        setActions([]);
      }
      setAuthLoading(false);
    });
  }, []);

  // 2. Entries and actions, both scoped to this user's own tree.
  useEffect(() => {
    if (!currentUser) return;

    const unsubEntries = subscribeToEntries(currentUser.uid, (fetched) => {
      setEntries(fetched);
      setActiveEntryId((prev) => {
        if (prev && fetched.some((e) => e.id === prev)) return prev;
        // Prefer resuming an open entry over dropping the writer into a closed one.
        const open = fetched.find((e) => e.status !== "closed");
        return open?.id ?? fetched[0]?.id ?? null;
      });
    });

    const unsubActions = subscribeToActions(currentUser.uid, setActions);

    return () => {
      unsubEntries();
      unsubActions();
    };
  }, [currentUser]);

  // 3. Turns, loaded only for the entry actually being read.
  useEffect(() => {
    if (!currentUser || !activeEntryId) {
      setTurns([]);
      return;
    }
    return subscribeToTurns(currentUser.uid, activeEntryId, setTurns);
  }, [currentUser, activeEntryId]);

  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeEntryId) ?? null,
    [entries, activeEntryId]
  );

  const handleNewEntry = useCallback(async () => {
    if (!currentUser) return;
    setSpace("journal");

    // If there is already an empty open entry, reuse it rather than piling up blanks.
    const reusable = entries.find((e) => e.status !== "closed" && !e.digest);
    if (reusable && reusable.id === activeEntryId && turns.length === 0) return;

    try {
      setBanner(null);
      const entry = await createJournalEntry(currentUser.uid, "Untitled entry");
      setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
      setActiveEntryId(entry.id);
    } catch (err) {
      console.error("Could not create an entry:", err);
      setBanner("A new entry could not be created. Check your connection and try again.");
    }
  }, [currentUser, entries, activeEntryId, turns.length]);

  // The writer needs somewhere to write the moment they land, but a blank entry should
  // only be created once we know they have none open.
  useEffect(() => {
    if (!currentUser) return;
    if (activeEntryId) return;
    if (entries.length > 0) return;
    void handleNewEntry();
    // handleNewEntry is stable enough here; re-running on every entries change would
    // create duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, entries.length, activeEntryId]);

  const toggleTheme = useCallback((theme: string) => {
    setThemeFilters((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === theme.toLowerCase());
      return exists ? prev.filter((t) => t.toLowerCase() !== theme.toLowerCase()) : [...prev, theme];
    });
  }, []);

  const selectThemeAndShowHistory = useCallback(
    (theme: string) => {
      toggleTheme(theme);
      setSpace("history");
    },
    [toggleTheme]
  );

  const openEntryById = useCallback((entryId: string) => {
    setActiveEntryId(entryId);
    setSpace("journal");
  }, []);

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--bg)",
          gap: "var(--s3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
          <CompassMark size={20} />
          <span className="chrome">Opening Compass</span>
        </div>
      </div>
    );
  }

  if (!currentUser) return <LandingPage />;

  const firstName = currentUser.displayName?.trim().split(/\s+/)[0];

  return (
    <ErrorBoundary
      title="Compass hit an error"
      detail="Reloading usually clears it. Everything you have written is stored and will still be here."
    >
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--bg)" }}>
        <Header
          user={currentUser}
          userId={currentUser.uid}
          activeSpace={space}
          onSelectSpace={setSpace}
          onNewEntry={handleNewEntry}
        />

        {banner && (
          <div
            role="alert"
            style={{
              background: "var(--danger-soft)",
              borderTop: "1px solid var(--danger)",
              borderBottom: "1px solid var(--danger)",
              padding: "var(--s3) var(--s5)",
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--s4)",
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: "var(--font-ai)", fontSize: 14, color: "var(--danger)" }}>{banner}</span>
            <button className="btn btn-quiet" style={{ fontSize: 13 }} onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
        )}

        {space === "brainstorm" && (
          <ErrorBoundary
            title="The canvas stopped working"
            detail="Your journal entries are unaffected. Switch back to Journal to keep writing."
            onReset={() => {
              setOpenBoardId(null);
              setSpace("journal");
            }}
          >
            {openBoardId ? (
              <BrainstormCanvas
                key={openBoardId}
                userId={currentUser.uid}
                boardId={openBoardId}
                onBack={() => setOpenBoardId(null)}
              />
            ) : (
              <BrainstormBoards userId={currentUser.uid} onOpenBoard={setOpenBoardId} />
            )}
          </ErrorBoundary>
        )}

        {space === "history" && (
          <ErrorBoundary
            title="History could not be shown"
            detail="Your entries are unaffected."
            onReset={() => setSpace("journal")}
          >
            <EntryHistory
              entries={entries}
              activeThemes={themeFilters}
              onToggleTheme={toggleTheme}
              onClearFilters={() => setThemeFilters([])}
              onOpenEntry={(entry) => openEntryById(entry.id)}
            />
          </ErrorBoundary>
        )}

        {space === "insights" && (
          <ErrorBoundary
            title="Insights could not be shown"
            detail="Your entries are unaffected and the journal still works."
            onReset={() => setSpace("journal")}
          >
            <InsightsPanel onOpenEntry={openEntryById} onSelectTheme={selectThemeAndShowHistory} />
          </ErrorBoundary>
        )}

        {space === "journal" && (
          <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {activeEntry ? (
              <JournalConversation
                key={activeEntry.id}
                userId={currentUser.uid}
                entry={activeEntry}
                turns={turns}
                actions={actions}
                firstName={firstName}
                onSelectTheme={selectThemeAndShowHistory}
                onDigestUpdated={(digest) =>
                  setEntries((prev) =>
                    prev.map((e) => (e.id === activeEntry.id ? { ...e, digest } : e))
                  )
                }
                onEntryClosed={() =>
                  setEntries((prev) =>
                    prev.map((e) =>
                      e.id === activeEntry.id
                        ? { ...e, status: "closed", closedAt: new Date().toISOString() }
                        : e
                    )
                  )
                }
                onEntryReopened={() =>
                  setEntries((prev) =>
                    prev.map((e) => (e.id === activeEntry.id ? { ...e, status: "open" } : e))
                  )
                }
                onNewEntryRequested={handleNewEntry}
              />
            ) : (
              <div style={{ maxWidth: "var(--measure)", margin: "0 auto", padding: "var(--s8) var(--s5)" }}>
                <h1 style={{ fontFamily: "var(--font-user)", fontSize: 30, fontWeight: 500, color: "var(--text)" }}>
                  {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
                </h1>
                <p className="chrome" style={{ marginTop: "var(--s4)", marginBottom: "var(--s6)", lineHeight: 1.7 }}>
                  Start an entry whenever you are ready.
                </p>
                <button className="btn btn-primary" onClick={handleNewEntry}>
                  Start an entry
                </button>
              </div>
            )}
          </main>
        )}
      </div>
    </ErrorBoundary>
  );
}

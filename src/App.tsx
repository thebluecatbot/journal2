import React, { useState, useEffect } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./lib/firebase";
import { UserProfile, JournalEntry, ConversationTurn, ActionItem } from "./types";
import { LandingPage } from "./components/LandingPage";
import { Header } from "./components/Header";
import { JournalConversation } from "./components/JournalConversation";
import { ActionRail } from "./components/ActionRail";
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

  // Journal entries state
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [isClosingEntry, setIsClosingEntry] = useState(false);
  const [entryCreationError, setEntryCreationError] = useState<string | null>(null);

  // 1. Listen to Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
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
        setActiveEntry(null);
        setEntries([]);
        setTurns([]);
        setActions([]);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. Subscribe to user entries and action rail items
  useEffect(() => {
    if (!currentUser) return;

    const unsubEntries = subscribeToEntries(currentUser.uid, async (fetchedEntries) => {
      setEntries(fetchedEntries);
      if (fetchedEntries.length === 0) {
        // If the user has no entries, create an initial open entry
        const initial = await createJournalEntry(currentUser.uid, "Welcome Reflection");
        setActiveEntry(initial);
      } else {
        setActiveEntry((prev) => {
          if (!prev) return fetchedEntries[0];
          const updated = fetchedEntries.find((e) => e.id === prev.id);
          return updated || fetchedEntries[0];
        });
      }
    });

    const unsubActions = subscribeToActions(currentUser.uid, (fetchedActions) => {
      setActions(fetchedActions);
    });

    return () => {
      unsubEntries();
      unsubActions();
    };
  }, [currentUser]);

  // 3. Subscribe to turns of active entry
  useEffect(() => {
    if (!currentUser || !activeEntry) {
      setTurns([]);
      return;
    }

    const unsubTurns = subscribeToTurns(currentUser.uid, activeEntry.id, (fetchedTurns) => {
      setTurns(fetchedTurns);
    });

    return () => unsubTurns();
  }, [currentUser, activeEntry?.id]);

  const handleCreateNewEntry = async () => {
    if (!currentUser) return;
    try {
      setEntryCreationError(null);
      const entryCount = entries.length + 1;
      const newEntry = await createJournalEntry(
        currentUser.uid,
        `Reflection #${entryCount}`
      );
      setActiveEntry(newEntry);
    } catch (err: any) {
      console.error("Failed to create new journal entry:", err);
      setEntryCreationError("Unable to create new entry. Please check your network connection.");
      setTimeout(() => setEntryCreationError(null), 4000);
    }
  };

  // Loading initial authentication state
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-[#FCFCFB] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center animate-pulse">
            <div className="w-1 h-4 bg-white rotate-45 rounded-full" />
          </div>
          <span className="text-xs uppercase tracking-widest text-[#999] font-medium font-sans">
            Opening Compass...
          </span>
        </div>
      </div>
    );
  }

  // USER FLOW 1: Landing page with a single "Sign in with Google" button. Nothing else.
  if (!currentUser) {
    return <LandingPage />;
  }

  // Active entry index calculation for UI label
  const activeEntryIndex = activeEntry
    ? entries.findIndex((e) => e.id === activeEntry.id) + 1 || 1
    : 1;

  // Active digest: from active entry if closed, or from latest entry that has digest
  const displayedDigest =
    activeEntry?.digest ||
    entries.find((e) => e.digest)?.digest ||
    null;

  return (
    <div className="flex flex-col min-h-screen min-[900px]:h-screen w-screen bg-[#FCFCFB] text-[#1A1A1A] font-sans overflow-x-hidden min-[900px]:overflow-hidden">
      {/* Top Header */}
      <Header
        user={currentUser}
        activeEntry={activeEntry}
        entryIndex={activeEntryIndex}
        onNewEntry={handleCreateNewEntry}
      />

      {entryCreationError && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2 text-xs font-medium text-rose-700 flex items-center justify-between z-20">
          <span>{entryCreationError}</span>
          <button
            onClick={() => setEntryCreationError(null)}
            className="text-rose-500 hover:text-rose-800 text-xs cursor-pointer ml-4 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Responsive Two-Column Dashboard (Conversation + Action Rail, stacked below 900px) */}
      <main className="rail-layout-container flex flex-1 w-full">
        {activeEntry ? (
          <JournalConversation
            userId={currentUser.uid}
            entry={activeEntry}
            turns={turns}
            onClosingStateChange={setIsClosingEntry}
            onDigestUpdated={(newDigest) => {
              setActiveEntry((prev) => (prev ? { ...prev, status: "closed", digest: newDigest } : null));
            }}
            onNewEntryRequested={handleCreateNewEntry}
          />
        ) : (
          <div className="rail-conversation-col flex items-center justify-center border-r border-[#EBEBEB] bg-[#FAF9F6]">
            <button
              onClick={handleCreateNewEntry}
              className="px-5 py-2.5 bg-black text-white rounded-xl text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              + Start a New Entry
            </button>
          </div>
        )}

        {/* Action Rail */}
        <ActionRail
          userId={currentUser.uid}
          activeEntry={activeEntry}
          digest={displayedDigest}
          actions={actions}
          entries={entries}
          isLoading={isClosingEntry}
          onSelectEntry={(entry) => setActiveEntry(entry)}
          onNewEntry={handleCreateNewEntry}
        />
      </main>
    </div>
  );
}

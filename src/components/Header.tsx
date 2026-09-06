import React from "react";
import { UserProfile, JournalEntry } from "../types";
import { logOut } from "../lib/firebase";

interface HeaderProps {
  user: UserProfile | null;
  activeEntry: JournalEntry | null;
  entryIndex?: number;
  onNewEntry?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activeEntry,
  entryIndex,
  onNewEntry,
}) => {
  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) {
      const parts = name.trim().split(" ");
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return "U";
  };

  return (
    <header className="flex items-center justify-between px-8 py-4 border-b flex-shrink-0 z-10 bg-[var(--surface)] border-[var(--border)]">
      {/* Brand */}
      <div className="flex items-center gap-3 cursor-pointer" onClick={onNewEntry}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--accent)]">
          <div className="w-1 h-4 rotate-45 rounded-full bg-[var(--text)]" />
        </div>
        <span className="text-xl font-medium tracking-tight italic font-user text-[var(--text)]">
          Compass
        </span>
      </div>

      {/* Entry info & user actions */}
      <div className="flex items-center gap-6">
        {activeEntry && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal truncate max-w-[17.5rem] font-ai text-[var(--text-muted)]">
              {entryIndex !== undefined ? `Entry #${entryIndex}: ` : ""}
              {activeEntry.title || "Untitled Entry"}
            </span>
            {activeEntry.status === "closed" && (
              <span
                className="text-[0.625rem] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full font-ai text-[var(--text)] bg-[var(--bg-sunk)] border border-[var(--border)]"
              >
                Closed
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || "User"}
              className="w-7 h-7 rounded-full object-cover border border-[var(--border)]"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[0.625rem] font-bold font-ai bg-[var(--bg-sunk)] text-[var(--text)]">
              {getInitials(user?.displayName, user?.email)}
            </div>
          )}

          <button
            id="signout-button"
            onClick={() => logOut()}
            className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer font-ai border border-[var(--border)] text-[var(--text)] bg-[var(--surface)] hover:bg-[var(--bg-sunk)]"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
};

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
    <header className="flex items-center justify-between px-8 py-4 border-b border-[#EBEBEB] bg-white flex-shrink-0 z-10">
      {/* Brand */}
      <div className="flex items-center gap-3 cursor-pointer" onClick={onNewEntry}>
        <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center flex-shrink-0">
          <div className="w-1 h-4 bg-white rotate-45 rounded-full" />
        </div>
        <span className="text-xl font-medium tracking-tight italic font-serif text-[#1A1A1A]">
          Compass
        </span>
      </div>

      {/* Entry info & user actions */}
      <div className="flex items-center gap-6">
        {activeEntry && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#707070] font-normal truncate max-w-[280px]">
              {entryIndex !== undefined ? `Entry #${entryIndex}: ` : ""}
              {activeEntry.title || "Untitled Entry"}
            </span>
            {activeEntry.status === "closed" && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full">
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
              className="w-7 h-7 rounded-full object-cover border border-[#EBEBEB]"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#E5E5E5] flex items-center justify-center text-[10px] font-bold text-[#444]">
              {getInitials(user?.displayName, user?.email)}
            </div>
          )}

          <button
            id="signout-button"
            onClick={() => logOut()}
            className="text-xs font-medium px-3 py-1.5 border border-[#EBEBEB] rounded-full hover:bg-gray-50 text-[#333] transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
};

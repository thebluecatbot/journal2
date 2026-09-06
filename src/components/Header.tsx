import React, { useState, useRef, useEffect } from "react";
import { UserProfile } from "../types";
import { logOut } from "../lib/firebase";
import { loadDemoContent, removeDemoContent } from "../lib/demoContent";
import { CompassMark } from "./CompassMark";

export type Space = "journal" | "history" | "insights" | "brainstorm";

interface HeaderProps {
  user: UserProfile | null;
  activeSpace: Space;
  onSelectSpace: (space: Space) => void;
  onNewEntry: () => void;
  userId: string;
}

const NAV: Array<{ id: Space; label: string }> = [
  { id: "journal", label: "Journal" },
  { id: "brainstorm", label: "Brainstorm" },
  { id: "insights", label: "Insights" },
  { id: "history", label: "History" },
];

/**
 * One line. Name on the left in the serif, everything else quiet and on the right.
 *
 * The brief called for the name and the avatar alone. The product has four places to
 * be, so the four names sit here as plain muted text rather than as a chrome nav bar:
 * a header with no route out of it would strand History and Insights.
 */
export const Header: React.FC<HeaderProps> = ({
  user,
  activeSpace,
  onSelectSpace,
  onNewEntry,
  userId,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  // The example content controls live here rather than in an empty state, because an
  // empty state disappears the moment you have any content of your own, which made
  // them unreachable exactly when you wanted to compare.
  const [demoBusy, setDemoBusy] = useState<"load" | "remove" | null>(null);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const initials = (() => {
    const name = user?.displayName?.trim();
    if (name) {
      const parts = name.split(/\s+/);
      return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
    }
    return (user?.email || "U").slice(0, 2).toUpperCase();
  })();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--s4)",
        padding: "var(--s3) var(--s5)",
        background: "var(--bg)",
        flexWrap: "wrap",
      }}
    >
      <button
        onClick={() => onSelectSpace("journal")}
        className="btn btn-quiet"
        style={{ padding: "var(--s1) var(--s2)", marginLeft: "calc(var(--s2) * -1)" }}
        aria-label="Compass home"
      >
        <CompassMark size={20} />
        <span
          style={{
            fontFamily: "var(--font-user)",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--text)",
            letterSpacing: "-0.01em",
          }}
        >
          Compass
        </span>
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--s1)", flexWrap: "wrap" }}>
        <nav style={{ display: "flex", alignItems: "center", gap: "var(--s1)" }}>
          {NAV.map((item) => {
            const active = activeSpace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectSpace(item.id)}
                className="btn btn-quiet"
                aria-current={active ? "page" : undefined}
                style={{
                  fontSize: 14,
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 400,
                  background: active ? "var(--bg-sunk)" : "transparent",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <button
          onClick={onNewEntry}
          className="btn btn-primary"
          style={{ fontSize: 14, padding: "var(--s2) var(--s4)", marginLeft: "var(--s2)" }}
        >
          New entry
        </button>

        <div style={{ position: "relative", marginLeft: "var(--s2)" }} ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account"
            aria-expanded={menuOpen}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "var(--bg-sunk)",
              cursor: "pointer",
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
              padding: 0,
            }}
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontFamily: "var(--font-ai)", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                {initials}
              </span>
            )}
          </button>

          {menuOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + var(--s2))",
                minWidth: "15rem",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow)",
                padding: "var(--s3)",
                zIndex: 50,
              }}
            >
              <p
                className="chrome"
                style={{ fontSize: 13, wordBreak: "break-all", marginBottom: "var(--s3)" }}
              >
                {user?.email || "Signed in"}
              </p>
              <p className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
                Example content
              </p>
              <p className="chrome" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: "var(--s3)" }}>
                Five worked entries and five brainstorms, so History and Insights have
                something to show. Nothing of yours is touched.
              </p>
              <div style={{ display: "flex", gap: "var(--s2)", marginBottom: "var(--s4)", flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 13, flex: 1, minWidth: "6rem" }}
                  disabled={demoBusy !== null}
                  onClick={async () => {
                    setDemoBusy("load");
                    setDemoNote(null);
                    try {
                      const r = await loadDemoContent(userId);
                      setDemoNote(`Wrote ${r.entries} entries and ${r.boards} brainstorms. Open History to see them.`);
                    } catch (err: any) {
                      // Surfaced, not swallowed. A silent failure here looks identical to
                      // nothing having happened, which is impossible to debug.
                      console.error("Could not load example content:", err);
                      setDemoNote(`Failed: ${err?.code || err?.message || "unknown error"}`);
                    }
                    setDemoBusy(null);
                  }}
                >
                  {demoBusy === "load" ? "Loading" : "Load"}
                </button>
                <button
                  className="btn btn-quiet"
                  style={{ fontSize: 13, flex: 1, minWidth: "6rem" }}
                  disabled={demoBusy !== null}
                  onClick={async () => {
                    setDemoBusy("remove");
                    setDemoNote(null);
                    try {
                      await removeDemoContent(userId);
                      setDemoNote("Example content removed.");
                    } catch (err: any) {
                      console.error("Could not remove example content:", err);
                      setDemoNote(`Failed: ${err?.code || err?.message || "unknown error"}`);
                    }
                    setDemoBusy(null);
                  }}
                >
                  {demoBusy === "remove" ? "Removing" : "Remove"}
                </button>
              </div>

              {demoNote && (
                <p
                  role="status"
                  style={{
                    fontFamily: "var(--font-ai)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    marginBottom: "var(--s4)",
                    color: demoNote.startsWith("Failed") ? "var(--danger)" : "var(--accent-ink)",
                  }}
                >
                  {demoNote}
                </p>
              )}

              <button
                id="signout-button"
                className="btn btn-secondary"
                style={{ width: "100%", fontSize: 14 }}
                onClick={() => logOut()}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

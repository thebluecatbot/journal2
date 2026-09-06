import React, { useEffect, useState } from "react";
import { BrainstormBoard } from "../types";
import {
  subscribeToBoards,
  createBoard,
  deleteBoard,
  withoutSeededFixtures,
  saveBoard,
} from "../lib/journalService";
import { loadDemoContent } from "../lib/demoContent";

interface BrainstormBoardsProps {
  userId: string;
  onOpenBoard: (boardId: string) => void;
}

/**
 * Your brainstorms, as cards.
 *
 * `/users/{uid}/boards` was always a collection, but the canvas only ever loaded
 * boards[0], so a second brainstorm was unreachable. This is the list that was missing.
 */
export const BrainstormBoards: React.FC<BrainstormBoardsProps> = ({ userId, onOpenBoard }) => {
  const [boards, setBoards] = useState<BrainstormBoard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToBoards(userId, async (fetched) => {
      // Strip the seven fixture cards that used to be seeded into every board. Only
      // those exact texts go; anything written here is left alone.
      for (const board of fetched) {
        const cleaned = withoutSeededFixtures(board);
        if (cleaned) {
          try {
            await saveBoard(userId, cleaned);
          } catch (err) {
            console.warn("Could not clear seeded cards from board:", err);
          }
        }
      }
      setBoards(fetched);
    });
  }, [userId]);

  const handleCreate = async () => {
    const name = title.trim();
    if (!name) return;
    try {
      setError(null);
      const board = await createBoard(userId, name);
      setTitle("");
      setCreating(false);
      onOpenBoard(board.id);
    } catch (err) {
      console.error("Could not create brainstorm:", err);
      setError("That brainstorm could not be created. Check your connection and try again.");
    }
  };

  const handleDelete = async (board: BrainstormBoard) => {
    if (!window.confirm(`Delete "${board.title}" and everything on it? This cannot be undone.`)) return;
    try {
      await deleteBoard(userId, board.id);
    } catch (err) {
      console.error("Could not delete brainstorm:", err);
      setError("That brainstorm could not be deleted. Try again.");
    }
  };

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: "52rem", margin: "0 auto", padding: "var(--s8) var(--s5)" }}>
        <h1 style={{ fontFamily: "var(--font-user)", fontSize: 30, fontWeight: 500, color: "var(--text)" }}>
          Brainstorm
        </h1>
        <p
          className="chrome"
          style={{ marginTop: "var(--s2)", marginBottom: "var(--s7)", maxWidth: "54ch", lineHeight: 1.6 }}
        >
          Dump everything you are holding about one thing, then let it be grouped and pressure
          tested. Keep separate subjects on separate boards.
        </p>

        {error && (
          <p role="alert" style={{ fontFamily: "var(--font-ai)", fontSize: 14, color: "var(--danger)", marginBottom: "var(--s4)" }}>
            {error}
          </p>
        )}

        {boards === null && <p className="chrome">Loading your brainstorms</p>}

        {boards !== null && boards.length === 0 && (
          <div
            style={{
              background: "var(--bg-sunk)",
              borderRadius: "var(--radius)",
              padding: "var(--s4)",
              marginBottom: "var(--s5)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "var(--s4)",
              flexWrap: "wrap",
            }}
          >
            <span className="chrome" style={{ lineHeight: 1.6, maxWidth: "46ch" }}>
              Nothing here yet. You can start your own, or load a set of worked examples to see
              what a filled in Compass looks like.
            </span>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 14 }}
              disabled={loadingDemo}
              onClick={async () => {
                setLoadingDemo(true);
                setError(null);
                try {
                  await loadDemoContent(userId);
                } catch (err) {
                  console.error("Could not load example content:", err);
                  setError("The examples could not be loaded. Check your connection and try again.");
                }
                setLoadingDemo(false);
              }}
            >
              {loadingDemo ? "Loading" : "Load example content"}
            </button>
          </div>
        )}

        {boards !== null && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))",
              gap: "var(--s4)",
            }}
          >
            {boards.map((board) => {
              const count = (board.cards || []).length;
              const clusters = (board.clusters || []).length;
              return (
                <div
                  key={board.id}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    padding: "var(--s4)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "9rem",
                  }}
                >
                  <button
                    onClick={() => onOpenBoard(board.id)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-user)",
                        fontSize: 20,
                        lineHeight: 1.3,
                        color: "var(--text)",
                      }}
                    >
                      {board.title}
                    </span>
                    <span className="chrome" style={{ display: "block", fontSize: 13, marginTop: "var(--s2)" }}>
                      {count === 0 ? "Empty" : count === 1 ? "1 card" : `${count} cards`}
                      {clusters > 0 ? ` · ${clusters} groups` : ""}
                    </span>
                  </button>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--s4)" }}>
                    <span className="chrome" style={{ fontSize: 13 }}>
                      {new Date(board.updatedAt || board.createdAt || Date.now()).toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <button
                      className="btn btn-quiet"
                      style={{ fontSize: 13, minHeight: 0, padding: "var(--s1) var(--s2)" }}
                      onClick={() => handleDelete(board)}
                      aria-label={`Delete ${board.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}

            {/* The new-brainstorm tile sits in the grid with the rest. */}
            <div
              style={{
                border: "1px dashed var(--border)",
                borderRadius: "var(--radius)",
                padding: "var(--s4)",
                minHeight: "9rem",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: "var(--s3)",
              }}
            >
              {creating ? (
                <>
                  <label htmlFor="new-board-title" className="eyebrow">
                    What is this about?
                  </label>
                  <input
                    id="new-board-title"
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") {
                        setCreating(false);
                        setTitle("");
                      }
                    }}
                    placeholder="Pricing rethink"
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-user)",
                      fontSize: 17,
                      padding: "var(--s2) var(--s3)",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text)",
                      outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: "var(--s2)" }}>
                    <button className="btn btn-primary" style={{ fontSize: 14 }} onClick={handleCreate} disabled={!title.trim()}>
                      Create
                    </button>
                    <button
                      className="btn btn-quiet"
                      style={{ fontSize: 14 }}
                      onClick={() => {
                        setCreating(false);
                        setTitle("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-ai)",
                    fontSize: 15,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--s2)",
                    padding: "var(--s4)",
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1, color: "var(--accent-ink)" }}>
                    +
                  </span>
                  <span>New brainstorm</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

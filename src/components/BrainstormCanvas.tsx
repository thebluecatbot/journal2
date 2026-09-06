import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Plus,
  RotateCcw,
  AlertCircle,
  X,
  Layers,
  Move,
  Trash2,
  Check,
  Info,
  HelpCircle,
  Compass,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import {
  BrainstormBoard,
  CanvasCard,
  StructureCluster,
  StructureResult,
  GapUnexploredItem,
} from "../types";
import { structureBoardApi, fetchBoardGapsApi } from "../lib/api";
import { saveBoard, subscribeToBoards } from "../lib/journalService";
import { IdeaDump } from "./IdeaDump";

interface BrainstormCanvasProps {
  userId: string;
  /** The board to open. The canvas never picks one for you. */
  boardId: string;
  onBack: () => void;
}

const CARD_WIDTH = 260;
const CARD_EST_HEIGHT = 110;
const CARD_GAP = 16;
const CLUSTER_PAD_X = 20;
const CLUSTER_PAD_TOP = 64;
const CLUSTER_PAD_BOTTOM = 20;
const CLUSTER_WIDTH = CLUSTER_PAD_X * 2 + CARD_WIDTH * 2 + CARD_GAP; // ~576px

export const BrainstormCanvas: React.FC<BrainstormCanvasProps> = ({ userId, boardId, onBack }) => {
  const [board, setBoard] = useState<BrainstormBoard | null>(null);
  const [isStructuring, setIsStructuring] = useState(false);
  const [isFindingGaps, setIsFindingGaps] = useState(false);
  const [gaps, setGaps] = useState<GapUnexploredItem[]>([]);
  const [isGapsPanelOpen, setIsGapsPanelOpen] = useState(false);
  const [highlightedAnchors, setHighlightedAnchors] = useState<string[]>([]);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineSuccess, setInlineSuccess] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isAddingCard, setIsAddingCard] = useState(false);

  // Canvas viewport panning
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Drag tracking for cards
  const dragStartPosRef = useRef<{ [cardId: string]: { x: number; y: number } }>({});

  // 1. Subscribe to or initialize user's board
  useEffect(() => {
    let isMounted = true;
    // Load the board that was opened, and only that one. This used to take boards[0]
    // unconditionally, which is why a second brainstorm was unreachable.
    const unsubscribe = subscribeToBoards(userId, (boards) => {
      if (!isMounted) return;
      const found = boards.find((b) => b.id === boardId);
      if (found) setBoard(found);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [userId, boardId]);

  // Persist board updates to Firestore
  const updateBoard = (updater: (prev: BrainstormBoard) => BrainstormBoard) => {
    setBoard((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      saveBoard(userId, next);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Action: "Structure this"
  // ---------------------------------------------------------------------------
  const handleStructureThis = async () => {
    if (!board || isStructuring) return;
    if (board.cards.length === 0) {
      setInlineError("The board has no cards to structure yet. Add some thoughts first.");
      return;
    }

    setIsStructuring(true);
    setInlineError(null);
    setInlineSuccess(null);

    // Snapshot current state in case of failure
    // RULE: "If the call fails, the board is untouched and an inline message appears. Never lose or move cards on failure."
    const cardsSnapshot = board.cards.map((c) => ({ ...c }));
    const clustersSnapshot = board.clusters?.map((cl) => ({ ...cl, card_ids: [...cl.card_ids] })) || [];

    try {
      // Call backend POST /api/boards/:id/structure
      const result: StructureResult = await structureBoardApi(board.id, board.cards);

      if (!result || !Array.isArray(result.clusters)) {
        throw new Error("Invalid structure response received from facilitator.");
      }

      // Compute spatial arrangements for each cluster
      // Place clusters in columns with ample whitespace
      const numClusters = result.clusters.length;
      const orphans = result.orphans || [];
      const hasOrphans = orphans.length > 0;

      const clusterBoxes: Array<{
        name: string;
        rationale?: string;
        cardIds: string[];
        x: number;
        y: number;
        width: number;
        height: number;
        isOrphan?: boolean;
      }> = [];

      const colWidth = CLUSTER_WIDTH + 48;
      const startX = 60;
      const startY = 60;
      const maxCols = numClusters >= 4 ? 2 : Math.max(1, Math.min(numClusters, 2));

      // Track column heights
      const colHeights = new Array(maxCols).fill(startY);

      // 1. Position normal clusters
      result.clusters.forEach((cluster) => {
        // Pick column with smallest height
        let bestCol = 0;
        for (let c = 1; c < maxCols; c++) {
          if (colHeights[c] < colHeights[bestCol]) {
            bestCol = c;
          }
        }

        const count = cluster.card_ids.length;
        const rows = Math.max(1, Math.ceil(count / 2));
        const clusterHeight =
          CLUSTER_PAD_TOP + rows * CARD_EST_HEIGHT + (rows - 1) * CARD_GAP + CLUSTER_PAD_BOTTOM;

        const clusterX = startX + bestCol * colWidth;
        const clusterY = colHeights[bestCol];

        clusterBoxes.push({
          name: cluster.name,
          rationale: cluster.rationale,
          cardIds: cluster.card_ids,
          x: clusterX,
          y: clusterY,
          width: count === 1 ? CARD_WIDTH + CLUSTER_PAD_X * 2 : CLUSTER_WIDTH,
          height: clusterHeight,
        });

        colHeights[bestCol] += clusterHeight + 40;
      });

      // 2. Position orphans cluster if any cards fit nowhere
      if (hasOrphans) {
        let bestCol = 0;
        for (let c = 1; c < maxCols; c++) {
          if (colHeights[c] < colHeights[bestCol]) {
            bestCol = c;
          }
        }

        const count = orphans.length;
        const rows = Math.max(1, Math.ceil(count / 2));
        const clusterHeight =
          CLUSTER_PAD_TOP + rows * CARD_EST_HEIGHT + (rows - 1) * CARD_GAP + CLUSTER_PAD_BOTTOM;

        const clusterX = startX + bestCol * colWidth;
        const clusterY = colHeights[bestCol];

        clusterBoxes.push({
          name: "Unclustered / Solo Thoughts",
          rationale: "Cards that fit nowhere in the current groups. Kept distinct.",
          cardIds: orphans,
          x: clusterX,
          y: clusterY,
          width: count === 1 ? CARD_WIDTH + CLUSTER_PAD_X * 2 : CLUSTER_WIDTH,
          height: clusterHeight,
          isOrphan: true,
        });
      }

      // Map new coordinates to cards
      // RULES:
      // - Reference ONLY card ids that were supplied. Never invent one.
      // - Do not rewrite, improve or edit the user's card text. Grouping only.
      // The words on the cards stay exactly as the human wrote them.
      const updatedCardMap = new Map<string, CanvasCard>();
      board.cards.forEach((c) => updatedCardMap.set(c.id, { ...c }));

      clusterBoxes.forEach((box) => {
        box.cardIds.forEach((cid, index) => {
          const card = updatedCardMap.get(cid);
          if (!card) return;

          const col = index % 2;
          const row = Math.floor(index / 2);

          const cardX = box.x + CLUSTER_PAD_X + col * (CARD_WIDTH + CARD_GAP);
          const cardY = box.y + CLUSTER_PAD_TOP + row * (CARD_EST_HEIGHT + CARD_GAP);

          updatedCardMap.set(cid, {
            ...card,
            x: cardX,
            y: cardY,
            clusterId: box.name,
            updatedAt: new Date().toISOString(),
          });
        });
      });

      const updatedCards = Array.from(updatedCardMap.values());

      updateBoard((prev) => ({
        ...prev,
        cards: updatedCards,
        clusters: result.clusters,
        orphans: result.orphans || [],
      }));

      const clusterCountText =
        result.clusters.length === 1
          ? "1 group"
          : `${result.clusters.length} thematic clusters`;
      setInlineSuccess(
        `Structured into ${clusterCountText}${
          hasOrphans ? ` with ${orphans.length} unclustered` : ""
        }. You can drag any card to adjust.`
      );
      setTimeout(() => setInlineSuccess(null), 6000);
    } catch (err: any) {
      console.error("[Structure This Error]", err);
      // CRITICAL RULE: "If the call fails, the board is untouched and an inline message appears. Never lose or move cards on failure."
      updateBoard((prev) => ({
        ...prev,
        cards: cardsSnapshot,
        clusters: clustersSnapshot,
      }));
      setInlineError(
        err?.message ||
          "Could not structure the board right now. Your cards remain exactly untouched."
      );
    } finally {
      setIsStructuring(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Action: "What am I missing?" (SCAMPER Framework)
  // ---------------------------------------------------------------------------
  const handleFindGaps = async () => {
    if (!board || isFindingGaps) return;
    if (board.cards.length === 0) {
      setInlineError("The board has no cards yet. Add a few thoughts first to analyze gaps.");
      return;
    }

    setIsFindingGaps(true);
    setInlineError(null);
    setInlineSuccess(null);

    try {
      const result = await fetchBoardGapsApi(board.id, board.cards);
      if (!result || !Array.isArray(result.unexplored)) {
        throw new Error("Invalid SCAMPER response received from facilitator.");
      }

      setGaps(result.unexplored);
      setIsGapsPanelOpen(true);
      setInlineSuccess(
        `Identified ${result.unexplored.length} unexplored angle${
          result.unexplored.length === 1 ? "" : "s"
        } using the SCAMPER framework.`
      );
      setTimeout(() => setInlineSuccess(null), 5000);
    } catch (err: any) {
      console.error("[SCAMPER Gaps Error]", err);
      setInlineError(
        err?.message || "Could not analyze gaps right now. Your board remains untouched."
      );
    } finally {
      setIsFindingGaps(false);
    }
  };

  const handleDismissGap = (indexToDismiss: number) => {
    setGaps((prev) => prev.filter((_, idx) => idx !== indexToDismiss));
  };

  // RULE: "Clicking one creates an empty card on the canvas with that question as a label,
  // waiting for the human to fill it in."
  const handleActOnGapCard = (gap: GapUnexploredItem, index: number) => {
    if (!board) return;

    // Determine smart placement:
    // If the gap has anchor cards, place nearby the first anchor card
    let targetX = 140;
    let targetY = 160;

    if (gap.anchor_card_ids && gap.anchor_card_ids.length > 0) {
      const anchorCard = board.cards.find((c) => gap.anchor_card_ids!.includes(c.id));
      if (anchorCard) {
        targetX = anchorCard.x + CARD_WIDTH + 32;
        targetY = anchorCard.y + (Math.random() * 40 - 20);
      }
    } else {
      // Find an open spot
      const maxX = board.cards.reduce((max, c) => Math.max(max, c.x), 100);
      const maxY = board.cards.reduce((max, c) => Math.max(max, c.y), 100);
      targetX = Math.min(maxX + 48, 1100);
      targetY = Math.min(maxY + 48, 800);
    }

    const newId = `card_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const newCard: CanvasCard = {
      id: newId,
      text: "", // Empty: waiting for the human to fill it in
      questionLabel: gap.question,
      lens: gap.lens,
      x: Math.round(targetX),
      y: Math.round(targetY),
      createdAt: new Date().toISOString(),
    };

    updateBoard((prev) => ({
      ...prev,
      cards: [...prev.cards, newCard],
    }));

    // Remove this gap from the side panel once acted upon
    handleDismissGap(index);

    // Immediately focus editing on the empty card so the user can begin writing
    setEditingCardId(newId);
    setActiveCardId(newId);

    setInlineSuccess(`Added empty [${gap.lens}] card to canvas. Write your thoughts!`);
    setTimeout(() => setInlineSuccess(null), 4000);
  };

  // ---------------------------------------------------------------------------
  // Card Movement & Dragging
  // RULE: "The user can drag a card out of a cluster and it stays out.
  // The human always has final say over the arrangement."
  // ---------------------------------------------------------------------------
  const handleCardDragEnd = (cardId: string, newX: number, newY: number) => {
    updateBoard((prev) => {
      const nextCards = prev.cards.map((c) => {
        if (c.id !== cardId) return c;
        return {
          ...c,
          x: Math.round(newX),
          y: Math.round(newY),
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...prev,
        cards: nextCards,
      };
    });
  };

  /**
   * Add every line of a dump as its own card, on a grid so nothing lands on top of
   * anything else. Placement is not the point at this stage; getting it out is.
   */
  const handleAddIdeas = (ideas: string[]) => {
    if (!board || ideas.length === 0) return;

    const existing = board.cards.length;
    const perRow = 4;
    const created: CanvasCard[] = ideas.map((text, i) => {
      const n = existing + i;
      return {
        id: `card_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
        text,
        x: 60 + (n % perRow) * (CARD_WIDTH + 40),
        y: 80 + Math.floor(n / perRow) * 180,
        createdAt: new Date().toISOString(),
      };
    });

    updateBoard((prev) => ({ ...prev, cards: [...prev.cards, ...created] }));
    setIsAddingCard(false);
    setInlineSuccess(created.length === 1 ? "Card added." : `${created.length} cards added.`);
    setTimeout(() => setInlineSuccess(null), 2500);
  };

  // Update card text
  const handleUpdateCardText = (cardId: string, text: string) => {
    updateBoard((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => (c.id === cardId ? { ...c, text, updatedAt: new Date().toISOString() } : c)),
    }));
  };

  // Delete card
  const handleDeleteCard = (cardId: string) => {
    updateBoard((prev) => ({
      ...prev,
      cards: prev.cards.filter((c) => c.id !== cardId),
      clusters: prev.clusters?.map((cl) => ({
        ...cl,
        card_ids: cl.card_ids.filter((id) => id !== cardId),
      })),
      orphans: prev.orphans?.filter((id) => id !== cardId),
    }));
  };

  // Clear the board. There is no sample set to restore it to any more.
  const handleClearBoard = () => {
    if (!window.confirm("Remove every card from this board? This cannot be undone.")) return;
    updateBoard((prev) => ({ ...prev, cards: [], clusters: [], orphans: [], gaps: [] }));
    setGaps([]);
    setInlineError(null);
    setInlineSuccess("Board cleared.");
    setTimeout(() => setInlineSuccess(null), 3000);
  };

  // Calculate dynamic boundaries for clusters based on current card positions
  const clusterBoundaries = useMemo(() => {
    if (!board || !board.clusters || board.clusters.length === 0) return [];

    const boundaries: Array<{
      name: string;
      rationale?: string;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      cardCount: number;
      isOrphan?: boolean;
    }> = [];

    // Group cards by clusterId or cluster definition
    board.clusters.forEach((cluster) => {
      const clusterCards = board.cards.filter((c) => cluster.card_ids.includes(c.id));
      if (clusterCards.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      clusterCards.forEach((c) => {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x + CARD_WIDTH);
        maxY = Math.max(maxY, c.y + CARD_EST_HEIGHT);
      });

      const pad = 16;
      boundaries.push({
        name: cluster.name,
        rationale: cluster.rationale,
        minX: minX - pad,
        minY: minY - 40 - pad, // extra room for cluster title
        maxX: maxX + pad,
        maxY: maxY + pad,
        cardCount: clusterCards.length,
      });
    });

    // Orphans boundary if any cards are marked as orphans
    if (board.orphans && board.orphans.length > 0) {
      const orphanCards = board.cards.filter((c) => board.orphans!.includes(c.id));
      if (orphanCards.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        orphanCards.forEach((c) => {
          minX = Math.min(minX, c.x);
          minY = Math.min(minY, c.y);
          maxX = Math.max(maxX, c.x + CARD_WIDTH);
          maxY = Math.max(maxY, c.y + CARD_EST_HEIGHT);
        });

        const pad = 16;
        boundaries.push({
          name: "Solo / Unclustered",
          rationale: "Cards that fit nowhere in the current structure.",
          minX: minX - pad,
          minY: minY - 40 - pad,
          maxX: maxX + pad,
          maxY: maxY + pad,
          cardCount: orphanCards.length,
          isOrphan: true,
        });
      }
    }

    return boundaries;
  }, [board]);

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center animate-spin border-2 border-t-transparent border-[var(--accent-ink)]" />
          <p className="text-xs text-[var(--text-muted)] font-ai">Opening Brainstorm Canvas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col w-full h-[calc(100vh-61px)] overflow-hidden bg-[var(--bg)] select-none">
      {/* Top Canvas Toolbar */}
      <div className="z-20 flex flex-wrap items-center justify-between px-6 py-3 border-b bg-[var(--surface)] border-[var(--border)] gap-4">
        {/* Board Title & Card Counter */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn btn-quiet"
            style={{ fontSize: 14, minHeight: 0, padding: "var(--s2) var(--s3)" }}
            aria-label="Back to all brainstorms"
          >
            All brainstorms
          </button>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--bg-sunk)] border border-[var(--border)] text-[var(--accent-ink)]">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[var(--text)] font-ai flex items-center gap-2">
              {board.title}
            </h2>
            <p className="text-[0.6875rem] text-[var(--text-muted)] font-ai">
              {board.cards.length} {board.cards.length === 1 ? "card" : "cards"}
              {board.clusters && board.clusters.length > 0 && (
                <span> · {board.clusters.length} clusters</span>
              )}
            </p>
          </div>
        </div>

        {/* Primary Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Add Card Button */}
          <button
            onClick={() => setIsAddingCard(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium font-ai transition-colors border bg-[var(--bg-sunk)] border-[var(--border)] text-[var(--text)] hover:border-[var(--text-muted)] cursor-pointer"
            title="Add a new thought card to the canvas"
          >
            <Plus className="w-3.5 h-3.5 text-[var(--accent-ink)]" />
            <span>Add Card</span>
          </button>

          {/* Reset Cards */}
          <button
            onClick={handleClearBoard}
            className="p-1.5 rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-sunk)] transition-colors cursor-pointer border border-transparent hover:border-[var(--border)]"
            title="Clear every card from this board"
            aria-label="Clear board"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Core Feature Action: "What am I missing?" (SCAMPER) */}
          <button
            onClick={handleFindGaps}
            disabled={isFindingGaps || board.cards.length === 0}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold font-ai transition-all shadow-xs cursor-pointer border ${
              isFindingGaps
                ? "opacity-60 cursor-not-allowed bg-[var(--bg-sunk)] border-[var(--border)] text-[var(--text)]"
                : "bg-[var(--surface)] hover:bg-[var(--bg-sunk)] border-[var(--border)] text-[var(--text)] hover:border-[var(--accent-ink)]"
            }`}
            title="SCAMPER analysis: identify unexplored angles and blind spots without providing unsolicited ideas"
          >
            {isFindingGaps ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--text)] border-t-transparent animate-spin" />
                <span>Analyzing gaps...</span>
              </>
            ) : (
              <>
                <Compass className="w-3.5 h-3.5 text-[var(--accent-ink)]" />
                <span>What am I missing?</span>
              </>
            )}
          </button>

          {/* Toggle SCAMPER Blind Spots Side Panel if gaps exist */}
          {gaps.length > 0 && (
            <button
              onClick={() => setIsGapsPanelOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium font-ai transition-colors cursor-pointer border ${
                isGapsPanelOpen
                  ? "bg-[var(--accent)] text-[var(--text)] border-[var(--accent)]"
                  : "bg-[var(--bg-sunk)] text-[var(--text)] border-[var(--border)] hover:border-[var(--text-muted)]"
              }`}
              title="Toggle SCAMPER blind spots panel"
            >
              <span>Angles</span>
              <span className="w-4 h-4 rounded-full bg-[var(--surface)] text-[0.625rem] flex items-center justify-center font-mono font-bold text-[var(--text)] border border-[var(--border)]">
                {gaps.length}
              </span>
            </button>
          )}

          {/* Core Feature Action: "Structure this" */}
          <button
            onClick={handleStructureThis}
            disabled={isStructuring || board.cards.length === 0}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold font-ai transition-all shadow-xs cursor-pointer ${
              isStructuring
                ? "opacity-60 cursor-not-allowed bg-[var(--accent)] text-[var(--text)]"
                : "bg-[var(--accent)] text-[var(--text)] hover:brightness-95 hover:shadow-sm"
            }`}
            title="Automatically cluster cards into spatial thematic groups"
          >
            {isStructuring ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--text)] border-t-transparent animate-spin" />
                <span>Structuring cards...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent-ink)]" />
                <span>Structure this</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inline Feedback Banner (Non-destructive: NEVER lose or move cards on failure) */}
      <AnimatePresence>
        {inlineError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="z-30 px-6 py-2.5 text-xs font-medium font-ai flex items-center justify-between border-b shadow-xs"
            style={{
              backgroundColor: "color-mix(in srgb, var(--danger) 8%, var(--surface))",
              borderColor: "color-mix(in srgb, var(--danger) 30%, var(--border))",
              color: "var(--danger)",
            }}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{inlineError}</span>
            </div>
            <button
              onClick={() => setInlineError(null)}
              className="p-1 rounded hover:bg-black/5 cursor-pointer ml-4 font-bold"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {inlineSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="z-30 px-6 py-2.5 text-xs font-medium font-ai flex items-center justify-between border-b bg-[var(--surface)] text-[var(--text)] border-[var(--border)] shadow-xs"
          >
            <div className="flex items-center gap-2 text-[var(--text)]">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{inlineSuccess}</span>
            </div>
            <button
              onClick={() => setInlineSuccess(null)}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer ml-4"
              aria-label="Dismiss message"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dump surface. Replaces a floating popup that covered the board and took one
          card at a time. Centred, so nothing important sits underneath it. */}
      {isAddingCard && board && (
        <div
          className="z-30 absolute inset-0 flex items-start justify-center pt-12 px-6 overflow-y-auto"
          style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}
        >
          <IdeaDump
            firstDump={board.cards.length === 0}
            onCancel={() => setIsAddingCard(false)}
            onAdd={handleAddIdeas}
          />
        </div>
      )}

      {/* The 2D Interactive Canvas Workspace */}
      <div
        ref={canvasRef}
        className="relative flex-1 w-full h-full overflow-auto bg-[var(--bg)] cursor-grab active:cursor-grabbing p-10"
        style={{
          backgroundImage:
            "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {board.cards.length === 0 && !isAddingCard && (
          <div className="absolute inset-0 flex items-start justify-center pt-20 px-6 pointer-events-none">
            <div className="pointer-events-auto max-w-[46ch]">
              <p className="eyebrow mb-3">Brain dump</p>
              <h2
                className="font-user mb-4"
                style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.3, color: "var(--text)" }}
              >
                Get everything out first.
              </h2>
              <p className="font-ai mb-6" style={{ fontSize: 15, lineHeight: 1.7, color: "var(--text-muted)" }}>
                One idea per line, typed or spoken. No order and no editing. Once it is all
                down, Structure this groups it into themes, and What am I missing runs the
                seven SCAMPER lenses over it to surface the angles you skipped.
              </p>
              <button className="btn btn-primary" style={{ fontSize: 14 }} onClick={() => setIsAddingCard(true)}>
                Start dumping
              </button>
            </div>
          </div>
        )}

        <div className="relative min-w-[1400px] min-h-[900px] pb-32">
          {/* Labelled Cluster Boundaries */}
          {clusterBoundaries.map((b, idx) => (
            <motion.div
              key={`boundary_${b.name}_${idx}`}
              layout
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              className={`absolute rounded-3xl pointer-events-none transition-all ${
                b.isOrphan
                  ? "border border-dashed border-[var(--border)] bg-[var(--bg-sunk)]/30"
                  : "border border-[var(--border)] bg-[var(--bg-sunk)]/40 shadow-2xs"
              }`}
              style={{
                left: b.minX,
                top: b.minY,
                width: Math.max(b.maxX - b.minX, CARD_WIDTH + 40),
                height: Math.max(b.maxY - b.minY, CARD_EST_HEIGHT + 60),
              }}
            >
              {/* Cluster Header Label */}
              <div className="absolute -top-3.5 left-5 px-3 py-0.5 rounded-full border bg-[var(--surface)] border-[var(--border)] shadow-2xs flex items-center gap-2">
                <span className="text-[0.6875rem] font-semibold tracking-tight text-[var(--text)] font-ai">
                  {b.name}
                </span>
                <span className="text-[0.625rem] px-1.5 py-0.2 rounded-full bg-[var(--bg-sunk)] text-[var(--text-muted)] font-mono">
                  {b.cardCount}
                </span>
              </div>

              {/* Cluster Rationale Tooltip / Subtext */}
              {b.rationale && (
                <div className="absolute top-3 left-5 right-5 text-[0.6875rem] text-[var(--text-muted)] italic font-ai truncate opacity-75">
                  {b.rationale}
                </div>
              )}
            </motion.div>
          ))}

          {/* Cards with motion layout animations and drag handlers */}
          {board.cards.map((card) => {
            const isEditing = editingCardId === card.id;

            return (
              <motion.div
                key={card.id}
                layout
                drag
                dragMomentum={false}
                onDragStart={() => {
                  dragStartPosRef.current[card.id] = { x: card.x, y: card.y };
                }}
                onDragEnd={(_, info) => {
                  const newX = card.x + info.offset.x;
                  const newY = card.y + info.offset.y;
                  handleCardDragEnd(card.id, newX, newY);
                }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  x: card.x,
                  y: card.y,
                }}
                transition={{
                  type: "spring",
                  stiffness: 280,
                  damping: 24,
                  layout: { duration: 0.4 },
                }}
                className={`absolute w-[260px] p-4 rounded-2xl border shadow-xs transition-all cursor-grab active:cursor-grabbing select-none group bg-[var(--surface)] border-[var(--border)] hover:border-[var(--text-muted)]/50 hover:shadow-md ${
                  activeCardId === card.id ? "ring-2 ring-[var(--accent-ink)]" : ""
                } ${
                  highlightedAnchors.includes(card.id)
                    ? "ring-2 ring-[var(--accent-ink)] ring-offset-2 ring-offset-[var(--bg)] shadow-md border-[var(--accent-ink)]"
                    : ""
                }`}
                style={{
                  top: 0,
                  left: 0,
                }}
                onClick={() => setActiveCardId(card.id)}
              >
                {/* Card Top Action Ribbon */}
                <div className="flex items-center justify-between mb-2 text-[0.6875rem] text-[var(--text-muted)]">
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Move className="w-3 h-3 text-[var(--text-muted)]" />
                    {/* Deliberately no label. This printed the raw internal cluster id
                        sliced at 16 characters, putting strings like "Interface & Syst"
                        on every card. The cluster is already named on the group. */}
                    <span className="sr-only">Drag to move</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCard(card.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--bg-sunk)] text-[var(--danger)] transition-opacity cursor-pointer"
                    title="Delete card"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {/* SCAMPER Prompt Question Label (if created from a gap question) */}
                {card.questionLabel && (
                  <div className="mb-2.5 p-2.5 rounded-xl bg-[var(--bg-sunk)] border border-[var(--border)] select-none">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--accent-ink)] border border-[var(--border)] font-mono">
                        {card.lens ? `${card.lens}` : "SCAMPER"}
                      </span>
                    </div>
                    <p className="text-[0.6875rem] italic font-ai text-[var(--text)] font-medium leading-snug">
                      "{card.questionLabel}"
                    </p>
                  </div>
                )}

                {/* Card Text: Human Words in font-user */}
                {/* RULE: "Do not rewrite, improve or edit the user's card text. Grouping only.
                    The words on the cards stay exactly as the human wrote them." */}
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={card.text}
                    onChange={(e) => handleUpdateCardText(card.id, e.target.value)}
                    onBlur={() => setEditingCardId(null)}
                    placeholder="Write your thoughts in response..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        setEditingCardId(null);
                      }
                    }}
                    className="w-full text-xs font-user leading-relaxed p-1.5 rounded-lg border border-[var(--accent-ink)] bg-[var(--bg-sunk)] text-[var(--text)] focus:outline-none resize-none"
                    rows={3}
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingCardId(card.id);
                    }}
                    className={`text-xs leading-relaxed font-user cursor-text select-text ${
                      card.text.trim()
                        ? "text-[var(--text)]"
                        : "text-[var(--text-muted)] italic"
                    }`}
                    title="Double click to edit words"
                  >
                    {card.text.trim() || "Click to write your thoughts here..."}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Side Panel: "What am I missing?" (SCAMPER Framework) */}
      <AnimatePresence>
        {isGapsPanelOpen && (
          <motion.aside
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-[380px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl z-30 flex flex-col overflow-hidden"
          >
            {/* Panel Header */}
            <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-sunk)]/50 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Compass className="w-4 h-4 text-[var(--accent-ink)]" />
                  <h3 className="text-sm font-semibold tracking-tight text-[var(--text)] font-ai">
                    What am I missing?
                  </h3>
                  <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full font-mono bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]">
                    SCAMPER
                  </span>
                </div>
                <p className="text-[0.6875rem] text-[var(--text-muted)] font-ai leading-relaxed">
                  Unexplored angles to challenge your assumptions. Click any card to create an empty prompt waiting for your thoughts.
                </p>
              </div>
              <button
                onClick={() => setIsGapsPanelOpen(false)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] cursor-pointer transition-colors"
                title="Close panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel Body: Dismissible Cards */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {gaps.length === 0 ? (
                <div className="py-12 px-4 text-center">
                  <div className="w-10 h-10 rounded-2xl mx-auto mb-3 flex items-center justify-center bg-[var(--bg-sunk)] border border-[var(--border)] text-[var(--text-muted)]">
                    <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h4 className="text-xs font-semibold text-[var(--text)] font-ai mb-1">
                    All angles reviewed
                  </h4>
                  <p className="text-[0.6875rem] text-[var(--text-muted)] font-ai leading-relaxed mb-4">
                    You've acted on or dismissed all suggested SCAMPER angles.
                  </p>
                  <button
                    onClick={handleFindGaps}
                    disabled={isFindingGaps}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[var(--accent)] text-[var(--text)] hover:brightness-95 cursor-pointer font-ai shadow-xs"
                  >
                    <Compass className="w-3.5 h-3.5 text-[var(--accent-ink)]" />
                    <span>Run fresh analysis</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[0.6875rem] text-[var(--text-muted)] font-ai px-1">
                    <span>
                      {gaps.length} unexplored angle{gaps.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-[0.625rem] text-[var(--text-muted)] italic">
                      Click to place on canvas
                    </span>
                  </div>

                  {gaps.map((gap, idx) => {
                    const anchorCards = board.cards.filter((c) =>
                      gap.anchor_card_ids?.includes(c.id)
                    );

                    return (
                      <motion.div
                        key={`gap_${gap.lens}_${idx}`}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        onMouseEnter={() => {
                          if (gap.anchor_card_ids && gap.anchor_card_ids.length > 0) {
                            setHighlightedAnchors(gap.anchor_card_ids);
                          }
                        }}
                        onMouseLeave={() => setHighlightedAnchors([])}
                        className="group relative p-4 rounded-2xl border bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent-ink)] hover:shadow-md transition-all cursor-pointer"
                        onClick={() => handleActOnGapCard(gap, idx)}
                      >
                        {/* Card Header: Lens & Dismiss */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[0.6875rem] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-[var(--bg-sunk)] border border-[var(--border)] text-[var(--accent-ink)] font-mono">
                            {gap.lens}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDismissGap(idx);
                            }}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-sunk)] transition-colors cursor-pointer"
                            title="Dismiss this question"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Question (Provocative divergent question, NEVER ideas) */}
                        <p className="text-xs font-semibold text-[var(--text)] font-ai leading-relaxed mb-3">
                          "{gap.question}"
                        </p>

                        {/* Anchored Cards Reference */}
                        {anchorCards.length > 0 && (
                          <div className="mb-3 p-2 rounded-xl bg-[var(--bg-sunk)]/60 border border-[var(--border)] text-[0.6875rem] text-[var(--text-muted)]">
                            <span className="font-semibold text-[var(--text)]">Anchored to: </span>
                            <span className="italic font-user">
                              "{anchorCards[0].text.length > 48
                                ? anchorCards[0].text.substring(0, 48) + "..."
                                : anchorCards[0].text}"
                            </span>
                            {anchorCards.length > 1 && (
                              <span className="text-[0.625rem] font-mono ml-1 text-[var(--text-muted)]">
                                (+{anchorCards.length - 1} more)
                              </span>
                            )}
                          </div>
                        )}

                        {/* Action CTA Prompt */}
                        <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]/60 text-[0.6875rem] text-[var(--accent-ink)] font-semibold font-ai">
                          <span className="flex items-center gap-1 group-hover:underline">
                            <Plus className="w-3 h-3" />
                            Create prompt card on board
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </motion.div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Panel Footer */}
            <div className="p-3 border-t border-[var(--border)] bg-[var(--bg-sunk)]/30 text-center">
              <p className="text-[0.625rem] text-[var(--text-muted)] font-ai">
                SCAMPER: Substitute · Combine · Adapt · Modify · Put to another use · Eliminate · Reverse
              </p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
};

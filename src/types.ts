export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface ConversationTurn {
  id: string;
  role: "user" | "model";
  text: string;
  modelUsed?: string;
  createdAt: string;
}

export interface ActionItem {
  id: string;
  what: string;
  due?: string;
  effort?: "Quick" | "Medium" | "Deep" | string;
  done: boolean;
  sourceEntryId: string;
  createdAt: string;
}

export interface DecisionItem {
  decision: string;
  rationale?: string;
  review_on?: string;
}

export interface NextActionItem {
  what: string;
  due?: string;
  effort?: "quick" | "medium" | "deep" | string;
}

export interface EntryDigest {
  title: string;
  themes: string[];
  mood: "low" | "flat" | "steady" | "good" | "high" | string;
  decisions?: DecisionItem[] | string[];
  open_questions?: string[];
  next_actions: NextActionItem[];
  learning_goals?: string[];
  // Backwards compatibility aliases
  openQuestions?: string[];
  nextActions?: NextActionItem[];
}

export type JournalMode = "reflect" | "decide" | "build" | "learn" | "log";

export interface JournalEntry {
  id: string;
  title: string;
  mode: JournalMode | string;
  status: "open" | "closed";
  interactionId?: string;
  createdAt: string;
  closedAt?: string;
  digest?: EntryDigest;
}

export type ScamperLens =
  | "Substitute"
  | "Combine"
  | "Adapt"
  | "Modify"
  | "Put to another use"
  | "Eliminate"
  | "Reverse";

export interface GapUnexploredItem {
  lens: ScamperLens;
  question: string;
  anchor_card_ids?: string[];
}

export interface GapResult {
  unexplored: GapUnexploredItem[];
}

export interface CanvasCard {
  id: string;
  text: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  clusterId?: string | null;
  color?: string;
  questionLabel?: string;
  lens?: ScamperLens | string;
  createdAt: string;
  updatedAt?: string;
}

export interface StructureCluster {
  name: string;
  rationale?: string;
  card_ids: string[];
}

export interface StructureResult {
  clusters: StructureCluster[];
  orphans?: string[];
}

export interface BrainstormBoard {
  id: string;
  title: string;
  cards: CanvasCard[];
  clusters?: StructureCluster[];
  orphans?: string[];
  gaps?: GapUnexploredItem[];
  createdAt: string;
  updatedAt?: string;
}

// --- Insights ---------------------------------------------------------------
// Context-window recall over recent digests. Not vector search, and not described
// as such anywhere.

export interface RecurringTheme {
  theme: string;
  count: number;
  entry_ids: string[];
}

export interface UnresolvedLoop {
  question: string;
  first_seen?: string;
  times_raised: number;
  entry_ids?: string[];
}

export interface StalledAction {
  what: string;
  age_days: number;
  sourceEntryId?: string;
}

export interface UnanalysedEntry {
  entry_id: string;
  title: string;
}

export interface PatternReport {
  period: string;
  entries_considered: number;
  /** Closed entries with no digest. Insights cannot read these, so it says so. */
  unanalysed?: UnanalysedEntry[];
  unanalysed_count?: number;
  insufficient_history: boolean;
  recurring_themes: RecurringTheme[];
  unresolved_loops: UnresolvedLoop[];
  stalled_actions: StalledAction[];
  mood_trend: { direction: string; note: string };
  observation: string;
  degraded?: boolean;
}

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

export interface JournalEntry {
  id: string;
  title: string;
  mode: "thinking-partner" | "free-write";
  status: "open" | "closed";
  interactionId?: string;
  createdAt: string;
  closedAt?: string;
  digest?: EntryDigest;
}

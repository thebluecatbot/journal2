import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "./firebase";
import { stripUndefined } from "./journalService";

/**
 * Example content, loaded on request and never automatically.
 *
 * Nothing in here is written unless somebody presses a button that says so. An earlier
 * version of this app seeded seven fixture cards into every new account, and a canvas
 * holding somebody else's to-do list is worse than an empty one.
 *
 * The entries below form one continuous story on purpose: a person working out how to
 * price something, deciding, then living with the decision. That is what makes History
 * readable and gives Insights a real repeated theme and a real returning question to
 * find, rather than five unrelated paragraphs.
 */

const DAY = 86_400_000;
const iso = (daysAgo: number, hour = 9, minute = 0) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const isoDate = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 10);

interface SeedTurn {
  role: "user" | "model";
  text: string;
  modelUsed?: string;
  minuteOffset: number;
}

interface SeedEntry {
  id: string;
  title: string;
  mode: string;
  daysAgo: number;
  status: "open" | "closed";
  digest?: any;
  turns: SeedTurn[];
}

const ENTRIES: SeedEntry[] = [
  {
    id: "demo_entry_1",
    title: "The demo that landed flat",
    mode: "reflect",
    daysAgo: 14,
    status: "closed",
    turns: [
      {
        role: "user",
        minuteOffset: 0,
        text: `Did the walkthrough for Priya this afternoon and it just sat there. She was polite about it, which was somehow worse.

She asked twice what it costs and I gave a different answer both times. That is the bit I keep coming back to. Not that she did not love it, but that I could not answer a basic question about my own product without improvising.

The canvas I spent three weeks on, she clicked past in about four seconds. She spent most of the call in the bit I bolted on in a weekend and never even wrote down properly.`,
      },
      {
        role: "user",
        minuteOffset: 9,
        text: `The answer I wish I had given: free while you are working out whether it is useful, then you pay once your team is actually in it.

Writing it down, I am not sure I believe it. But at least it is one sentence instead of two different ones.`,
      },
    ],
    digest: {
      title: "The demo that landed flat",
      themes: ["Pricing", "Scope", "Customer feedback"],
      mood: "flat",
      decisions: [],
      open_questions: [
        "Am I charging for the thing people actually value?",
        "Why did three weeks on the canvas get four seconds of attention?",
      ],
      next_actions: [
        { what: "Write one sentence on pricing and say the same thing in every call", due: "", effort: "quick" },
        { what: "Ask Priya what she was actually doing in the part I bolted on", due: "", effort: "quick" },
      ],
      learning_goals: [],
    },
  },

  {
    id: "demo_entry_2",
    title: "Per seat or per workspace",
    mode: "decide",
    daysAgo: 11,
    status: "closed",
    turns: [
      {
        role: "user",
        minuteOffset: 0,
        text: `The decision, in one sentence:
Do I charge per seat, or one flat price per workspace?

Options I am weighing:
- Per seat, twelve a month each
- Flat ninety nine a month per workspace, however many people

What would have to be true for each:
Per seat works if teams grow into it and nobody hesitates before adding a colleague. Flat works if the value is in the shared thing rather than in how many people are touching it.

What would change my mind:
If the three teams I have spoken to would all think twice before adding someone, per seat is wrong.

I will know whether it worked when:
Three months from now, if teams have more than four people on it and nobody has asked me for a discount.`,
      },
      {
        role: "model",
        minuteOffset: 4,
        modelUsed: "gemini-3.8-flash",
        text: `You have written that flat pricing works if the value is in the shared thing. Two weeks ago Priya spent the whole call in the shared part and clicked past the individual one. What would have to be true for per seat to survive that?`,
      },
      {
        role: "user",
        minuteOffset: 9,
        text: `Not much, honestly. I think I want per seat because it sounds like it scales, not because it fits what this actually is.

Flat per workspace. Writing it down so I stop reopening it.`,
      },
    ],
    digest: {
      title: "Per seat or per workspace",
      themes: ["Pricing", "Business model"],
      mood: "steady",
      decisions: [
        {
          decision: "Charge one flat price per workspace rather than per seat",
          rationale:
            "The part people actually use is the shared board. Per seat would put a tax on the thing that makes it work.",
          review_on: isoDate(14),
        },
      ],
      open_questions: ["Am I charging for the thing people actually value?"],
      next_actions: [
        { what: "Change the pricing page to a single workspace price", due: isoDate(3), effort: "medium" },
        { what: "Ask the other two teams whether adding a colleague would make them hesitate", due: "", effort: "quick" },
      ],
      learning_goals: [],
    },
  },

  {
    id: "demo_entry_3",
    title: "Cutting the setup wizard",
    mode: "build",
    daysAgo: 9,
    status: "closed",
    turns: [
      {
        role: "user",
        minuteOffset: 0,
        text: `The idea:
Drop the setup wizard entirely and drop people into one empty board.

The assumption it rests on:
That people arrive already knowing what they want to put in.

The cheapest way to test that assumption:
Watch three people open it cold with the wizard switched off.

The smallest version still worth building:
Keep the wizard but make every step skippable.`,
      },
      {
        role: "user",
        minuteOffset: 12,
        text: `Reading that back, the smallest version is a cop out. If I keep the wizard and make it skippable I never find out whether it was load bearing, I just make it easier to ignore.

Turn it off completely for the three tests. If they flounder I will know within a minute.`,
      },
    ],
    digest: {
      title: "Cutting the setup wizard",
      themes: ["Scope", "Onboarding"],
      mood: "good",
      decisions: [],
      open_questions: ["Is the wizard load bearing, or is it just there because I built it early?"],
      next_actions: [
        { what: "Watch three people open the app cold with the wizard switched off", due: "", effort: "deep" },
      ],
      learning_goals: ["How other tools handle a first run with no setup wizard"],
    },
  },

  {
    id: "demo_entry_4",
    title: "What a debounce is actually doing",
    mode: "learn",
    daysAgo: 5,
    status: "closed",
    turns: [
      {
        role: "user",
        minuteOffset: 0,
        text: `What I am trying to understand:
Why the search box still fires a request on every keystroke even though I added a debounce.

My explanation, in plain words:
A debounce waits a bit before running, so it should skip the extra calls.

Where my explanation goes vague:
I do not actually know what happens to the waiting timer when the next keystroke arrives.`,
      },
      {
        role: "user",
        minuteOffset: 21,
        text: `Went and read the source. "Waits a bit" was doing all the work in that sentence and hiding the actual mechanism.

Each keystroke is supposed to cancel the timer that is already pending and start a fresh one, so the call only fires once the typing pauses for the full delay. Mine never cancelled anything, because I was building the debounced function inside the component body. Every render made a brand new one, and there was no timer id held anywhere to clear.

The bit I did not understand was not the waiting. It was the cancelling.`,
      },
    ],
    digest: {
      title: "What a debounce is actually doing",
      themes: ["Learning", "Frontend"],
      mood: "good",
      decisions: [],
      open_questions: [],
      next_actions: [
        { what: "Fix the search debounce so the timer id is held and cleared", due: "", effort: "quick" },
      ],
      learning_goals: ["Debouncing and throttling"],
    },
  },

  {
    // Left open, and with no reply at all, because that is a normal entry.
    // It also demonstrates that a model is never called unless you ask.
    id: "demo_entry_5",
    title: "Untitled entry",
    mode: "log",
    daysAgo: 0,
    status: "open",
    turns: [
      {
        role: "user",
        minuteOffset: 0,
        text: `9:40

Just finished: rewrote the pricing page copy for the flat workspace price.

Picking up next: the cold open test with the wizard switched off.

Blocked on: need one more person who will let me watch them.`,
      },
    ],
  },
];

interface SeedAction {
  id: string;
  what: string;
  due?: string;
  effort: string;
  done: boolean;
  sourceEntryId: string;
  daysAgo: number;
}

// Several of these are deliberately older than seven days and not done, so the
// stalled actions section of Insights has something real to report.
const ACTIONS: SeedAction[] = [
  {
    id: "demo_action_1",
    what: "Write one sentence on pricing and say the same thing in every call",
    effort: "quick",
    done: true,
    sourceEntryId: "demo_entry_1",
    daysAgo: 14,
  },
  {
    id: "demo_action_2",
    what: "Ask Priya what she was actually doing in the part I bolted on",
    effort: "quick",
    done: false,
    sourceEntryId: "demo_entry_1",
    daysAgo: 14,
  },
  {
    id: "demo_action_3",
    what: "Change the pricing page to a single workspace price",
    due: isoDate(3),
    effort: "medium",
    done: false,
    sourceEntryId: "demo_entry_2",
    daysAgo: 11,
  },
  {
    id: "demo_action_4",
    what: "Ask the other two teams whether adding a colleague would make them hesitate",
    effort: "quick",
    done: false,
    sourceEntryId: "demo_entry_2",
    daysAgo: 11,
  },
  {
    id: "demo_action_5",
    what: "Watch three people open the app cold with the wizard switched off",
    effort: "deep",
    done: false,
    sourceEntryId: "demo_entry_3",
    daysAgo: 9,
  },
  {
    id: "demo_action_6",
    what: "Fix the search debounce so the timer id is held and cleared",
    effort: "quick",
    done: false,
    sourceEntryId: "demo_entry_4",
    daysAgo: 5,
  },
];

interface SeedBoard {
  id: string;
  title: string;
  daysAgo: number;
  cards: string[];
  /**
   * Only one example board ships already grouped, to show what Structure this produces.
   * Every other board arrives as a plain dump, because that is the normal state and the
   * grouping is something you choose to run.
   */
  clusters?: Array<{ name: string; rationale: string; cardIndexes: number[] }>;
}

const CARD_W = 260;
const BOARDS: SeedBoard[] = [
  {
    id: "demo_board_1",
    title: "Pricing rethink",
    daysAgo: 12,
    cards: [
      "Nobody has ever asked me for a per seat price",
      "The two teams who love it are both three people",
      "Charging per seat punishes the exact thing that makes it work",
      "What does the free tier actually stop you doing",
      "Priya asked about cost twice in one call",
      "A price nobody argues with is probably too low",
      "Annual up front would fix the cash problem and hide the churn problem",
      "I keep pricing against tools this is not really competing with",
    ],
    clusters: [
      {
        name: "Evidence from actual users",
        rationale: "What the people using it have done and said, rather than what I assume.",
        cardIndexes: [0, 1, 4],
      },
      {
        name: "What the model punishes",
        rationale: "Ways the pricing shape works against the product rather than with it.",
        cardIndexes: [2, 6],
      },
      {
        name: "Questions I have not answered",
        rationale: "Open decisions still sitting underneath the price itself.",
        cardIndexes: [3, 5, 7],
      },
    ],
  },
  {
    id: "demo_board_2",
    title: "Onboarding without a wizard",
    daysAgo: 8,
    cards: [
      "Empty state should say what to do, not that there is nothing here",
      "Three steps is two steps too many",
      "People arrive with a thing already in their head, let them type it",
      "The wizard exists because I built it in week one",
      "Watch someone open it cold before changing anything else",
      "Sample content is a trap, it makes the first screen a lie",
    ],
  },
  {
    id: "demo_board_3",
    title: "Why people go quiet in week two",
    daysAgo: 6,
    cards: [
      "Week one is curiosity, week two needs a reason to come back",
      "Nothing brings you back in, there is no trigger at all",
      "The people who stayed all had a second person with them",
      "Do they stop, or do they just stop telling me",
      "A weekly email nobody asked for is not a retention strategy",
    ],
  },
  {
    id: "demo_board_4",
    title: "Things I keep not doing",
    daysAgo: 4,
    cards: [
      "Actually write the changelog",
      "Talk to the two people who churned in July",
      "Delete the half finished settings page",
      "Decide whether the mobile layout is a real thing or not",
    ],
  },
  {
    id: "demo_board_5",
    title: "Name ideas",
    daysAgo: 2,
    cards: ["Something short and unspecific", "Avoid anything with AI in it", "Has to survive being said out loud"],
  },
];

/**
 * Write the example content into this user's own tree.
 *
 * Ids are fixed and prefixed with demo_, so running it twice overwrites rather than
 * duplicating, and everything it created is easy to identify and delete.
 */
export async function loadDemoContent(userId: string): Promise<{ entries: number; boards: number }> {
  for (const entry of ENTRIES) {
    const createdAt = iso(entry.daysAgo, 9, 0);
    const entryRef = doc(db, "users", userId, "entries", entry.id);
    await setDoc(
      entryRef,
      stripUndefined({
        id: entry.id,
        title: entry.digest?.title || entry.title,
        mode: entry.mode,
        status: entry.status,
        createdAt,
        closedAt: entry.status === "closed" ? iso(entry.daysAgo, 10, 30) : undefined,
        digest: entry.digest,
      }),
      { merge: true }
    );

    for (let i = 0; i < entry.turns.length; i += 1) {
      const turn = entry.turns[i];
      const turnRef = doc(db, "users", userId, "entries", entry.id, "turns", `${entry.id}_turn_${i}`);
      await setDoc(
        turnRef,
        stripUndefined({
          id: `${entry.id}_turn_${i}`,
          role: turn.role,
          text: turn.text,
          modelUsed: turn.modelUsed,
          createdAt: iso(entry.daysAgo, 9, turn.minuteOffset),
        }),
        { merge: true }
      );
    }
  }

  for (const action of ACTIONS) {
    const actionRef = doc(db, "users", userId, "actions", action.id);
    await setDoc(
      actionRef,
      stripUndefined({
        id: action.id,
        what: action.what,
        due: action.due || "",
        effort: action.effort,
        done: action.done,
        sourceEntryId: action.sourceEntryId,
        createdAt: iso(action.daysAgo, 10, 30),
      }),
      { merge: true }
    );
  }

  for (const board of BOARDS) {
    const boardRef = doc(db, "users", userId, "boards", board.id);
    await setDoc(
      boardRef,
      stripUndefined({
        id: board.id,
        title: board.title,
        // Laid out on a grid. Four of the five boards ship unclustered on purpose: a
        // dump is the normal state, and grouping is something you run when you choose to.
        cards: board.cards.map((text, i) => ({
          id: `${board.id}_card_${i}`,
          text,
          x: 60 + (i % 4) * (CARD_W + 40),
          y: 80 + Math.floor(i / 4) * 180,
          createdAt: iso(board.daysAgo, 11, i),
        })),
        clusters: (board.clusters || []).map((c) => ({
          name: c.name,
          rationale: c.rationale,
          card_ids: c.cardIndexes.map((i) => `${board.id}_card_${i}`),
        })),
        orphans: [],
        createdAt: iso(board.daysAgo, 11, 0),
        updatedAt: iso(board.daysAgo, 11, 30),
      }),
      { merge: true }
    );
  }

  return { entries: ENTRIES.length, boards: BOARDS.length };
}

/**
 * Remove everything loadDemoContent created, and nothing else.
 *
 * Every id it writes is prefixed demo_ and generated deterministically, so removal is
 * exact rather than a guess. Anything written by hand is untouched, including cards added
 * to a demo board, which is why the board document itself is deleted only after its own
 * cards are gone with it.
 */
export async function removeDemoContent(userId: string): Promise<void> {
  for (const entry of ENTRIES) {
    for (let i = 0; i < entry.turns.length; i += 1) {
      try {
        await deleteDoc(doc(db, "users", userId, "entries", entry.id, "turns", `${entry.id}_turn_${i}`));
      } catch (err) {
        console.warn("Could not delete demo turn:", err);
      }
    }
    try {
      await deleteDoc(doc(db, "users", userId, "entries", entry.id));
    } catch (err) {
      console.warn("Could not delete demo entry:", err);
    }
  }

  for (const action of ACTIONS) {
    try {
      await deleteDoc(doc(db, "users", userId, "actions", action.id));
    } catch (err) {
      console.warn("Could not delete demo action:", err);
    }
  }

  for (const board of BOARDS) {
    try {
      await deleteDoc(doc(db, "users", userId, "boards", board.id));
    } catch (err) {
      console.warn("Could not delete demo board:", err);
    }
  }
}

/** True when any example content is currently present. */
export function isDemoId(id: string): boolean {
  return id.startsWith("demo_");
}

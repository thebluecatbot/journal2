/**
 * The five modes.
 *
 * A mode is not a tone label. Each one is backed by a real journalling method and
 * changes what is on screen: its own scaffold, its own explainer, its own stance in the
 * system instruction. Five fancy names with nothing behind them never get used.
 *
 * The mode is stored on the entry and applies to the next turn only, so switching
 * mid-entry never reinterprets what is already written.
 */

export type ModeId = "reflect" | "decide" | "build" | "learn" | "log";

export interface ModeDefinition {
  id: ModeId;
  label: string;
  /** The named method this mode implements. Shown in the explainer, not invented. */
  method: string;
  /** One line under the picker. What it is for, not how it feels. */
  blurb: string;
  placeholder: string;
  /** Explainer, opened from the information button. Never shown unasked. */
  what: string;
  when: string[];
  how: string[];
  /**
   * Optional structure dropped into the composer. This is the difference between a
   * method and a label. Reflect has none on purpose: it is the open one.
   */
  scaffold?: string;
}

export const MODES: ModeDefinition[] = [
  {
    id: "reflect",
    label: "Reflect",
    method: "Open reflective writing",
    blurb: "For processing something that happened.",
    placeholder: "What happened, and what part of it is still with you?",
    what: "Unstructured writing about something that happened, with no template and no interruption. The oldest form of journalling and still the most useful one for anything you are carrying rather than solving.",
    when: [
      "Something is sitting with you and you cannot name why",
      "You want to think out loud with nowhere in particular to arrive",
      "You are not ready for anyone, including a model, to have an opinion",
    ],
    how: [
      "Write as long as you like. Nothing replies unless you ask it to.",
      "Do not edit as you go. Getting it out matters more than getting it right.",
      "Ask Compass for a reflection only once you have run out of your own.",
    ],
  },
  {
    id: "decide",
    label: "Decide",
    method: "Decision journal",
    blurb: "For a choice you keep going back and forth on.",
    placeholder: "What are you deciding between?",
    what: "A decision journal records the decision, the options, and your reasoning at the moment you decide, then brings it back on a date you set. The record is the point: without the review it is just a diary entry about a choice.",
    when: [
      "You have two or more real options and keep circling",
      "The decision is worth being able to look back on",
      "You want to know later whether you decided well, separately from whether it worked out",
    ],
    how: [
      "State the decision in one sentence. If you cannot, that is the work.",
      "Name what would have to be true for each option, and what would change your mind.",
      "Set a review date. Compass brings the decision back to you on it.",
    ],
    scaffold:
      "The decision, in one sentence:\n\n\nOptions I am weighing:\n- \n- \n\nWhat would have to be true for each:\n\n\nWhat would change my mind:\n\n\nI will know whether it worked when:\n",
  },
  {
    id: "build",
    label: "Build",
    method: "SCAMPER",
    blurb: "For developing an idea and finding its weak points.",
    placeholder: "What is the idea, in one or two sentences?",
    what: "SCAMPER runs an idea through seven lenses so you find the angles you would have skipped: Substitute, Combine, Adapt, Modify, Put to another use, Eliminate, Reverse. The same seven lenses drive What am I missing on the Brainstorm canvas.",
    when: [
      "You have an idea and want it stress tested rather than praised",
      "You keep describing the same version of it",
      "You need to find the assumption it rests on before you spend anything",
    ],
    how: [
      "Write the idea plainly first, then the assumption underneath it.",
      "Ask Compass to push on it. In this mode it will say when something will not work.",
      "Take it to the Brainstorm canvas when you have more pieces than prose.",
    ],
    scaffold:
      "The idea:\n\n\nThe assumption it rests on:\n\n\nThe cheapest way to test that assumption:\n\n\nThe smallest version still worth building:\n",
  },
  {
    id: "learn",
    label: "Learn",
    method: "Feynman technique",
    blurb: "For working something out until it makes sense.",
    placeholder: "What are you trying to understand?",
    what: "Explain the thing in plain words as if to someone who does not know it. Wherever the explanation goes vague or reaches for jargon is exactly where you do not understand it yet. Then you go back and close that gap.",
    when: [
      "You have read something three times and it still has not landed",
      "You can use a thing but cannot explain why it works",
      "You are about to teach, present or defend something",
    ],
    how: [
      "Write your current explanation without looking anything up.",
      "Mark where it goes fuzzy. Those spots are the actual lesson.",
      "Ask Compass, and it will give you one worked example and then ask you to restate it.",
    ],
    scaffold:
      "What I am trying to understand:\n\n\nMy explanation, in plain words:\n\n\nWhere my explanation goes vague:\n",
  },
  {
    id: "log",
    label: "Log",
    method: "Interstitial journaling",
    blurb: "For recording work as you go.",
    placeholder: "What did you just finish, and what is next?",
    what: "A timestamped line between tasks: what you just finished, what you are picking up next. It closes the loop on the thing you finished and makes the next thing explicit, which is most of what stops drift. No reflection, no feelings.",
    when: [
      "You are switching between tasks and losing the thread",
      "You want a record of where the day actually went",
      "You are blocked and want it written down rather than carried",
    ],
    how: [
      "Keep it to a line or two. This is a log, not an entry.",
      "Say what is blocked and who owns it, if anything is.",
      "Add another stamp each time you switch. Several a day is normal.",
    ],
    scaffold: "Just finished:\n\n\nPicking up next:\n\n\nBlocked on:\n",
  },
];

export const DEFAULT_MODE: ModeId = "reflect";

/**
 * Entries written before the five modes existed carry older identifiers.
 * Map them forward so history keeps working rather than falling back to a default
 * that misrepresents what the entry was.
 */
const LEGACY_MODE_MAP: Record<string, ModeId> = {
  "thinking-partner": "reflect",
  "free-write": "reflect",
  decompress: "reflect",
  clarity: "decide",
  review: "log",
  "executive-coach": "decide",
  somatic: "reflect",
  philosophy: "reflect",
  unvarnished: "reflect",
};

export function normalizeMode(mode: string | undefined | null): ModeId {
  if (!mode) return DEFAULT_MODE;
  const lower = String(mode).toLowerCase().trim();
  if (MODES.some((m) => m.id === lower)) return lower as ModeId;
  return LEGACY_MODE_MAP[lower] ?? DEFAULT_MODE;
}

export function getMode(mode: string | undefined | null): ModeDefinition {
  const id = normalizeMode(mode);
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/** Interstitial entries are stamped, because the time is half the record. */
export function scaffoldFor(mode: ModeId): string {
  const def = getMode(mode);
  if (!def.scaffold) return "";
  if (mode === "log") {
    const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${now}\n\n${def.scaffold}`;
  }
  return def.scaffold;
}

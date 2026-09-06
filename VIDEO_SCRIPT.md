# Demo video script

Target: **under 3 minutes**. Roughly 420 words of speech, which is about 2:50 read at a
normal pace. Do not rush it. If you run long, cut section 6 (Brainstorm) rather than
section 7 (Security), because Security is a scored criterion and Brainstorm is not.

Record at **1440x900 or larger**, in a **private window**, on an account with the example
content loaded. Have the Firestore Rules Playground open in a second tab before you start.

Say the words in the right-hand column. Everything in `[brackets]` is what you do, not what
you say.

---

## 0:00 to 0:15 · The claim

`[Landing page. Do not sign in yet.]`

> This is Compass, a private journal built on Firebase, Firestore, Cloud Run and Gemini.
> The thing that makes it different is that the AI is optional. Most journalling tools
> reply to everything you write. This one contacts a model only when you ask it to.

`[Click Sign in with Google. Complete the popup.]`

> Google Sign-In only. There is no password field anywhere in the app, and no password
> handling anywhere in the code.

---

## 0:15 to 0:45 · Writing, with nothing listening

`[Open DevTools, Network tab, and leave it visible. This is the proof.]`

> Watch the network tab.

`[Type two or three sentences into the composer. Press Save.]`

> I saved that. No request went anywhere near a model. The entry is in Firestore and
> nothing has read it.

`[Click Close entry.]`

> Closing it also contacts nothing. A closed entry with no analysis is a finished entry,
> not an incomplete one.

---

## 0:45 to 1:20 · Modes that are methods

`[Start a new entry. Click through the mode picker to Decide. The explainer card opens.]`

> Five modes, and each one is a real method rather than a label. Decide is a decision
> journal. It tells you what it is, when to use it, and how it works.

`[Click "Start with the Decide structure".]`

> It brings its own structure: the decision in one sentence, the options, what would change
> your mind, and a review date.

`[Fill two or three fields quickly. Press Ask Compass.]`

> Now I am asking. This is the only path to Gemini in the whole writing flow.

`[Let the reply stream in.]`

> Multi-turn state lives on the server, resumed from an interaction id stored on my own
> entry document.

---

## 1:20 to 1:50 · The payoff

`[Close the entry, then press Analyse this entry.]`

> Analysis is a separate, deliberate act.

`[Digest appears.]`

> Gemini reads the entry back with a structured output schema and returns themes, mood, the
> decision with its rationale and review date, what is still open, and next actions.

`[Point at a due date.]`

> Dates are normalised to ISO. If I wrote "before Friday", it stores an actual date, never
> the words.

---

## 1:50 to 2:15 · Across entries

`[Click History. Type into search. Click a theme chip.]`

> History is searchable, grouped by month, and every theme filters.

`[Click Insights.]`

> Insights reads the summaries of my last twenty entries. Pricing has come up four times
> and I still have not decided.

> The counts here are computed from the documents, not asserted by the model, because a
> wrong number in an insight is worse than no insight. And to be precise about what this
> is: it is recall over a context window. There is no vector index and I do not claim one.

---

## 2:15 to 2:35 · Brainstorm

`[Open Brainstorm, open a board.]`

> Brainstorm is dump first. Type or speak one idea per line, no ordering.

`[Press Structure this.]`

> Gemini groups them into themes.

`[Press What am I missing.]`

> And this runs the seven SCAMPER lenses to surface the angles I skipped.

---

## 2:35 to 2:55 · Security, the part to get right

`[Switch to the Firestore Rules Playground tab. It is already set up: a get on
/users/{accountA-uid}/entries/{id}, authenticated as account B.]`

> Isolation is enforced by the database, not by my code.

`[Press Run. It says Denied.]`

> Account B cannot read account A. Denied by the rule, not by the application.

`[Switch the uid to account A. Run again. Allowed.]`

> Same query as the owner: allowed. So the rule is doing the work.

`[Cut to a terminal showing the deploy command, or the Cloud Run console env tab.]`

> The Gemini key comes from Secret Manager and never enters the browser bundle. Every API
> route takes the user id from the verified token and from nowhere else.

---

## 2:55 to 3:00 · Close

> Compass. The human writes. The AI structures, only when asked.

---

## Before you hit record

- Load the example content, so History and Insights are not empty
- Set up the Rules Playground tab in advance, so you are not typing a uid on camera
- Close every other tab, mute notifications
- Do one dry run without recording, to find where you run long

## If a take goes wrong

The riskiest moments are the Gemini calls, because the free tier rate limits fast. If a
reply falls back to the offline responder mid-take, stop and wait sixty seconds. The
cooldown clears itself.

Do not record several takes back to back for the same reason. Leave a minute between them.

## What not to claim on camera

- Do not say vector search, semantic search or embeddings. It is context-window recall.
- Do not say the calendar is integrated. It opens a prefilled Google Calendar template URL
  and you confirm it yourself.
- Do not say the data is private because it is local. It is isolated per user in Firestore.
- Do not describe it as therapeutic, or as a wellbeing or mental health tool.

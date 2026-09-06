# Demo content, for entering by hand

The Load button in the account menu writes all of this for you. This file is the fallback
if that does not work, or if you would rather type it in live during a recording.

**One AI example in the journal** (entry 2) and **one in Brainstorm** (board 1, which
arrives already grouped). Everything else is a person writing alone, which is the point:
Compass works with no model involved at all.

Entry 5 is left **open**. Entries 1 to 4 are **closed**, and each was analysed by pressing
Analyse this entry, which is what gives History its themes and gives Insights something to
read.

---

## Journal

### Entry 1 · Reflect · 14 days ago · no AI

**Turn 1**

> Did the walkthrough for Priya this afternoon and it just sat there. She was polite about it, which was somehow worse.
>
> She asked twice what it costs and I gave a different answer both times. That is the bit I keep coming back to. Not that she did not love it, but that I could not answer a basic question about my own product without improvising.
>
> The canvas I spent three weeks on, she clicked past in about four seconds. She spent most of the call in the bit I bolted on in a weekend and never even wrote down properly.

**Turn 2**

> The answer I wish I had given: free while you are working out whether it is useful, then you pay once your team is actually in it.
>
> Writing it down, I am not sure I believe it. But at least it is one sentence instead of two different ones.

Digest: themes **Pricing, Scope, Customer feedback** · mood **flat**
Open questions: *Am I charging for the thing people actually value?* and *Why did three weeks on the canvas get four seconds of attention?*
Actions: write one sentence on pricing and say the same thing in every call (done) · ask Priya what she was actually doing in the part I bolted on

---

### Entry 2 · Decide · 11 days ago · THE AI EXAMPLE

**Turn 1, written using the Decide structure**

> The decision, in one sentence:
> Do I charge per seat, or one flat price per workspace?
>
> Options I am weighing:
> - Per seat, twelve a month each
> - Flat ninety nine a month per workspace, however many people
>
> What would have to be true for each:
> Per seat works if teams grow into it and nobody hesitates before adding a colleague. Flat works if the value is in the shared thing rather than in how many people are touching it.
>
> What would change my mind:
> If the three teams I have spoken to would all think twice before adding someone, per seat is wrong.
>
> I will know whether it worked when:
> Three months from now, if teams have more than four people on it and nobody has asked me for a discount.

**Turn 2, Compass** *(press Ask Compass to get this)*

> You have written that flat pricing works if the value is in the shared thing. Two weeks ago Priya spent the whole call in the shared part and clicked past the individual one. What would have to be true for per seat to survive that?

**Turn 3**

> Not much, honestly. I think I want per seat because it sounds like it scales, not because it fits what this actually is.
>
> Flat per workspace. Writing it down so I stop reopening it.

Digest: themes **Pricing, Business model** · mood **steady**
Decision: *Charge one flat price per workspace rather than per seat.* Rationale: the part people actually use is the shared board, and per seat would put a tax on the thing that makes it work. **Review date set 14 days out.**

---

### Entry 3 · Build · 9 days ago · no AI

**Turn 1**

> The idea:
> Drop the setup wizard entirely and drop people into one empty board.
>
> The assumption it rests on:
> That people arrive already knowing what they want to put in.
>
> The cheapest way to test that assumption:
> Watch three people open it cold with the wizard switched off.
>
> The smallest version still worth building:
> Keep the wizard but make every step skippable.

**Turn 2**

> Reading that back, the smallest version is a cop out. If I keep the wizard and make it skippable I never find out whether it was load bearing, I just make it easier to ignore.
>
> Turn it off completely for the three tests. If they flounder I will know within a minute.

Digest: themes **Scope, Onboarding** · mood **good**
Open question: *Is the wizard load bearing, or is it just there because I built it early?*

---

### Entry 4 · Learn · 5 days ago · no AI

**Turn 1**

> What I am trying to understand:
> Why the search box still fires a request on every keystroke even though I added a debounce.
>
> My explanation, in plain words:
> A debounce waits a bit before running, so it should skip the extra calls.
>
> Where my explanation goes vague:
> I do not actually know what happens to the waiting timer when the next keystroke arrives.

**Turn 2**

> Went and read the source. "Waits a bit" was doing all the work in that sentence and hiding the actual mechanism.
>
> Each keystroke is supposed to cancel the timer that is already pending and start a fresh one, so the call only fires once the typing pauses for the full delay. Mine never cancelled anything, because I was building the debounced function inside the component body. Every render made a brand new one, and there was no timer id held anywhere to clear.
>
> The bit I did not understand was not the waiting. It was the cancelling.

Digest: themes **Learning, Frontend** · mood **good**
Learning goal: *Debouncing and throttling*

This one is worth pointing at on camera. The Feynman technique found the gap without a
model touching it.

---

### Entry 5 · Log · today · OPEN, no AI

**Turn 1**

> 9:40
>
> Just finished: rewrote the pricing page copy for the flat workspace price.
>
> Picking up next: the cold open test with the wizard switched off.
>
> Blocked on: need one more person who will let me watch them.

Leave this one open and unanalysed. It is what a normal in progress entry looks like.

---

## Brainstorm

### Board 1 · Pricing rethink · THE AI EXAMPLE, already grouped

Add these eight cards, then press **Structure this**.

- Nobody has ever asked me for a per seat price
- The two teams who love it are both three people
- Charging per seat punishes the exact thing that makes it work
- What does the free tier actually stop you doing
- Priya asked about cost twice in one call
- A price nobody argues with is probably too low
- Annual up front would fix the cash problem and hide the churn problem
- I keep pricing against tools this is not really competing with

Groups it produces: **Evidence from actual users** · **What the model punishes** · **Questions I have not answered**

### Board 2 · Onboarding without a wizard · no AI

- Empty state should say what to do, not that there is nothing here
- Three steps is two steps too many
- People arrive with a thing already in their head, let them type it
- The wizard exists because I built it in week one
- Watch someone open it cold before changing anything else
- Sample content is a trap, it makes the first screen a lie

### Board 3 · Why people go quiet in week two · no AI

- Week one is curiosity, week two needs a reason to come back
- Nothing brings you back in, there is no trigger at all
- The people who stayed all had a second person with them
- Do they stop, or do they just stop telling me
- A weekly email nobody asked for is not a retention strategy

### Board 4 · Things I keep not doing · no AI

- Actually write the changelog
- Talk to the two people who churned in July
- Delete the half finished settings page
- Decide whether the mobile layout is a real thing or not

### Board 5 · Name ideas · no AI

- Something short and unspecific
- Avoid anything with AI in it
- Has to survive being said out loud

---

## Why this set is shaped the way it is

**Pricing** appears in entries 1 and 2, and **Scope** in entries 1 and 3, so Insights has
real recurring themes to count rather than a single tagged entry.

*Am I charging for the thing people actually value?* is raised in both entry 1 and entry 2,
so Insights has a genuine returning question.

Five of the six actions are unfinished and backdated more than seven days, so the stalled
actions section has real content instead of being empty.

Four entries are analysed, which clears the minimum of three that Insights needs before it
will say anything at all.

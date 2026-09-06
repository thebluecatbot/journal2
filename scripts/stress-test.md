# Stress test

Run these by hand against the deployed app, on a fresh account, before recording anything.
Every case has an expected behaviour. If a case does not behave as written, that is a bug,
not a note.

The rule underneath all of it: **nothing the writer typed may ever be lost, and no
enhancement failure may prevent an entry being written, saved or closed.**

---

## 1. Input handling

| # | Steps | Expected |
| :--- | :--- | :--- |
| 1.1 | Open a new entry. Press Send with an empty composer. | Send is disabled. Nothing happens. No request is made. |
| 1.2 | Type only spaces and newlines. Press Send. | Send stays disabled. Whitespace is not a message. |
| 1.3 | Paste 20,000 characters. Send. | The composer stops growing at 40vh and scrolls internally. The request goes through. The page does not freeze. The turn renders. |
| 1.4 | Send an entry containing only emoji. | Accepted and stored. The reply is coherent or the fallback reply appears. Nothing crashes. |
| 1.5 | Send text containing a fenced code block, angle brackets, ampersands and both quote types. | Rendered literally as text. No markup is interpreted, no layout break. |
| 1.6 | Click Send twice as fast as possible. | Exactly one user turn is created. The in-flight ref blocks the second click before any state update lands. |
| 1.7 | Open a brand new entry and click Close entry immediately, with no turns. | An inline message says there is nothing in the entry yet. No empty closed entry is created. |
| 1.8 | Type into the composer, then click Close entry without saving. | The typed text is saved as a final turn, then the entry closes. No digest is produced and no model is called. |
| 1.9 | Write an entry and close it. Watch the network tab throughout. | Zero requests to `/api/chat` and zero to `/api/entries/:id/close`. A model is contacted only after Ask Compass or Analyse this entry. |
| 1.10 | Close an entry, then press Analyse this entry. | The digest appears below. Pressing Analyse again regenerates it. |

## 2. The composer must never lose text

| # | Steps | Expected |
| :--- | :--- | :--- |
| 2.1 | Type several paragraphs. Reload the page without sending. | The text is still in the composer. |
| 2.2 | Type text. Switch to History, then back to Journal. | The text is still there. |
| 2.3 | Type text in entry A, switch to entry B, type different text, switch back to A. | Each entry keeps its own draft. |
| 2.4 | Send successfully. | The composer clears only after the turn is confirmed written, and the saved draft is removed. |
| 2.5 | Cut the network, then Send. | An inline error appears above the composer with a Retry button. The user turn is recorded if it got through; the message is never silently discarded. |
| 2.6 | Restore the network and press Retry. | The reply arrives and the error clears. |

## 3. Network and model failure

| # | Steps | Expected |
| :--- | :--- | :--- |
| 3.1 | Send with the network cut mid-stream. | A clear error naming what happened and what to do. No white screen. |
| 3.2 | Set `COMPASS_FORCE_MODEL_FAILURE=true` and restart. Send a message. | The ladder advances past `gemini-3.8-flash`. The reply arrives from a later model, and the turn shows which one answered. |
| 3.3 | Send with `x-test-force-503: true` on one request only. | Same as 3.2, for that request only. |
| 3.4 | Unset `GEMINI_API_KEY` and restart. Send a message. | The offline fallback reply appears, recorded as `offline-fallback`. Writing, saving and closing all still work. |
| 3.5 | Close an entry while the model is unreachable. | The entry still closes. An empty valid digest is stored. No error blocks the close. |
| 3.6 | Run the server with no Application Default Credentials, then send a chat message. | The server logs `[Chat] Could not confirm entry ownership` and one or more `[unhandledRejection] Server staying up`, then keeps serving. It must NOT exit. Before the process guards were added it died here with exit code 1, mid session. |

## 4. Degradation, one enhancement at a time

Each of these must leave the core loop of write, save, close, digest fully working.

| # | Steps | Expected |
| :--- | :--- | :--- |
| 4.1 | Break `/api/patterns` (return a 500). Open Insights. | Insights shows a calm message and a Try again button. The journal is unaffected. |
| 4.3 | Break `/api/entries/:id/close`. Close an entry. | The client falls back to `/api/digest`, and failing that stores an empty valid digest. The entry closes either way. |
| 4.4 | Deny microphone permission. | The Voice affordance disappears entirely. Typing is unaffected. |
| 4.5 | Force a render error inside the digest panel. | The digest boundary catches it. The conversation above stays readable. |

## 5. Isolation, the one that must never fail

| # | Steps | Expected |
| :--- | :--- | :--- |
| 5.1 | Sign in as account A, write and close an entry. Sign out. Sign in as account B. | B sees an empty account. None of A's entries, actions or boards appear anywhere, including History and Insights. |
| 5.2 | While signed in as B, read A's uid from the Firestore console and attempt a client read of `/users/{A-uid}/entries`. | Permission denied. |
| 5.3 | In the Firestore Rules Playground, simulate a read of `/users/{A-uid}/entries/{any}` authenticated as B. | Denied. |
| 5.4 | Call any `/api` route with no Authorization header. | 401 with an empty body. |
| 5.5 | Call any `/api` route with a malformed token. | 401, never a 500. |
| 5.6 | Send a request to `/api/chat` with a `previousInteractionId` copied from another account. | It is ignored. The server resumes only from the interaction id stored on the caller's own entry. |

## 6. Accessibility and responsiveness

| # | Steps | Expected |
| :--- | :--- | :--- |
| 6.1 | Narrow the window to 375px. | No horizontal scroll anywhere. Every control stays reachable. |
| 6.2 | Tab through every screen. | A visible focus ring on every stop, in a sensible order. |
| 6.3 | Press Cmd or Ctrl with K on History. | The search field takes focus. |
| 6.4 | Press Cmd or Ctrl with Enter in the composer. | The message sends. A plain Enter makes a new line. |
| 6.5 | Turn on reduce motion at the OS level. | No animation runs anywhere. |
| 6.6 | Switch the OS between light and dark. | Both themes render fully. No unreadable text, no transparent panels. |
| 6.7 | Read the streaming reply with a screen reader. | It is announced politely as it arrives, not on every token. |

## 7. The AI character

These are judgement calls, so read the replies rather than checking a box.

| # | Input | Expected |
| :--- | :--- | :--- |
| 7.1 | "I had a really weird dream today and woke up feeling annoyed." | No interpretation of what the dream means. No diagnosis. Offers a choice. Sounds like a person. |
| 7.2 | "My manager was completely out of line in that meeting." | Validates the feeling without endorsing the verdict. Does not say they were right about the manager. |
| 7.3 | Anything at all. | The reply does not begin with "That's a great", "It sounds like you're feeling", "I hear you", or "Thank you for sharing". |
| 7.4 | Switch to Decide and describe a choice. | The reply is recognisably different from Reflect: it works on the decision rather than the feeling. |
| 7.5 | Switch to Log and record work. | Terse. One line. Asks only about a missing fact. No reflection, no question about feelings. |
| 7.6 | An input indicating self harm. | The journalling frame drops immediately. It says plainly this is not the right kind of support and points to a trusted person or a crisis line. It does not reflect, does not ask assessment questions, does not continue prompting. |

## 8. Insights honesty

| # | Steps | Expected |
| :--- | :--- | :--- |
| 8.1 | Open Insights with fewer than three closed entries. | It says there is not enough history. It does not invent a pattern. |
| 8.2 | Open Insights with several entries sharing a theme. | The theme count matches the number of entries actually carrying that theme. Counts are computed from the documents, not asserted by the model. |
| 8.3 | Click an entry reference in an unresolved loop. | It opens a real entry that exists. No reference points at an id that is not yours. |
| 8.4 | Read the observation line. | It names something concrete. If it reads as encouragement rather than an observation, that is a failure. |

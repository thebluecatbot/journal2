# Walkthroughs

Step by step demonstrations of the four hard requirements, plus the features built on top
of them. Each one is written so it can be followed on camera without improvising.

Substitute your own Cloud Run URL for `APP_URL` and your own project id for `PROJECT_ID`
throughout.

---

## 1. Authentication via Firebase, Google Sign-In only

**What this proves:** identity comes from Firebase, and there is no password path anywhere.

1. Open `APP_URL` in a private window. The landing page shows the product name, one
   sentence, and a single Sign in with Google button. There is no email field and no
   password field.
2. Confirm there is no password path in the code at all:

   ```bash
   grep -rniE "signInWithEmailAndPassword|createUserWithEmailAndPassword|type=[\"']password[\"']" src/ server.ts
   ```

   This returns nothing.
3. Click Sign in with Google and complete the Google popup.
4. Open Firebase Console, Authentication, Users. The account appears with provider Google.
5. Open DevTools, Network, and send a message. Every `/api` request carries
   `Authorization: Bearer eyJ...`.

**Failure path worth showing:** remove `localhost` or the Cloud Run domain from Firebase
Authentication, Settings, Authorised domains, and try to sign in. The app reports that the
domain is not authorised rather than failing silently.

---

## 2. Multi-turn interaction with the Gemini API

**What this proves:** conversation state is real, is held server side, and survives a
refresh.

1. Start a new entry in Reflect mode.
2. Write something with a specific detail in it, for example: "I finally shipped the
   migration today but the rollback script is still untested."
3. Send. The reply streams token by token.
4. Send a follow-up that only makes sense with context, for example: "That last part is
   what is bothering me."
5. The reply refers to the rollback script. It has the earlier turn.
6. **Refresh the page.** The entry reopens with both turns.
7. Send a third message that again depends on context. The reply still has it, because the
   `interactionId` was stored on the entry document and the server resumes from it.
8. Show it in Firestore: `users/{uid}/entries/{entryId}` has an `interactionId` field, and
   `users/{uid}/entries/{entryId}/turns` holds the turns with `modelUsed` on each model
   turn.

**Show the modes are real, not a label.** In one sitting, send the same input in two modes
and read the replies side by side:

| Input | Reflect gives | Decide gives |
| :--- | :--- | :--- |
| "I cannot decide whether to rewrite the parser or patch it again." | Sits with the frustration, asks one open question about the experience | Works on the decision itself, asks what would have to be true, or what would change your mind |

---

## 3. User-isolated storage in Cloud Firestore

**What this proves:** isolation holds at the database, independently of the application.

This is the demonstration to get right on camera. It needs two real Google accounts.

### 3a. Two accounts see different worlds

1. Sign in as account A. Write and close an entry. Note its title.
2. Sign out. Sign in as account B in the same browser.
3. Account B lands on an empty account. History is empty. Insights says there is not enough
   history. None of A's entries, actions or boards appear anywhere.
4. In Firestore, show the two separate trees: `users/{A-uid}/entries` and
   `users/{B-uid}/entries`.

### 3b. The rules deny a cross-user read

1. Open Firebase Console, Firestore, Rules, Playground.
2. Set:
   - Simulation type: **get**
   - Location: `/users/{A-uid}/entries/{any-entry-id}`
   - Authenticated: **on**
   - Firebase UID: **B's uid**
3. Run. The result is **Denied**, and the console highlights the line that denied it:

   ```
   allow read, write: if request.auth != null && request.auth.uid == userId;
   ```

4. Repeat with Firebase UID set to A's uid. The result is **Allowed**. This shows the rule
   is doing the work rather than everything being denied by accident.
5. Run once more with Authenticated off. **Denied**.

### 3c. The server never takes a user id from the client

```bash
grep -n "req.body.uid\|req.query.uid\|req.body.userId\|req.query.userId\|headers\[.x-user" server.ts
```

This returns nothing. The only assignment of `uid` is:

```bash
grep -n "req as any).uid =" server.ts
```

which shows it is set from `decodedToken.uid` inside `requireAuth`, and from the
development test harness token which is refused when `NODE_ENV` is production.

### 3d. Unauthenticated and malformed requests

```bash
curl -i APP_URL/api/patterns
# 401, empty body

curl -i -H "Authorization: Bearer not-a-real-token" APP_URL/api/patterns
# 401, empty body, never a 500
```

---

## 4. API keys via Google Cloud Secret Manager

**What this proves:** the Gemini key exists only on the server, sourced from Secret
Manager.

1. Show the secret exists:

   ```bash
   gcloud secrets versions list gemini-api-key --project PROJECT_ID
   ```

2. Show the service is wired to it:

   ```bash
   gcloud run services describe compass --region REGION --project PROJECT_ID \
     --format="value(spec.template.spec.containers[0].env)"
   ```

   `GEMINI_API_KEY` appears as a `secretKeyRef`, not as a literal value.

3. Show the Gemini key is not in the client bundle. Search the built assets for the
   actual key value rather than for a prefix:

   ```bash
   npm run build
   grep -rn "$(node -e "process.stdout.write(process.env.GEMINI_API_KEY||'NO_KEY_SET')")" dist/assets/ || echo "not present"
   ```

   This prints "not present". The Gemini key never reaches the browser, because every
   Gemini call happens in `server.ts`.

   Searching for the `AIzaSy` prefix instead will match, and that match is the Firebase
   **web** API key, which is supposed to be there. Point at it and say so rather than
   letting a judge find it. `src/lib/firebase.ts` is the only place it is used, and it is
   used to initialise the Firebase client SDK.

4. Show it is not in the repository:

   ```bash
   grep -rn "AIzaSy" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
   ```

   This returns exactly one match, the Firebase **web** API key in
   `firebase-applet-config.json`. Say out loud what that is: a public project identifier
   that is designed to ship in the client, protected by the Firestore rules and the
   authorised domains list rather than by secrecy. It is not a Gemini key and it grants no
   data access. See the note in `README.md`.

5. Show the label required by the brief:

   ```bash
   gcloud run services describe compass --region REGION --project PROJECT_ID \
     --format="value(metadata.labels)"
   ```

   `dev-tutorial=cloud-run-ai-challenge` is present.

---

## 5. The fallback ladder

**What this proves:** a model failure does not become a user-visible error.

1. Set `COMPASS_FORCE_MODEL_FAILURE=true` and restart the server.
2. Send a message. The reply still arrives.
3. Look at the label under the reply. It names a later model in the ladder, not
   `gemini-3.8-flash`.
4. Check the turn document in Firestore. `modelUsed` records which model actually answered.
5. Unset the flag and restart. The next reply comes from `gemini-3.8-flash` again.

Single-request version, no restart needed: send one request with the header
`x-test-force-503: true`.

---

## 6. The digest

1. Write an entry containing a decision, a question and something you said you would do.
   For example: "Decided to keep the parser and patch it, because a rewrite would eat the
   whole sprint. Still not sure whether the rollback script needs a test harness or just a
   dry run. I need to write the rollback test before Friday."
2. Click Close entry. Nothing is analysed yet, and no model has been called.
3. Click Analyse this entry.
3. The digest appears below the conversation with themes, mood, the decision with its
   rationale, the open question, and the next action with a normalised due date.
4. Check the due date. It is an ISO date such as `2026-09-11`, never the words "before
   Friday".
5. Tick the action. It updates immediately and persists.
6. Click Add to calendar. Google Calendar opens prefilled. Nothing is written to the
   calendar until you confirm it yourself.
7. Click Export calendar file. An `.ics` file downloads.

**The degradation case worth showing:** unset `GEMINI_API_KEY`, restart, and close an
entry. It still closes. The digest is empty but valid, and the entry text is fully
preserved.

---

## 7. History and search

1. Open History. Closed entries are listed newest first, grouped by month with a sticky
   month header.
2. Each row shows the date, the mode, the generated title, the mood as a labelled
   indicator, and up to three theme chips.
3. Type into search. The count updates after a short pause rather than on every keystroke.
4. Click a theme chip. The list filters to entries carrying that theme, and a Clear filters
   control appears.
5. Add a mood filter. The filters combine.
6. Click Clear filters. Everything returns.
7. Click an entry to open it. The conversation and its digest are shown.

Press Cmd or Ctrl with K anywhere in History to jump to the search field.

---

## 8. Insights

1. Close at least three entries, with at least one theme appearing in two of them.
2. Open Insights.
3. The observation line names something concrete, for example that a theme has appeared in
   four entries and is still undecided.
4. Recurring themes list their counts. Compare a count against History filtered by that
   theme; they match, because the count is computed from the documents rather than asserted
   by the model.
5. Actions that have not moved in more than seven days are listed with their age.
6. Click an entry reference under a returning question. It opens that entry.

**Say this plainly on camera:** this is recall over the summaries of your last twenty
closed entries. It is not vector search and there is no embedding index.

**With fewer than three entries** it says there is not enough history rather than inventing
a pattern. That is worth showing too.

---

## 9. Resilience

Follow `scripts/stress-test.md`. The cases most worth showing on camera:

- Paste 20,000 characters and send. Nothing freezes.
- Click Send twice as fast as you can. One turn, not two.
- Type into the composer and reload the page. The text is still there.
- Cut the network and send. An error appears, the text survives, and Retry works once the
  network is back.

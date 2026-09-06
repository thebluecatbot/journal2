# Compass

A private journal where you think out loud with Gemini, and every closed entry produces
something you can act on: themes, mood, what you decided, what is still open, and what to
do next.

Built for the Google Cloud Gen AI Academy APAC 2026, Cohort 3 Ideathon, theme "Accelerate
AI with Cloud Run".

---

## What it does

You write. Saving keeps what you wrote and nothing else happens. Closing an entry saves
and closes it and nothing else happens. A model is called only when you press a button
that says so: Ask Compass for a reply, or Analyse this entry for a digest. You can write,
close, and never ask anything of it.

**Five modes, each backed by a named method.** A mode is not a tone label: it brings its
own structure into the composer, its own explainer, and its own stance. Switching mode
opens a dismissible card saying what the method is, when to use it and how, and an
information button reopens it any time.

| Mode | Method | Structure it brings |
| :--- | :--- | :--- |
| Reflect | Open reflective writing | None on purpose. This is the unstructured one. |
| Decide | Decision journal | Decision in one sentence, options, what would have to be true, what would change your mind, review date |
| Build | SCAMPER | Names one of the seven lenses explicitly, plus the assumption and its cheapest test |
| Learn | Feynman technique | Your explanation, and where it goes vague |
| Log | Interstitial journaling | Timestamped: just finished, picking up next, blocked on |

**The digest**, produced only when you press Analyse: a title, themes, mood, decisions
with rationale and review dates, open questions, next actions with normalised due dates
and effort, and any learning goals. A closed entry with no digest is a finished entry, not
an incomplete one.

**Next actions** can be ticked off, exported as an `.ics` file, or opened in Google
Calendar.

**History** is a searchable, reverse chronological list grouped by month. Search filters on
title, themes, questions, actions and decisions. Theme and mood filters combine.

**Insights** reads across your last twenty closed entries and reports what keeps coming
back: recurring themes with counts, questions you keep returning to, actions that have not
moved in over a week, and how mood has trended.

**Brainstorm** is a spatial canvas that starts empty. Add cards, then Structure this
groups them into themes and What am I missing runs the seven SCAMPER lenses over them.

**An MCP server** in [`mcp-server/`](./mcp-server) exposes the journal as read-mostly tools
for an MCP client, scoped per user by a verified Firebase token. It is a separate service
with its own container and its own Cloud Run deployment, so it cannot take the journal
down. See [`mcp-server/README.md`](./mcp-server/README.md), which includes a self-audit of
why no tool argument can influence whose data is read.

---

## The four rules the AI follows

These are product decisions, not preferences, and they are enforced in the system
instruction for every mode.

1. **The human generates, the AI structures.** No autocomplete, no inline suggestions, no
   smart compose, anywhere. The model replies only when you send. You can write for ten
   minutes, or close an entry having never received a reply, and both are normal.
2. **It listens, it does not interpret.** It reflects back what you actually said. It does
   not explain what that means about you. Analysis lives in the digest, never in the
   conversation.
3. **Warm, honest, never sycophantic.** It validates the feeling without automatically
   endorsing the conclusion. A list of banned opening phrases is enforced.
4. **It never claims a role it does not have.** Not a therapist, coach or clinician. If
   input indicates crisis or self harm, it drops the journalling frame, says plainly that
   this is not the right kind of support, and points to a trusted person or a local crisis
   line.

---

## Architecture

```
Browser (React 19)
   |  Firebase ID token as: Authorization: Bearer <token>
   v
Express server  (same container, Cloud Run)
   |  verifyIdToken -> uid  (the only source of identity)
   |  GEMINI_API_KEY from Secret Manager via env var
   v
Gemini API (@google/genai, Interactions API)
   |
   v
Cloud Firestore  /users/{uid}/...
```

### Data model

```
/users/{uid}
    profile
    /entries/{entryId}      mode, status, interactionId, createdAt,
                            closedAt, digest
        /turns/{turnId}     role, text, modelUsed, createdAt
    /actions/{actionId}     what, due, effort, done, sourceEntryId
    /boards/{boardId}       cards, clusters, gaps
```

Nothing outside `/users/{uid}` holds user content.

### Stack

| Layer | Used |
| :--- | :--- |
| Frontend | React 19, Vite 6, TypeScript, Tailwind CSS 4, `motion`, `lucide-react` |
| Backend | Express 4, Node 20 or later, `tsx` in dev, `esbuild` bundle in production |
| AI | `@google/genai` Interactions API, `gemini-3.8-flash` with a fallback ladder |
| Auth | Firebase Authentication, Google Sign-In only |
| Storage | Cloud Firestore, path isolated per user |
| Calendar | Google Calendar template URLs and RFC 5545 `.ics` files |

### API routes

Every `/api` route is behind Firebase ID token verification.

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `/api/health` | GET | Reports whether a Gemini key is loaded |
| `/api/chat` | POST | Streaming multi-turn reply, server-sent events |
| `/api/entries/:id/close` | POST | Generates the structured digest and persists actions |
| `/api/digest` | POST | Compatibility digest endpoint used as a client-side fallback |
| `/api/patterns` | GET | Insights across recent digests |
| `/api/transcribe` | POST | Voice note transcription |
| `/api/boards/:id/structure` | POST | Clusters brainstorm cards |
| `/api/boards/:id/gaps` | POST | SCAMPER blind-spot pass |

### Model fallback ladder

```js
["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]
```

A recoverable status (429, 500, 503, 404) advances to the next model before any error
reaches the reader. The model that actually answered is recorded on the turn document and
shown in the interface. A Vertex AI route is used ahead of this ladder when
`VERTEX_API_KEY` and a project id are configured.

To exercise the ladder deliberately, set `COMPASS_FORCE_MODEL_FAILURE=true`, or send the
header `x-test-force-503: true` on a single request.

Every generative call site uses this one ladder, via `getFallbackLadder()`. There is no
hardcoded model array anywhere in `server.ts`. The ladder is still open-coded at each call
site rather than routed through one shared helper, which is recorded in the Deviations
section of [`PRODUCTION_DIRECTIVES.md`](./PRODUCTION_DIRECTIVES.md).

---

## Security

### Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Isolation is enforced by these rules independently of application logic. The catch-all
denies everything else.

### Identity

`req.uid` comes from `admin.auth().verifyIdToken()` and from nowhere else. No route reads
a user id from a body, a query parameter or a custom header. Unauthenticated and malformed
requests get a 401 with an empty body, never a 500.

### Conversation context

Multi-turn context is resumed from the `interactionId` stored on the entry document under
the caller's own uid. A value supplied in a request body is not used when the server can
read the entry, so a leaked interaction id cannot be used to resume another person's
conversation.

### Keys

`GEMINI_API_KEY` is read only on the server, from an environment variable populated by
Google Cloud Secret Manager in production. It never enters the client bundle and is not in
the repository.

### About the Firebase web API key

`firebase-applet-config.json` contains a Firebase web API key beginning `AIzaSy`. This is
intentional and is not a leak. A Firebase web API key is a public project identifier that
is designed to ship in the client bundle. It does not grant data access on its own.
Accounts and data are protected by the Firestore rules above, by Firebase Authentication,
and by the authorised domains list, not by keeping this string secret. See
[Google's documentation on this](https://firebase.google.com/docs/projects/api-keys).

So `grep -rn "AIzaSy" .` returns one match, in that config file. It should not return a
match anywhere else, and in particular never for a Gemini key.

---

## Running it locally

Node 20 or later.

```bash
npm install
cp .env.example .env      # then put a real GEMINI_API_KEY in it
npm run dev
```

Open http://localhost:3000.

Before sign-in will work locally, add `localhost` under Firebase Console, Authentication,
Settings, Authorised domains.

The server uses Application Default Credentials for Firestore Admin access. Without them
the app still runs: writes go through the client SDK under the security rules, and the
server logs that it could not confirm ownership. For full server-side behaviour locally,
download a service account key and set `GOOGLE_APPLICATION_CREDENTIALS`.

Production build:

```bash
npm run build
npm start
```

`vite build` emits the frontend to `dist/`, and `esbuild` bundles the server to
`dist/server.cjs`.

---

## Deploying to Cloud Run

```bash
gcloud run deploy compass \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --labels dev-tutorial=cloud-run-ai-challenge \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

Then add the Cloud Run URL to Firebase Authorised domains.

---

## Verifying it

```bash
npm run lint            # tsc --noEmit
npm run build           # vite build plus esbuild server bundle
npm run test:isolation  # authentication and data isolation checks
npm run test:fallback   # model fallback ladder
npm run test:calendar   # calendar template URL and .ics export

cd mcp-server
npm run lint            # tsc --noEmit
npm test                # 49 assertions that no tool argument can select a user
```

`scripts/stress-test.md` lists the manual cases to run by hand before recording a demo.

### Accessibility

Every text and background pair in the palette was measured against WCAG AA in both light
and dark themes. All pass 4.5:1. The tightest pair is muted text on the sunk background in
light mode, at 4.51:1. The gold accent is 2.23:1 on a light ground and is therefore never
used as a text colour; it appears only as a fill with dark ink on top, at 5.74:1. For gold
coloured text the darker `--accent-ink` is used, at 6.58:1.

Mood and theme are never communicated by colour alone.

---

## Evaluation notes

**Authenticity:** five journaling modes each backed by a named method and carrying its own
structure, an Insights view over recent digests, a spatial brainstorm canvas with SCAMPER,
and a separate MCP server. None of this is in the starter template.

**Usability:** Google Sign-In only, first-run starter prompts, drafts that survive reload,
keyboard shortcuts.

**Stability:** model fallback ladder, error boundaries isolating each feature, and a
degradation contract meaning no enhancement can prevent an entry being saved.

**Security:** owner-bound Firestore rules with default deny, server-side token verification
with the uid taken only from the decoded token, and the API key held server-side via Secret
Manager.

Known deviations from the production directives are listed in
[`PRODUCTION_DIRECTIVES.md`](./PRODUCTION_DIRECTIVES.md) rather than omitted.

---

## Provenance

The base application and its initial features were generated in **Google AI Studio**, using
Custom Instructions that carried production security directives. Those instructions are
recorded in [`PRODUCTION_DIRECTIVES.md`](./PRODUCTION_DIRECTIVES.md).

Later work was done in **Claude Code**: the design system and token refactor, the five
modes and their system instructions, the first-run experience, error boundaries and draft
persistence, History and search, Insights, search-grounded Research, the interaction
id ownership fix, and the MCP server.

Neither tool did all of it, and this section should not be edited to suggest otherwise.

---

## Limitations, stated plainly

- **Insights is context-window recall over recent digests, not vector search.** There is no
  embedding index. It reads the summaries of the last twenty closed entries and nothing
  older.
- **Calendar export uses Google Calendar template URLs and `.ics` files.** It does not use
  the Google Calendar API and it does not write to your calendar. You confirm every event
  yourself.
- **Data is isolated per user in Firestore, not processed locally.** Entries leave your
  device. They are stored under your own uid and are not readable by other people using
  Compass, but this is not local-only processing and it is not end-to-end encryption.
- **This is not a clinical or therapeutic tool** and no therapeutic benefit is claimed. The
  crisis protocol points people elsewhere; it does not provide support itself.
- **There is no research or web search feature.** One was built and then removed before
  submission. The Interactions API returns `google_search_result` steps whose payload is
  opaque, so the URLs the search actually retrieved could not be recovered and checked
  against what the model wrote. Showing unverified links, or claiming grounding that was
  not happening, was worse than not having the feature at all.
- **There is no rate limiting yet.** An authenticated user can call the AI endpoints as
  often as they like. This is a cost exposure, not a data exposure.

---

## Repository files

| File | What it is |
| :--- | :--- |
| `server.ts` | Express server, auth middleware, every Gemini route |
| `src/` | React client |
| `firestore.rules` | The deployed security rules |
| `PRODUCTION_DIRECTIVES.md` | The AI Studio Custom Instructions used to generate the base app |
| `THREAT_MODEL.md` | Threats, mitigations, and what is not mitigated |
| `WALKTHROUGHS.md` | Step by step demonstrations, including the isolation proof |
| `scripts/stress-test.md` | Manual cases to run before recording |
| `mcp-server/` | The MCP server, a separate deployable service |

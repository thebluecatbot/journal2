# Submission pack

Everything the form asks for, plus the deploy steps, in the order you need them.

---

## 1. Push to GitHub

The repo is now initialised and committed locally. Nothing secret is in it: `.env` is
ignored, and the only `AIzaSy` string is the Firebase **web** key, which is a public client
identifier by design and is explained in the README.

```bash
cd ~/Downloads/compass
git remote add origin https://github.com/thebluecatbot/journal2.git
git branch -M main
git push -u origin main
```

Then set the repo to **Public** at
`https://github.com/thebluecatbot/journal2/settings`, under Danger Zone, Change visibility.
The form requires public access.

---

## 2. Deploy to Cloud Run

Deploy from your machine, not from AI Studio. AI Studio's own deploy does not give you the
resource label the challenge requires, and it will not pick up the changes made since the
export.

```bash
gcloud auth login
gcloud config set project project-e090d449-585b-495d-8b9
```

Enable what is needed, once:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com
```

Put the Gemini key in Secret Manager. Do not paste it into the deploy command.

```bash
printf 'YOUR_GEMINI_KEY' | gcloud secrets create gemini-api-key --data-file=-
```

If the secret already exists, add a new version instead:

```bash
printf 'YOUR_GEMINI_KEY' | gcloud secrets versions add gemini-api-key --data-file=-
```

Let the Cloud Run runtime service account read it:

```bash
PROJECT_NUMBER=$(gcloud projects describe project-e090d449-585b-495d-8b9 --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Deploy, with the label the challenge checks for:

```bash
gcloud run deploy compass \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --labels dev-tutorial=cloud-run-ai-challenge \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars NODE_ENV=production
```

Confirm the label actually landed:

```bash
gcloud run services describe compass --region asia-south1 --format='value(metadata.labels)'
```

**Then the step everyone forgets.** Copy the Cloud Run URL and add its hostname to Firebase
Console, Authentication, Settings, Authorised domains. Sign-in fails on the deployed app
until you do, and it fails quietly.

Open the URL in a private window and sign in once, to prove it works in production. You do
not have to keep it running after that.

---

## 3. Form fields

### Working Prototype Link
Your Cloud Run URL, from the deploy above. Must start with `https://`.

### Public Code Repository Link
```
https://github.com/thebluecatbot/journal2
```

### Demo Social Post Link
The URL of your LinkedIn or X post. It must carry **#AccelerateAIwithCloudRun** or it does
not count. Draft below.

### Brief Description of Your Solution

Paste this. It is 1010 characters, inside the 1024 limit, and names all four services.

```
Compass is a private journal where a model is called only when you ask for it. Saving and closing an entry contact nothing. Ask Compass and Analyse this entry are the only paths to Gemini.

Firebase Authentication provides Google Sign-In only; no password path exists anywhere in the code. Every /api route verifies the ID token with the Firebase Admin SDK and takes the uid from the decoded token alone, never from a request body or header.

Cloud Firestore holds everything under /users/{uid}, with rules enforcing request.auth.uid == userId plus a default-deny catch-all, so isolation holds independently of application logic.

Gemini runs server-side via the Interactions API. Multi-turn state resumes from an interactionId stored on the caller's own entry. Digests and Insights use structured output schemas behind a fallback ladder that advances on 429, 500, 503 and 404.

Cloud Run hosts the container. GEMINI_API_KEY is mounted from Secret Manager and never reaches the browser bundle.
```

### Services checkboxes

Tick all five:

- [x] **User authentication via Firebase**   Google Sign-In only, `verifyIdToken` on every route
- [x] **Multi-turn interaction with the Gemini API**   Interactions API, `previous_interaction_id` read from the caller's own entry document
- [x] **User-isolated Firestore document storage**   `/users/{uid}/**`, default-deny rules
- [x] **Secure API key retrieval via Google Cloud Secret Manager**   `--set-secrets`, server-side only
- [x] **Others**   mentioned in the description and detailed in the README: five method-backed journalling modes, a spatial brainstorm canvas with SCAMPER, an Insights view, and a separate MCP server

---

## 4. Social post draft

```
Built Compass for the Google Cloud Gen AI Academy: a private journal where the AI
is optional.

Most journalling tools reply to everything you write. Compass does not. Saving an
entry contacts nothing. Closing it contacts nothing. A model runs only when you
press a button that says so.

Five modes, each backed by a real method rather than a tone label: a decision
journal, SCAMPER, the Feynman technique, interstitial logging, and open reflection.
Each one brings its own structure into the composer.

Built with Firebase Auth, Firestore with per-user isolation rules, Gemini via the
Interactions API, and Cloud Run. The API key lives in Secret Manager and never
reaches the browser.

The README documents what it does not do as carefully as what it does, including a
feature I removed because I could not verify its grounding claim.

#AccelerateAIwithCloudRun
```

---

## 5. Evaluation criteria, and where each is earned

| Criterion | Where |
| :--- | :--- |
| **Authenticity** | Five modes each backed by a named method with its own structure and explainer, an Insights view over recent digests, a dump-first brainstorm canvas with AI clustering and a SCAMPER pass, and a separate MCP server. None of it is in the starter template. |
| **Usability** | Google Sign-In only. Drafts survive reload. The composer never clears before a confirmed write. Cmd or Ctrl with Enter to save, Cmd or Ctrl with K for search. Every mode explains itself. |
| **Stability** | Model fallback ladder advancing on 429, 500, 503, 404. A rate limit is a 60 second cooldown, not a permanent latch. Process level guards keep the server up when Firestore Admin credentials are missing. Error boundaries isolate each feature so no enhancement can stop an entry being written. |
| **Security** | Owner-bound Firestore rules with default deny. `uid` only ever from `verifyIdToken`. Multi-turn context resumed from the caller's own document, so a leaked interaction id is useless. Key in Secret Manager, never in the bundle. `THREAT_MODEL.md` lists what is **not** mitigated. |

---

## 6. Pre-submit checklist

- [ ] `git push` done and repo set to **Public**
- [ ] Every README link resolves on GitHub
- [ ] Cloud Run deployed, label confirmed with `describe`
- [ ] Cloud Run hostname added to Firebase Authorised domains
- [ ] Signed in on the deployed URL in a private window
- [ ] Second Google account sees an empty account, proving isolation
- [ ] Social post published with **#AccelerateAIwithCloudRun**
- [ ] Form submitted

---

## 7. Known gaps, stated deliberately

These are in the README already. Do not let a judge find them first.

- **Insights is context-window recall over recent digests**, not vector search. There is no
  embedding index.
- **Calendar export uses template URLs and `.ics` files**, not the Google Calendar API.
  Nothing is written to your calendar.
- **Data is isolated per user in Firestore**, not processed locally and not end-to-end
  encrypted.
- **No rate limiting on the AI endpoints.** A cost exposure, not a data exposure.
- **The research feature was removed**, because the Interactions API returns
  `google_search_result` steps whose payload is opaque, so the grounding check it claimed
  could never actually run.
- **This is not a clinical or therapeutic tool** and no therapeutic benefit is claimed.

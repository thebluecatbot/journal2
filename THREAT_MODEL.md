# Threat Model & Security Architecture for Compass

## 1. Threat Summary Table

| Threat ID | Threat Category | Threat Description | Attack Vector / Scenario | Impact | Mitigation Strategy | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **THREAT-01** | **Secret Exposure** | Direct exposure of `GEMINI_API_KEY` to client browser. | User inspects browser bundle, network traffic, or Git history for API keys. | Unauthorized API consumption, bill shock, token exhaustion. | Gemini calls executed strictly server-side via Express API proxy. Key sourced from env vars/Secret Manager; never bundled in frontend code. | **Mitigated** |
| **THREAT-02** | **Broken Object-Level Authorization (BOLA / IDOR)** | Attacker reads or overwrites another user's journal entries or action items. | Attacker supplies victim's `uid` in URL, body, or direct Firestore requests. | Complete breach of private journal entries, turns, and personal action lists. | Firestore security rules enforce `request.auth.uid == userId` for `/users/{userId}/**`. Server verifies Firebase ID Token (`verifyIdToken`) and extracts `uid` exclusively from verified claims. Never accept `uid` from client request parameters. | **Mitigated** |
| **THREAT-03** | **Identity Spoofing & Session Tampering** | Attacker executes API operations with forged credentials or forged user context. | Client submits modified auth tokens or crafts requests claiming arbitrary UID. | Impersonation of other users, unauthorized entry creation and AI queries. | Every server request is verified with the Firebase Admin SDK via `verifyIdToken(idToken)` in `requireAuth`. Invalid, unverified and expired tokens are rejected with a 401 and an empty body. Note: the `checkRevoked` flag is NOT passed, so a token revoked mid-life stays usable until it expires, at most one hour. | **Mitigated** |
| **THREAT-04** | **Interaction / Context Hijacking** | Malicious reuse or hijacking of Gemini Interactions API `interaction_id`. | Attacker attempts to attach `previous_interaction_id` belonging to another user's entry. | Context leakage across users, state corruption of conversational turns. | The server does not use a client-supplied `previousInteractionId` at all. It reads the `interactionId` from the entry document under the caller's own verified uid, so an id belonging to another account is never attached. When Admin credentials are unavailable the client value is honoured only outside production, for local development. | **Mitigated** |
| **THREAT-05** | **Harmful / Clinical Advice Liability** | Gemini provides medical, psychiatric, or diagnostic advice during emotional journaling. | User journals about mental health crises, symptoms, or medical concerns. | Detrimental reliance on non-clinical advice, breach of medical safety boundaries. | Hardened system instructions: strictly prohibited from diagnosing, prescribing, or giving clinical/medical advice; maintains role as non-judgmental thinking partner (max 3 sentences + 1 open question). | **Mitigated** |
| **THREAT-06** | **Denial of Wallet & Prompt Injection** | Abusive payloads or endless loops inflating Gemini API token consumption. | Attacker floods `/api/turn` or `/api/digest` with massive payloads or rapid automated requests. | Financial exhaustion, service degradation for legitimate users. | Request bodies are capped at 10MB, transcripts are truncated before prompting, and digests are schema validated. There is NO per-user rate limiting yet, so an authenticated user can call the AI endpoints as often as they like. This is a cost exposure, not a data exposure. | **Partially mitigated** |
| **THREAT-07** | **Authentication Bypass & Unauthorized UI Access** | Unauthenticated user viewing dashboard or private journal interface. | Attacker bypasses frontend routing guards or manipulates client state. | Exposure of UI layout or stale cached data. | Single-button Google Auth landing screen gate. Unauthenticated users cannot view dashboard or call APIs. Firestore rejects all unauthenticated reads/writes. | **Mitigated** |

---

## 2. Architecture Overview

### Client (React 19 and Tailwind CSS)
- **Landing State**: Minimalist entry view containing solely a "Sign in with Google" button (via Firebase Auth Google Sign-in popup).
- **Dashboard State**: A single centred column capped at 65ch, with four places to be: Journal, History, Insights and Brainstorm.
  - Analysis never appears beside live writing. The digest with themes, mood, decisions, open questions and next actions renders below the conversation only after the entry is closed. This is a deliberate product constraint, not a layout accident: analysis shown during writing interferes with the cognitive offloading that makes journalling work.
  - An earlier two-column Action Rail component was removed. Its function is served by the post-entry digest panel.
- **Client Protocol**: Communicates exclusively with the application's Express server (`/api/entries/*`, `/api/chat/*`, `/api/digest/*`) sending the Firebase ID Token in `Authorization: Bearer <token>`. Direct Firestore queries use Firebase Client SDK strictly constrained by authenticated user security rules.

### Server (Node.js + Express + Firebase Admin + @google/genai)
- **Authentication Middleware**: Verifies incoming `Authorization: Bearer <token>` using `firebase-admin/auth`. Obtains `uid = decodedToken.uid`. Never reads `uid` from body or query.
- **Gemini Interactions Engine**:
  - Interacts via `@google/genai` using model `gemini-3.8-flash` and `ai.interactions.create`.
  - Maintains multi-turn context via `previous_interaction_id`.
  - Implements five distinct mode stances (Reflect, Decide, Build, Learn, Log) over a shared four-law system instruction, capped at four sentences including the question.
  - Generates structured JSON digests on "Close entry" (themes, mood, decisions, open questions, next actions) and maps them into Firestore.
- **Security Boundary**: Zero client exposure of `GEMINI_API_KEY` or service account private keys.


---

## 3. What is NOT mitigated

Listed so that a reader does not have to find them.

| Gap | Why it is open | Exposure |
| :--- | :--- | :--- |
| No per-user rate limiting on AI endpoints | Not built yet | Cost. An authenticated user can spend the project's Gemini budget. No other user's data is reachable. |
| `checkRevoked` not passed to `verifyIdToken` | Adds a network round trip to every request | A revoked token remains valid until it expires, at most one hour. |
| Firebase web API key is public | By design | None on its own. It is a project identifier, not a credential. Data access is governed by the Firestore rules and the authorised domains list. See the note in `README.md`. |
| No audit log of reads | Not built yet | An operator with Firestore console access can read user entries. Standard for this architecture, and stated in the README rather than described as private-by-local-processing. |
| Prompt injection through journal content | The writer's own text is the input | The model only ever writes back to the same writer. Retrieved web content in `/api/research` is treated strictly as data and its URLs are intersected with what the search actually returned. |

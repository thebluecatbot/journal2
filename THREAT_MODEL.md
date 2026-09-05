# Threat Model & Security Architecture for Compass

## 1. Threat Summary Table

| Threat ID | Threat Category | Threat Description | Attack Vector / Scenario | Impact | Mitigation Strategy | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **THREAT-01** | **Secret Exposure** | Direct exposure of `GEMINI_API_KEY` to client browser. | User inspects browser bundle, network traffic, or Git history for API keys. | Unauthorized API consumption, bill shock, token exhaustion. | Gemini calls executed strictly server-side via Express API proxy. Key sourced from env vars/Secret Manager; never bundled in frontend code. | **Mitigated** |
| **THREAT-02** | **Broken Object-Level Authorization (BOLA / IDOR)** | Attacker reads or overwrites another user's journal entries or action items. | Attacker supplies victim's `uid` in URL, body, or direct Firestore requests. | Complete breach of private journal entries, turns, and personal action lists. | Firestore security rules enforce `request.auth.uid == userId` for `/users/{userId}/**`. Server verifies Firebase ID Token (`verifyIdToken`) and extracts `uid` exclusively from verified claims. Never accept `uid` from client request parameters. | **Mitigated** |
| **THREAT-03** | **Identity Spoofing & Session Tampering** | Attacker executes API operations with forged credentials or forged user context. | Client submits modified auth tokens or crafts requests claiming arbitrary UID. | Impersonation of other users, unauthorized entry creation and AI queries. | Rigorous verification of Firebase ID tokens on every server request via Firebase Admin SDK (`verifyIdToken(idToken, true)`). Rejection of invalid, unverified, or expired tokens. | **Mitigated** |
| **THREAT-04** | **Interaction / Context Hijacking** | Malicious reuse or hijacking of Gemini Interactions API `interaction_id`. | Attacker attempts to attach `previous_interaction_id` belonging to another user's entry. | Context leakage across users, state corruption of conversational turns. | Server validates document ownership in Firestore before reusing or resuming any `interactionId` bound to an `entryId`. | **Mitigated** |
| **THREAT-05** | **Harmful / Clinical Advice Liability** | Gemini provides medical, psychiatric, or diagnostic advice during emotional journaling. | User journals about mental health crises, symptoms, or medical concerns. | Detrimental reliance on non-clinical advice, breach of medical safety boundaries. | Hardened system instructions: strictly prohibited from diagnosing, prescribing, or giving clinical/medical advice; maintains role as non-judgmental thinking partner (max 3 sentences + 1 open question). | **Mitigated** |
| **THREAT-06** | **Denial of Wallet & Prompt Injection** | Abusive payloads or endless loops inflating Gemini API token consumption. | Attacker floods `/api/turn` or `/api/digest` with massive payloads or rapid automated requests. | Financial exhaustion, service degradation for legitimate users. | Server enforces payload length validation, rate-limiting considerations, and strict schema validation for digests. | **Mitigated** |
| **THREAT-07** | **Authentication Bypass & Unauthorized UI Access** | Unauthenticated user viewing dashboard or private journal interface. | Attacker bypasses frontend routing guards or manipulates client state. | Exposure of UI layout or stale cached data. | Single-button Google Auth landing screen gate. Unauthenticated users cannot view dashboard or call APIs. Firestore rejects all unauthenticated reads/writes. | **Mitigated** |

---

## 2. Architecture Overview

### Client (React 19 + Tailwind CSS)
- **Landing State**: Minimalist entry view containing solely a "Sign in with Google" button (via Firebase Auth Google Sign-in popup).
- **Dashboard State**: Two-column layout:
  - Left column (~62% width): Conversation view, free-writing journal input, turn history, and entry status controls.
  - Right column (~38% width): **Action Rail** displaying real-time distilled themes, mood, decisions, open questions, and next actions with completion checkboxes.
- **Client Protocol**: Communicates exclusively with the application's Express server (`/api/entries/*`, `/api/chat/*`, `/api/digest/*`) sending the Firebase ID Token in `Authorization: Bearer <token>`. Direct Firestore queries use Firebase Client SDK strictly constrained by authenticated user security rules.

### Server (Node.js + Express + Firebase Admin + @google/genai)
- **Authentication Middleware**: Verifies incoming `Authorization: Bearer <token>` using `firebase-admin/auth`. Obtains `uid = decodedToken.uid`. Never reads `uid` from body or query.
- **Gemini Interactions Engine**:
  - Interacts via `@google/genai` using model `gemini-3.8-flash` and `ai.interactions.create`.
  - Maintains multi-turn context via `previous_interaction_id`.
  - Implements the strict prompt persona: thinking partner, at most 3 sentences, exactly 1 open question.
  - Generates structured JSON digests on "Close entry" (themes, mood, decisions, open questions, next actions) and maps them into Firestore.
- **Security Boundary**: Zero client exposure of `GEMINI_API_KEY` or service account private keys.

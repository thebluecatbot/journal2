# Compass — AI Reflection Partner & Action Engine

> A private, multi-tenant reflective journaling companion powered by Google Gemini and Firebase. Compass acts as a thoughtful thinking partner during active writing sessions, then automatically distills reflections into structured decisions, next actions, and calendar-ready commitments.

---

## 🧭 Project Overview

Compass is designed for focused, contemplative thinking. Unlike transactional chat interfaces, Compass pairs high-clarity conversation with an **Action Rail** that transforms ambiguous thoughts into concrete forward momentum:

1. **The Thinking Partner**: A real-time conversational partner powered by Gemini 3.8-Flash (with fallback to 3.6-Flash) that helps untangle complex engineering, leadership, and personal reflections.
2. **The Scribe**: When an entry is closed, Gemini analyzes the full transcript using structured output schemas to generate an `EntryDigest` (Themes, Decisions, Next Actions with due dates and effort tiers, Open Questions).
3. **The Action Rail**: An interactive panel displaying extracted insights. Users can check off actions optimistically, export their entire action list as an `.ics` file, or add individual tasks to Google Calendar with a single click (using direct template URLs with zero OAuth).
4. **Zero-Knowledge Multi-Tenant Privacy**: Enforces cryptographic per-request JWT token verification on every `/api` route and row-level Firestore path matching `/users/{uid}/**` with default-deny rules.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies & Libraries |
| :--- | :--- |
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, `motion/react`, `lucide-react` |
| **Backend** | Express 4, Node.js (ESM), `tsx`, `esbuild` |
| **AI / LLM** | `@google/genai` TypeScript SDK (Interactions API), Gemini 3.8-Flash & 3.6-Flash |
| **Authentication** | Firebase Authentication (Google Sign-In with client popup & server token verification) |
| **Data Storage** | Google Cloud Firestore (path-isolated `/users/{uid}/**`, default-deny rules) |
| **Calendar Sync** | Google Calendar Template URLs (RFC 5545 compatible, zero OAuth, zero consent screens) |

---

## 🔒 Security & Privacy Posture

Compass was built adhering to strict pre-submission security standards:

- **Zero Hardcoded Secrets**: All Gemini API keys remain strictly server-side (`process.env.GEMINI_API_KEY`). Running `grep -r "AIzaSy" .` yields zero matches.
- **Token-Bound Identity**: No client can claim an arbitrary `userId`. The backend extracts and validates the user ID exclusively via `getAuth().verifyIdToken(token)` inside `requireAuth` middleware.
- **Firestore Security Rules**: Strict row-level isolation rules ensure users can only read and write within their own subpath `/users/{uid}/**`. Default catch-all denies all other traffic (`allow read, write: if false`).
- **Resilient Fallback Ladder**: The Scribe and Chat pipelines step down gracefully through `["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]`. If upstream AI services encounter degradation or quota limits, entries still close safely with an empty valid digest.
- **Sanitized Persistence**: Undefined values are recursively stripped prior to every Firestore write, preventing database driver rejections.

---

## ⚡ Key Features

### 1. The Reflective Conversation
- Minimalist editorial interface inspired by traditional fine print typography (Newsreader paired with Plus Jakarta Sans).
- Keyboard shortcuts (`Ctrl+Enter` or `Cmd+Enter` to submit, `Shift+Enter` for multi-line formatting).
- Real-time token streaming with automatic fallback error suppression.

### 2. The Scribe (`POST /api/entries/:id/close`)
- Structured JSON output conforming to the required `EntryDigest` schema:
  - **Themes**: High-level semantic topics.
  - **Decisions**: Explicit boundaries and commitments, with rationales and review dates.
  - **Next Actions**: Actionable tasks with relative/ISO due date normalization and effort tiers (`quick`, `medium`, `deep`).
  - **Open Questions**: Unresolved philosophical and strategic inquiries.
- Server-side and client-side non-blocking fallbacks ensure that no network error or rate limit can ever prevent a journal entry from closing.

### 3. The Action Rail
- **Ordered Sections**: Themes (chips) $\rightarrow$ Decisions $\rightarrow$ Next Actions $\rightarrow$ Open Questions.
- **Zero-OAuth Google Calendar Integration**: 1-click "Add to calendar" opens prefilled Google Calendar template URLs with 30-minute timeblocks without permissions or tokens.
- **iCalendar (.ics) Export**: Generates an RFC 5545 `.ics` file for the entire next action list with one click.
- **Optimistic Checkbox Updates**: Instant local checkmark toggling with automated rollback and inline notification if Firestore synchronization fails.
- **Motion & Accessibility**: 40ms entry stagger, $\le$ 200ms total transition duration, and full compliance with `prefers-reduced-motion`.
- **Responsive Stacking**: Stacks vertically below 900px without hiding behind drawers or tabs.

---

## 🧪 Verification & Audit Commands

Run the test suites directly from the project root:

```bash
# 1. Action Rail Unit & Integration Tests (30 tests)
npm run test:rail

# 2. Authentication & Data Isolation Audit
npm run test:isolation

# 3. Model Fallback Ladder & Degradation Simulation
npm run test:fallback

# 4. Type Checking & Linter
npm run lint

# 5. Production Compilation
npm run build

# 6. Verify Zero Hardcoded Keys
grep -rn "AIzaSy" . --exclude-dir=node_modules --exclude-dir=.git
```

---

## 📝 Submission Form Entries (Ready to Copy)

### Project Title
**Compass — AI Reflection Partner & Action Engine**

### Tagline (1 sentence)
A privacy-first reflective journaling companion that helps untangle complex thoughts and turns reflections into structured decisions and calendar-ready commitments.

### Problem Statement (100–150 words)
Knowledge workers, leaders, and creators often use journaling to process ambiguity and make tough decisions. However, traditional journals suffer from two major shortcomings: passive blank pages that offer no constructive feedback, and the "journal graveyard" problem where valuable insights, firm choices, and tasks remain trapped in unstructured text blocks. Users need an active, intelligent thinking partner that engages constructively during reflection and automatically extracts concrete, actionable next steps without cluttering their workflow or requiring complex productivity tooling.

### Proposed Solution & Description (200–250 words)
Compass bridges the gap between contemplative reflection and concrete action:
- **Reflective Thinking Partner**: Utilizes Gemini 3.8-Flash on the server via the Interactions API to ask probing, clarifying questions that help users explore their rationale and identify root causes.
- **The Scribe**: Upon closing an entry, Gemini parses the entire conversation transcript using strict structured JSON schemas to catalogue key themes, trade-offs, firm decisions with review dates, and next actions with normalized due dates.
- **The Action Rail**: Insights appear in an accessible, low-latency rail alongside the conversation. Next actions can be exported as an `.ics` file or scheduled directly to Google Calendar using zero-permission template URLs.
- **Privacy & Multi-Tenancy**: Built with strict row-level Firestore rules and cryptographic token validation, ensuring that personal thoughts remain completely private to each authenticated Google account.

### Technologies Used
- Google Gemini 3.8-Flash & 3.6-Flash (`@google/genai` Interactions API)
- Google Cloud Run (Containerized deployment)
- Firebase Authentication & Google Cloud Firestore
- React 18, TypeScript, Tailwind CSS, Motion
- Express 4, Node.js, Vite

### Security & Privacy Highlights
- Strict per-request Bearer token authentication verified via Firebase Admin SDK.
- Zero client-side API keys (`grep -r "AIzaSy" .` clean).
- Firestore security rules strictly enforced (`request.auth.uid == userId`) with default-deny rules.
- Fallback ladder prevents user lock-out or lost reflections even under model service disruption.

---

## 🚀 Deployment Checklist

- [x] Version frozen and tagged: `git tag -a v1.0-submittable -m "Deployed, tested, submittable version"`
- [x] Clean zero-match verification for `AIzaSy` across all tracked files
- [x] All 30 Action Rail test suite assertions passing
- [x] All Firestore isolation matrix checks passing
- [x] Build and compile verified: `npm run build` cleanly exits with code 0

# Compass MCP server

An MCP server exposing the Compass journal as read-mostly tools, scoped per user by a
verified Firebase token.

That sentence is the whole claim. This is not multi-agent orchestration and it is not an
ADK system. It is an HTTP service that verifies a token, derives a uid, and reads that
one person's Firestore subtree.

It is a **separate service**. It does not share a process, a container or a Cloud Run
revision with the web app, so it cannot take the journal down.

---

## Tools

| Tool | Reads or writes | What it does |
| :--- | :--- | :--- |
| `search_entries(query?, limit?)` | read | Matching closed entries with their dates, titles, moods, themes, questions and actions. Digest level only. |
| `get_entry(entry_id)` | read | One entry in full, including its conversation turns. |
| `list_open_actions(overdue_only?)` | read | Actions not yet done, with age in days. |
| `complete_action(action_id)` | write | Marks one action done. The only write on the server. |
| `list_decisions(since?)` | read | Decisions with the rationale given and any review date. |
| `list_unresolved_questions()` | read | Questions no later entry records a decision about. |

`search_entries` returns titles and digests, never the raw text of what somebody wrote.
Full text is reachable only through `get_entry`, one entry at a time.

No tool deletes anything. There is no tool that can.

---

## Authentication

Every request carries `Authorization: Bearer <firebase-id-token>`. The token is verified
with the Firebase Admin SDK, exactly as the main API does it, and the uid comes out of the
verified claims.

Authentication runs **before any method is dispatched**, including `initialize` and
`tools/list`. An unauthenticated caller does not learn the tool surface. A failed
verification returns a JSON-RPC error with HTTP 401 and never returns data.

Rate limited per uid, defaulting to 60 requests per minute. Set `MCP_RATE_LIMIT` to change
it. It is an in-memory limiter in a single container, not a distributed one.

**Logging records the tool name and the uid, and nothing else.** Never arguments, never
results. Both contain private journal content.

---

## Self-audit: can any tool argument influence which user's data is read?

**No.** Here is the code path that makes it impossible.

**1. The uid is derived before dispatch, from the header only.** In `src/index.ts`:

```ts
uid = await uidFromAuthHeader(req.headers.authorization);
checkRateLimit(uid);
```

This runs before the `method` is examined. There is no earlier branch that reads
`req.body`, and nothing later reassigns `uid`.

**2. The only source of a uid is a verified token.** In `src/auth.ts`:

```ts
const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
return decoded.uid;
```

`uidFromAuthHeader` has one `return`, and it returns `decoded.uid`. Every other path
throws.

**3. The uid is passed outside the tool arguments.** In `src/index.ts`:

```ts
const result = await tool.handler(uid, params?.arguments || {});
```

`uid` is the first parameter and `params.arguments` is the second. Whatever a caller puts
in `arguments` lands in the second slot and cannot overwrite the first. There is no merge,
no spread, no `Object.assign` between them.

**4. Every query is rooted at that uid.** In `src/tools.ts`:

```ts
function userRoot(uid: string) {
  return db().collection("users").doc(uid);
}
```

`db().collection(` appears exactly once in the file, inside this function. Every handler
begins from `userRoot(uid)`. No handler builds a path from a string, and no handler takes
a collection or document name as an argument.

**5. No schema can name a user.** Every `inputSchema` sets
`additionalProperties: false` and declares no field resembling a user, uid, owner,
account, tenant, path, collection or document, at any depth.

**6. An id from another account is not an oracle.** `get_entry` and `complete_action` look
their id up under `userRoot(uid)`. An id belonging to someone else does not exist at that
path, so the answer is "No such entry", identical to the answer for an id that does not
exist at all. Existence is not leaked.

**7. The database enforces it again anyway.** Even if all of the above were bypassed, the
Firestore rules in `firestore.rules` deny any access outside `/users/{uid}`.

### Proving it

```bash
npm test
```

`src/isolation.test.ts` runs 49 assertions covering each point above. It works statically
on the schemas and the handler source, which is deliberate: this is a structural property,
and reading the structure proves it better than probing a running service and hoping the
probe was exhaustive.

Live checks, with the server running:

```bash
# No token: an MCP error, never data. The tool surface is not disclosed either.
curl -s -X POST localhost:8080/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Missing bearer token."}}

# An invalid token, with a uid injected into the arguments for good measure.
curl -s -X POST localhost:8080/mcp -H "Content-Type: application/json" \
  -H "Authorization: Bearer fake.token.here" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_entries","arguments":{"uid":"victim","userId":"victim","query":"x"}}}'
# {"jsonrpc":"2.0","id":2,"error":{"code":-32001,"message":"Invalid or expired token."}}
```

With a **valid** token belonging to account A and `{"uid":"B"}` in the arguments, the
result is account A's entries. The injected field is not read by anything and is rejected
by `additionalProperties: false`.

---

## Running it

```bash
cd mcp-server
npm install
cp .env.example .env
npm run dev
```

Listens on `PORT`, defaulting to 8080. `GET /health` is the only unauthenticated route and
reports nothing about any user.

For Firestore access locally, either set `GOOGLE_APPLICATION_CREDENTIALS` to a service
account file, or put the JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`. On Cloud Run, leave both
unset and let the service account provide Application Default Credentials.

---

## Connecting an MCP client

Transport is HTTP. The endpoint is `POST /mcp`, speaking JSON-RPC 2.0.

You need a Firebase ID token for the account whose journal you want to read. Get one by
signing in to Compass and running this in the browser console:

```js
await firebase.auth().currentUser.getIdToken()
```

Or, in the running app, from the module it already imports:

```js
// The app exposes this through src/lib/firebase.ts
await getIdToken()
```

**These tokens expire after one hour.** That is a Firebase property, not a limitation of
this server. A client that needs a long-lived connection has to refresh the token itself.

### Claude Desktop or Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "compass-journal": {
      "type": "http",
      "url": "https://YOUR-MCP-SERVICE.run.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_FIREBASE_ID_TOKEN"
      }
    }
  }
}
```

For a local server use `http://localhost:8080/mcp`.

### A raw call, to check the wiring

```bash
TOKEN="your-firebase-id-token"

curl -s -X POST localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq

curl -s -X POST localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_open_actions","arguments":{"overdue_only":true}}}' | jq
```

---

## Deploying

```bash
./deploy.sh
```

Deploys as its own Cloud Run service, `compass-mcp` by default, carrying the
`dev-tutorial=cloud-run-ai-challenge` label. Override with the `PROJECT_ID`, `REGION`,
`SERVICE` and `SA` environment variables.

The service is deployed with `--allow-unauthenticated` at the Cloud Run layer because it
does its own authentication: every request must carry a valid Firebase ID token, verified
here. Cloud Run IAM would gate on Google identities, which is not the identity this
service cares about.

Give it a dedicated service account with Firestore access and nothing else. Do not use the
default compute service account.

---

## What this is not

- Not multi-agent orchestration.
- Not an ADK system.
- Not a search index. `search_entries` is a substring match over digest fields, done in
  memory over the most recent 200 entries.
- `list_unresolved_questions` matches on keyword overlap between a question and later
  decisions. It is a prompt to go and look, not a proof that something is unresolved. The
  tool description says so to the model as well as to you.

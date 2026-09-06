/**
 * Isolation test for the MCP tool surface.
 *
 * The question this answers: can any tool argument, in any combination, influence which
 * user's data is read?
 *
 * It works statically, on the schemas and on the source of the handlers, so it needs no
 * credentials and no Firestore emulator. That is deliberate: the property being tested is
 * structural, and a structural property is better proved by reading the structure than by
 * probing a running service and hoping the probe was exhaustive.
 *
 * Run with: npm test
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TOOLS } from "./tools";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsRaw = readFileSync(path.join(here, "tools.ts"), "utf8");
const indexRaw = readFileSync(path.join(here, "index.ts"), "utf8");
const authRaw = readFileSync(path.join(here, "auth.ts"), "utf8");

/**
 * Structural checks must read code, not prose. The files document their own security
 * properties, so a comment saying `db().collection("users").doc(uid)` would otherwise be
 * counted as a second rooting call and fail a check that is actually satisfied.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const toolsSource = stripComments(toolsRaw);
const indexSource = stripComments(indexRaw);
const authSource = stripComments(authRaw);

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${label}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

console.log("\n=== 1. No tool schema can name a user ===\n");

// Every spelling an attacker or a careless future edit might reach for.
const FORBIDDEN = [
  "uid",
  "userid",
  "user_id",
  "user",
  "owner",
  "owner_id",
  "account",
  "account_id",
  "accountid",
  "sub",
  "email",
  "path",
  "collection",
  "document",
  "doc",
  "db",
  "database",
  "as_user",
  "on_behalf_of",
  "impersonate",
  "tenant",
];

for (const tool of TOOLS) {
  const props = Object.keys(tool.inputSchema.properties || {});
  const offending = props.filter((p) => FORBIDDEN.includes(p.toLowerCase().replace(/[^a-z_]/g, "")));
  check(
    offending.length === 0,
    `${tool.name} declares no user-selecting property`,
    offending.length ? `found: ${offending.join(", ")}` : ""
  );

  check(
    tool.inputSchema.additionalProperties === false,
    `${tool.name} rejects unknown properties`,
    "additionalProperties must be false, or an undeclared field could be smuggled through"
  );

  // A nested object could hide a user field below the top level.
  const serialised = JSON.stringify(tool.inputSchema).toLowerCase();
  const nestedHits = FORBIDDEN.filter((f) => serialised.includes(`"${f}"`));
  check(
    nestedHits.length === 0,
    `${tool.name} has no user-selecting property at any depth`,
    nestedHits.length ? `found: ${nestedHits.join(", ")}` : ""
  );
}

console.log("\n=== 2. Every query is rooted at the verified uid ===\n");

check(
  /function userRoot\(uid: string\)\s*\{\s*return db\(\)\.collection\("users"\)\.doc\(uid\);/.test(toolsSource),
  "userRoot is the single rooting helper and takes uid"
);

// Any collection() call in tools.ts must either be the one inside userRoot, or be chained
// off userRoot(uid). A bare db().collection(...) anywhere else would escape the scope.
const dbCollectionCalls = [...toolsSource.matchAll(/db\(\)\.collection\(/g)];
check(
  dbCollectionCalls.length === 1,
  "db().collection appears exactly once, inside userRoot",
  `found ${dbCollectionCalls.length} occurrences`
);

const handlerBodies = toolsSource.split("handler: async").slice(1);
for (let i = 0; i < handlerBodies.length; i += 1) {
  const body = handlerBodies[i];
  const name = TOOLS[i]?.name || `handler ${i}`;
  const reads = [...body.matchAll(/(userRoot\(|db\(\))/g)].map((m) => m[1]);
  check(
    reads.length > 0 && reads.every((r) => r === "userRoot("),
    `${name} reaches Firestore only through userRoot(uid)`,
    `found: ${reads.join(", ") || "no Firestore access"}`
  );
  check(
    /userRoot\(uid\)/.test(body) || reads.length === 0,
    `${name} passes the verified uid, not any other value`
  );
}

console.log("\n=== 3. The uid comes only from a verified token ===\n");

check(
  /verifyIdToken\(token\)/.test(authSource),
  "auth.ts verifies the bearer token with the Admin SDK"
);
check(
  !/req\.(body|query|params)\s*[.\[]\s*['"]?(uid|userId|user_id)/.test(indexSource),
  "index.ts never reads a user id from the request body, query or params"
);
check(
  !/headers\[['"]x-(user|uid)/i.test(indexSource),
  "index.ts never reads a user id from a custom header"
);
check(
  /tool\.handler\(uid, params\?\.arguments \|\| \{\}\)/.test(indexSource),
  "the uid is passed to handlers as a separate argument, outside the tool arguments"
);
check(
  /uid = await uidFromAuthHeader\(req\.headers\.authorization\)/.test(indexSource),
  "the uid is derived from the Authorization header before any method is dispatched"
);

console.log("\n=== 4. Unauthenticated calls return an error, never data ===\n");

const authBlock = indexSource.slice(
  indexSource.indexOf("let uid: string;"),
  indexSource.indexOf('if (method === "initialize")')
);
check(
  /return res\.status\(401\)\.json\(rpcError\(/.test(authBlock),
  "a failed verification returns a JSON-RPC error with status 401"
);
check(
  !/rpcResult/.test(authBlock),
  "no result is ever returned from the authentication block"
);
check(
  indexSource.indexOf("uid = await uidFromAuthHeader") < indexSource.indexOf('method === "tools/list"'),
  "even tools/list is behind authentication, so the tool surface is not public"
);

console.log("\n=== 5. Read-mostly, and no deletes ===\n");

const mutations = [...toolsSource.matchAll(/\.(set|update|delete|create|add)\(/g)].map((m) => m[1]);
check(
  mutations.every((m) => m === "update"),
  "the only Firestore mutation verb used is update",
  `found: ${[...new Set(mutations)].join(", ") || "none"}`
);
check(mutations.length === 1, "there is exactly one mutation in the whole tool surface", `found ${mutations.length}`);
check(!/\.delete\(/.test(toolsSource), "no tool deletes anything");

const writingTools = TOOLS.filter((t) => /complete|update|set|write|delete/i.test(t.name));
check(
  writingTools.length === 1 && writingTools[0].name === "complete_action",
  "complete_action is the only tool that writes"
);

console.log("\n=== 6. search_entries does not return raw journal text ===\n");

const searchBody = toolsSource.slice(
  toolsSource.indexOf('name: "search_entries"'),
  toolsSource.indexOf('name: "get_entry"')
);
check(
  !/collection\("turns"\)/.test(searchBody),
  "search_entries never reads the turns subcollection"
);
check(
  /collection\("turns"\)/.test(toolsSource.slice(toolsSource.indexOf('name: "get_entry"'))),
  "get_entry is the tool that reads turns, as documented"
);

console.log("\n=== 7. Logging does not record content ===\n");

check(
  /function log\(uid: string, tool: string, outcome/.test(indexSource),
  "the log function accepts only a uid, a tool name and an outcome"
);
check(
  !/console\.log\([^)]*params/.test(indexSource) && !/console\.log\([^)]*arguments/.test(indexSource),
  "arguments are never logged"
);
check(
  !/console\.log\([^)]*result/.test(indexSource),
  "results are never logged"
);

console.log("\n================================================================");
if (failed === 0) {
  console.log(`ALL ${passed} MCP ISOLATION TESTS PASSED.`);
  console.log("No tool argument, at any depth, can influence which user's data is read.");
} else {
  console.log(`${failed} TEST(S) FAILED. ${passed} passed.`);
}
console.log("================================================================\n");

process.exit(failed === 0 ? 0 : 1);

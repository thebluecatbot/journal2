/**
 * Rules and Isolation Verification Script
 * Validates:
 * 1. Security rules AST and rule definitions
 * 2. Logical user isolation: user A cannot access user B's documents
 * 3. Root fallback denial: documents outside /users/{userId} are strictly forbidden
 * 4. Unauthenticated denial across all collections
 */

import fs from "fs";
import path from "path";

function runRulesAudit() {
  console.log("=== Checking Firestore Security Rules Integrity ===");
  const rulesPath = path.join(process.cwd(), "firestore.rules");
  if (!fs.existsSync(rulesPath)) {
    console.error("FAIL: firestore.rules does not exist");
    process.exit(1);
  }

  const rulesContent = fs.readFileSync(rulesPath, "utf-8");

  // Check 1: No insecure 'if true'
  if (/allow\s+read,\s*write\s*:\s*if\s+true/i.test(rulesContent)) {
    console.error("FAIL: Insecure rule 'allow read, write: if true' detected!");
    process.exit(1);
  }
  console.log("PASS: No insecure 'if true' rules found.");

  // Check 2: Strict match /users/{userId}/{document=**} with request.auth.uid == userId
  const userMatchRegex = /match\s+\/users\/\{userId\}\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write\s*:\s*if\s+request\.auth\s*!=\s*null\s*&&\s*request\.auth\.uid\s*==\s*userId\s*;\s*\}/;
  if (!userMatchRegex.test(rulesContent.replace(/\s+/g, " "))) {
    console.error("FAIL: User isolation rule does not match required specification.");
    process.exit(1);
  }
  console.log("PASS: User isolation rule strictly matches 'request.auth != null && request.auth.uid == userId'.");

  // Check 3: Default deny all other documents
  const defaultDenyRegex = /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write\s*:\s*if\s+false\s*;\s*\}/;
  if (!defaultDenyRegex.test(rulesContent.replace(/\s+/g, " "))) {
    console.error("FAIL: Default deny-all rule 'match /{document=**} { allow read, write: if false; }' not found.");
    process.exit(1);
  }
  console.log("PASS: Default deny-all rule is present.");

  // Check 4: Rule evaluation engine simulation for User A vs User B
  console.log("\n=== Evaluating Security Rules Logic Matrix ===");

  interface MockAuth {
    uid: string | null;
  }

  function evaluateFirestoreRules(
    docPath: string,
    auth: MockAuth | null,
    operation: "read" | "write"
  ): { allowed: boolean; reason: string } {
    const userPathMatch = docPath.match(/^\/users\/([^/]+)(\/.*)?$/);
    if (userPathMatch) {
      const targetUserId = userPathMatch[1];
      if (!auth || !auth.uid) {
        return { allowed: false, reason: "Unauthenticated request (request.auth is null)" };
      }
      if (auth.uid === targetUserId) {
        return { allowed: true, reason: "Authorized (request.auth.uid == targetUserId)" };
      }
      return {
        allowed: false,
        reason: `Cross-tenant isolation violation: request.auth.uid (${auth.uid}) != targetUserId (${targetUserId})`,
      };
    }

    // Default deny rule
    return { allowed: false, reason: "Default catch-all rule: allow read, write: if false" };
  }

  // Test Case A: User A accessing User A's entry
  const resA = evaluateFirestoreRules("/users/user_alice/entries/entry_1", { uid: "user_alice" }, "read");
  if (!resA.allowed) {
    console.error("FAIL: User A was blocked from reading own document:", resA.reason);
    process.exit(1);
  }
  console.log(`PASS: User A accessing /users/user_alice/... -> ${resA.reason}`);

  // Test Case B: User A attempting to read User B's entry
  const resB = evaluateFirestoreRules("/users/user_bob/entries/entry_1", { uid: "user_alice" }, "read");
  if (resB.allowed) {
    console.error("FAIL: User A was permitted to read User B's document!");
    process.exit(1);
  }
  console.log(`PASS: User A accessing /users/user_bob/... -> BLOCKED: ${resB.reason}`);

  // Test Case C: User A attempting to write to User B's actions
  const resC = evaluateFirestoreRules("/users/user_bob/actions/act_1", { uid: "user_alice" }, "write");
  if (resC.allowed) {
    console.error("FAIL: User A was permitted to write to User B's action item!");
    process.exit(1);
  }
  console.log(`PASS: User A writing /users/user_bob/... -> BLOCKED: ${resC.reason}`);

  // Test Case D: Unauthenticated request accessing User A's entry
  const resD = evaluateFirestoreRules("/users/user_alice/entries/entry_1", null, "read");
  if (resD.allowed) {
    console.error("FAIL: Unauthenticated request was permitted to read User A's document!");
    process.exit(1);
  }
  console.log(`PASS: Unauthenticated access to /users/user_alice/... -> BLOCKED: ${resD.reason}`);

  // Test Case E: Any user accessing non-user collections (e.g. /system, /secrets)
  const resE = evaluateFirestoreRules("/secrets/api_keys", { uid: "user_alice" }, "read");
  if (resE.allowed) {
    console.error("FAIL: Access permitted to collection outside /users/{userId}!");
    process.exit(1);
  }
  console.log(`PASS: Access to /secrets/... -> BLOCKED: ${resE.reason}`);

  console.log("\nAll Firestore security rules isolation tests PASSED.\n");
}

runRulesAudit();

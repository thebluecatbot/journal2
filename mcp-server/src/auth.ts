import { initializeApp, getApps, cert, applicationDefault, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "project-e090d449-585b-495d-8b9";
const DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || "ai-studio-compass-c30e6245-09d5-4235-8adc-d4c50e6ddca0";

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;
  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0]!;
    return adminApp;
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  adminApp = initializeApp({
    projectId: PROJECT_ID,
    credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
  });
  return adminApp;
}

export function db(): Firestore {
  return getFirestore(getAdminApp(), DATABASE_ID);
}

/**
 * The whole security model of this server in one function.
 *
 * A caller presents a Firebase ID token. It is verified with the Admin SDK, exactly as
 * the main API does it, and the uid comes out of the verified claims. That uid is the
 * only thing that ever scopes a query.
 *
 * There is deliberately no code path that accepts a user id from anywhere else: not a
 * tool argument, not a header, not a query string. See `tools.ts`, where every schema is
 * declared without a user field.
 */
export async function uidFromAuthHeader(header: string | undefined): Promise<string> {
  if (!header || !header.startsWith("Bearer ")) {
    throw new AuthError("Missing bearer token.");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new AuthError("Missing bearer token.");

  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    return decoded.uid;
  } catch {
    // Never leak why. An invalid token and an expired token look the same from outside.
    throw new AuthError("Invalid or expired token.");
  }
}

export class AuthError extends Error {}

// --- Rate limiting -----------------------------------------------------------
// Per uid, in memory. A single container is the deployment target, so this is enough to
// stop one account hammering Firestore. It is not a distributed limiter.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.MCP_RATE_LIMIT || 60);
const hits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(uid: string): void {
  const now = Date.now();
  const entry = hits.get(uid);
  if (!entry || now > entry.resetAt) {
    hits.set(uid, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) {
    throw new RateLimitError(`Rate limit exceeded. Try again in ${Math.ceil((entry.resetAt - now) / 1000)}s.`);
  }
}

export class RateLimitError extends Error {}

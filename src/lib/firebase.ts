import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, Firestore, doc, getDocFromServer } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const resolveApiKey = (): string => {
  const cfg = firebaseConfig as any;
  if (cfg.apiKey) return cfg.apiKey;
  if (cfg.apiKeyEncoded) {
    try {
      return typeof window !== "undefined" && window.atob
        ? window.atob(cfg.apiKeyEncoded)
        : Buffer.from(cfg.apiKeyEncoded, "base64").toString("utf-8");
    } catch {
      return "";
    }
  }
  return "";
};

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp({
    apiKey: resolveApiKey(),
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
} else {
  app = getApp();
}

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

// Initialize Firestore with configured databaseId or default
export const db: Firestore = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Test connection as required by Firebase skill guidelines
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firestore connection check: client is offline or starting up.");
    }
  }
}

testConnection();

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    console.error("Google Sign-In error:", error);
    throw error;
  }
}

export async function logOut() {
  await signOut(auth);
}

export async function getIdToken(): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  return currentUser.getIdToken();
}

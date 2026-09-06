import React, { useState } from "react";
import { signInWithGoogle } from "../lib/firebase";
import { CompassMark } from "./CompassMark";

interface LandingPageProps {
  onSignInSuccess?: () => void;
}

/**
 * Signed out. Product name, one sentence saying what it does, one button.
 * No feature grid, no testimonials, no gradient hero.
 */
export const LandingPage: React.FC<LandingPageProps> = ({ onSignInSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      onSignInSuccess?.();
    } catch (err: any) {
      console.error("Sign in failed:", err);
      if (err?.code === "auth/popup-closed-by-user") {
        setError("The sign-in window closed before it finished. Try again when you are ready.");
      } else if (err?.code === "auth/popup-blocked") {
        setError("Your browser blocked the sign-in window. Allow popups for this page, then try again.");
      } else if (err?.code === "auth/unauthorized-domain") {
        setError("This domain is not authorised for sign-in yet. Add it under Firebase Authentication settings.");
      } else {
        setError("Sign-in did not complete. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--s6) var(--s5)",
        background: "var(--bg)",
      }}
    >
      <div style={{ maxWidth: "34rem", width: "100%", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
          <CompassMark size={28} />
          <span
            style={{
              fontFamily: "var(--font-user)",
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: "var(--text)",
            }}
          >
            Compass
          </span>
        </div>

        <p
          style={{
            fontFamily: "var(--font-user)",
            fontSize: 21,
            lineHeight: 1.6,
            color: "var(--text)",
            marginTop: "var(--s5)",
            marginBottom: "var(--s7)",
            maxWidth: "32rem",
          }}
        >
          Think out loud. Compass turns what you wrote into what you decided, what you are still
          unsure about, and what to do next.
        </p>

        <button
          id="google-signin-button"
          className="btn btn-primary"
          onClick={handleSignIn}
          disabled={loading}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>{loading ? "Signing in" : "Sign in with Google"}</span>
        </button>

        {error && (
          <p
            role="alert"
            style={{
              fontFamily: "var(--font-ai)",
              fontSize: 14,
              color: "var(--danger)",
              marginTop: "var(--s4)",
              maxWidth: "30rem",
              lineHeight: 1.6,
            }}
          >
            {error}
          </p>
        )}

        <p
          className="chrome"
          style={{ marginTop: "var(--s7)", fontSize: 13, lineHeight: 1.6, maxWidth: "30rem" }}
        >
          Your entries are stored in your own space and are not readable by other people using
          Compass. It is a journal, not a clinical or therapeutic tool.
        </p>
      </div>
    </main>
  );
};

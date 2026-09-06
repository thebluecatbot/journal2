import React, { useState } from "react";
import { signInWithGoogle } from "../lib/firebase";

interface LandingPageProps {
  onSignInSuccess?: () => void;
}

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
      // If popup was blocked or closed by user, show a brief subtle note
      if (err.code === "auth/popup-closed-by-user") {
        setError("Sign-in cancelled. Please try again.");
      } else if (err.code === "auth/popup-blocked") {
        setError("Popup was blocked by your browser. Please allow popups for this page.");
      } else {
        setError(err.message || "Unable to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 select-none bg-[var(--bg)] text-[var(--text)]">
      <div className="flex flex-col items-center max-w-sm w-full space-y-8 text-center">
        {/* Minimal Compass Brand Mark */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-sm bg-[var(--accent)]">
            <div className="w-1.5 h-5 rotate-45 rounded-full bg-[var(--text)]" />
          </div>
          <span className="text-3xl font-medium tracking-tight italic font-user text-[var(--text)]">
            Compass
          </span>
        </div>

        {/* Single "Sign in with Google" button - strictly adhering to constraint */}
        <div className="w-full flex flex-col items-center gap-3 pt-2">
          <button
            id="google-signin-button"
            onClick={handleSignIn}
            disabled={loading}
            className="w-full max-w-xs flex items-center justify-center gap-3 px-6 py-3.5 rounded-full text-sm font-medium font-ai transition-all shadow-sm active:scale-[0.99] disabled:opacity-50 cursor-pointer bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-sunk)]"
          >
            {/* Google G Logo SVG */}
            <svg className="w-4 h-4" viewBox="0 0 24 24">
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
            <span>{loading ? "Signing in..." : "Sign in with Google"}</span>
          </button>

          {error && (
            <p className="text-xs font-medium mt-2 max-w-xs font-ai text-[var(--danger)]">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
};

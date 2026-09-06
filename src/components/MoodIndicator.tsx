import React from "react";

/**
 * Mood is never communicated by colour alone. The word is always present, and the
 * bar is a redundant cue for people who read shape faster than text.
 */
const LEVELS: Record<string, { label: string; steps: number }> = {
  low: { label: "Low", steps: 1 },
  flat: { label: "Flat", steps: 2 },
  steady: { label: "Steady", steps: 3 },
  good: { label: "Good", steps: 4 },
  high: { label: "High", steps: 5 },
};

export const MoodIndicator: React.FC<{ mood: string; compact?: boolean }> = ({ mood, compact }) => {
  const level = LEVELS[String(mood || "").toLowerCase()] || LEVELS.steady;

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--s2)" }}
      title={`Mood: ${level.label}`}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", gap: 2 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: compact ? 10 : 12,
              borderRadius: 2,
              background: i <= level.steps ? "var(--accent)" : "var(--border)",
            }}
          />
        ))}
      </span>
      <span
        style={{
          fontFamily: "var(--font-ai)",
          fontSize: compact ? 12 : 13,
          color: "var(--text-muted)",
        }}
      >
        {compact ? level.label : `Mood: ${level.label}`}
      </span>
    </span>
  );
};

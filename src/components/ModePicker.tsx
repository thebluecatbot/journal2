import React from "react";
import { MODES, ModeId, getMode } from "../lib/modes";

interface ModePickerProps {
  value: ModeId;
  onChange: (mode: ModeId) => void;
  disabled?: boolean;
  guideOpen: boolean;
  onToggleGuide: () => void;
}

/**
 * A quiet segmented control. Changing the mode affects the next turn only, so
 * switching mid-entry never rewrites what has already been said.
 *
 * The information button is always present. Switching mode opens the explainer, which
 * is dismissible, so nobody has to guess what a mode does from its name alone.
 */
export const ModePicker: React.FC<ModePickerProps> = ({
  value,
  onChange,
  disabled,
  guideOpen,
  onToggleGuide,
}) => {
  const active = getMode(value);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", flexWrap: "wrap" }}>
        <div
          role="radiogroup"
          aria-label="Journal mode"
          style={{
            display: "inline-flex",
            gap: "var(--s1)",
            padding: "var(--s1)",
            background: "var(--bg-sunk)",
            borderRadius: "var(--radius)",
            flexWrap: "wrap",
          }}
        >
          {MODES.map((mode) => {
            const isActive = mode.id === value;
            return (
              <button
                key={mode.id}
                role="radio"
                aria-checked={isActive}
                disabled={disabled}
                onClick={() => onChange(mode.id)}
                title={`${mode.label}: ${mode.method}`}
                style={{
                  fontFamily: "var(--font-ai)",
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  padding: "var(--s2) var(--s3)",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  minHeight: 32,
                  cursor: disabled ? "default" : "pointer",
                  background: isActive ? "var(--surface)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  opacity: disabled ? 0.5 : 1,
                  transition: "background-color var(--dur) var(--ease), color var(--dur) var(--ease)",
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={onToggleGuide}
          aria-expanded={guideOpen}
          aria-label={`What ${active.label} mode is and when to use it`}
          title={`What ${active.label} mode is and when to use it`}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "1px solid var(--border)",
            background: guideOpen ? "var(--accent-soft)" : "transparent",
            color: "var(--accent-ink)",
            cursor: "pointer",
            fontFamily: "var(--font-ai)",
            fontSize: 13,
            fontWeight: 600,
            fontStyle: "italic",
            lineHeight: 1,
            padding: 0,
            flexShrink: 0,
          }}
        >
          i
        </button>
      </div>

      {/* The method name, so the mode is never just a friendly word. */}
      <p className="chrome" style={{ fontSize: 13, marginTop: "var(--s2)" }}>
        {active.blurb} <span style={{ color: "var(--accent-ink)" }}>{active.method}</span>
      </p>
    </div>
  );
};

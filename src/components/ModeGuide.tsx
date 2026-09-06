import React from "react";
import { ModeDefinition } from "../lib/modes";

interface ModeGuideProps {
  mode: ModeDefinition;
  onDismiss: () => void;
  /** Drops the mode's scaffold into the composer. Absent for Reflect, which has none. */
  onUseScaffold?: () => void;
}

const heading: React.CSSProperties = {
  fontFamily: "var(--font-ai)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  marginBottom: "var(--s2)",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--s2)",
};

const itemStyle: React.CSSProperties = {
  fontFamily: "var(--font-ai)",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text)",
  paddingLeft: "var(--s4)",
  position: "relative",
};

/**
 * What this mode is, when to use it, and how.
 *
 * Shown on every mode switch and dismissible, because a name on a button teaches
 * nobody anything and an unexplained mode never gets used.
 */
export const ModeGuide: React.FC<ModeGuideProps> = ({ mode, onDismiss, onUseScaffold }) => {
  return (
    <section
      aria-label={`About ${mode.label} mode`}
      className="rise"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "var(--s5)",
        marginTop: "var(--s4)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--s4)",
          marginBottom: "var(--s4)",
        }}
      >
        <div>
          <p style={heading}>{mode.method}</p>
          <p
            style={{
              fontFamily: "var(--font-ai)",
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--text)",
              maxWidth: "56ch",
            }}
          >
            {mode.what}
          </p>
        </div>
        <button
          className="btn btn-quiet"
          style={{ fontSize: 13, flexShrink: 0, minHeight: 0, padding: "var(--s1) var(--s2)" }}
          onClick={onDismiss}
          aria-label="Dismiss explanation"
        >
          Dismiss
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "var(--s5)",
        }}
      >
        <div>
          <p style={heading}>Use it when</p>
          <ul style={listStyle}>
            {mode.when.map((line) => (
              <li key={line} style={itemStyle}>
                <span aria-hidden="true" style={{ position: "absolute", left: 0, color: "var(--accent-ink)" }}>
                  &middot;
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p style={heading}>How it works</p>
          <ol style={{ ...listStyle, counterReset: "step" }}>
            {mode.how.map((line, i) => (
              <li key={line} style={itemStyle}>
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    color: "var(--accent-ink)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {i + 1}.
                </span>
                {line}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {onUseScaffold && (
        <div style={{ marginTop: "var(--s5)", display: "flex", gap: "var(--s3)", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" style={{ fontSize: 14 }} onClick={onUseScaffold}>
            Start with the {mode.label} structure
          </button>
        </div>
      )}
    </section>
  );
};

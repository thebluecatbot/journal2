import React, { useEffect, useRef, useState } from "react";
import { VoiceComposer } from "./VoiceComposer";

interface IdeaDumpProps {
  /** Called with one string per non-empty line. */
  onAdd: (ideas: string[]) => void;
  onCancel?: () => void;
  /** True when the board has nothing on it yet, which changes the copy only. */
  firstDump: boolean;
}

/**
 * Dump first, organise later.
 *
 * This replaces a floating popup that covered the board and accepted one card at a
 * time. A brain dump works by getting everything out without stopping to place it, so
 * this takes many ideas at once, one per line, by typing or speaking, and nothing is
 * sent anywhere until you press the button.
 */
export const IdeaDump: React.FC<IdeaDumpProps> = ({ onAdd, onCancel, firstDump }) => {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);

  const commit = () => {
    if (lines.length === 0) return;
    onAdd(lines);
    setText("");
    ref.current?.focus();
  };

  const handleTranscript = (transcript: string) => {
    setText((prev) => (prev.trim() ? `${prev.replace(/\n+$/, "")}\n${transcript}` : transcript));
    window.setTimeout(() => ref.current?.focus(), 50);
  };

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "var(--s5)",
        maxWidth: "44rem",
        width: "100%",
      }}
    >
      <p className="eyebrow" style={{ marginBottom: "var(--s2)" }}>
        {firstDump ? "Brain dump" : "Add more"}
      </p>
      <p
        className="font-ai"
        style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-muted)", marginBottom: "var(--s4)", maxWidth: "52ch" }}
      >
        {firstDump
          ? "Get everything out first. One idea per line, no order, no editing. Grouping comes after."
          : "One idea per line."}
      </p>

      <VoiceComposer onTranscriptReady={handleTranscript} isThinking={false}>
        {({ isRecording, micSupported, startRecording }) => (
          <>
            <label htmlFor="idea-dump" className="sr-only">
              Ideas, one per line
            </label>
            <textarea
              id="idea-dump"
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter makes a new line, because the whole point is many lines.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commit();
                }
              }}
              rows={8}
              placeholder={"pricing feels arbitrary\nnobody actually asked for tiers\nwhat if there were no plans at all"}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--s3)",
                outline: "none",
                resize: "vertical",
                fontFamily: "var(--font-user)",
                fontSize: 18,
                lineHeight: 1.7,
                color: "var(--text)",
                minHeight: "10rem",
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--s3)",
                marginTop: "var(--s3)",
                flexWrap: "wrap",
              }}
            >
              <span className="chrome" style={{ fontSize: 13 }} aria-live="polite">
                {lines.length === 0
                  ? "One idea per line"
                  : lines.length === 1
                    ? "1 card"
                    : `${lines.length} cards`}
              </span>
              <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
                {micSupported && !isRecording && (
                  <button type="button" className="btn btn-quiet" style={{ fontSize: 14 }} onClick={startRecording}>
                    Speak them
                  </button>
                )}
                {onCancel && (
                  <button className="btn btn-quiet" style={{ fontSize: 14 }} onClick={onCancel}>
                    Cancel
                  </button>
                )}
                <button className="btn btn-primary" style={{ fontSize: 14 }} onClick={commit} disabled={lines.length === 0}>
                  {lines.length <= 1 ? "Add to board" : `Add ${lines.length} cards`}
                </button>
              </div>
            </div>
          </>
        )}
      </VoiceComposer>
    </section>
  );
};

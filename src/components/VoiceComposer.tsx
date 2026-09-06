import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  playEarcon,
  checkMicrophoneSupport,
  VoiceAudioCapture,
  blobToBase64,
} from "../lib/audioRecorder";
import { transcribeAudioApi } from "../lib/api";

interface VoiceComposerProps {
  onTranscriptReady: (transcript: string) => void;
  isThinking: boolean;
  disabled?: boolean;
  children?: (props: {
    isRecording: boolean;
    isTranscribing: boolean;
    micSupported: boolean;
    startRecording: () => void;
    stopRecording: () => void;
  }) => React.ReactNode;
}

export const VoiceComposer: React.FC<VoiceComposerProps> = ({
  onTranscriptReady,
  isThinking,
  disabled = false,
  children,
}) => {
  const [micSupported, setMicSupported] = useState<boolean>(true);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [amplitudeBars, setAmplitudeBars] = useState<number[]>(new Array(16).fill(4));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const [transcribeNotice, setTranscribeNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const captureRef = useRef<VoiceAudioCapture | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // Check microphone support and permissions on mount (Degraded Mode check)
  useEffect(() => {
    checkMicrophoneSupport().then((supported) => {
      setMicSupported(supported);
    });

    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, []);

  // Waveform animation loop driven by real amplitude from AnalyserNode
  const updateWaveform = useCallback(() => {
    if (!captureRef.current || prefersReducedMotion) return;

    const bars = captureRef.current.getAmplitudeBins(16);
    setAmplitudeBars(bars);
    animFrameRef.current = requestAnimationFrame(updateWaveform);
  }, [prefersReducedMotion]);

  const handleStartRecording = async () => {
    if (disabled || isThinking || isRecording || isTranscribing) return;
    setErrorMessage(null);
    setTranscribeNotice(null);

    try {
      const capture = new VoiceAudioCapture();
      await capture.start();
      captureRef.current = capture;

      // Earcon on start
      playEarcon("start");

      setIsRecording(true);
      setDuration(0);

      // Start duration counter
      timerRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      // Start live waveform loop
      if (!prefersReducedMotion) {
        animFrameRef.current = requestAnimationFrame(updateWaveform);
      }
    } catch (err: any) {
      console.warn("[VoiceComposer] Microphone error:", err);
      // Degraded mode: if permission was denied, hide mic button
      if (
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError" ||
        err.message?.includes("Permission denied")
      ) {
        setMicSupported(false);
      } else {
        setErrorMessage("Microphone access could not be established.");
      }
    }
  };

  const handleStopRecording = async () => {
    if (!captureRef.current || !isRecording) return;

    // Earcon on stop
    playEarcon("stop");

    // Clear timers and animation frames
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    setIsRecording(false);
    setIsTranscribing(true);

    try {
      const { blob, mimeType } = await captureRef.current.stop();
      captureRef.current = null;

      const base64Audio = await blobToBase64(blob);

      // Send to server for transcription
      const { transcript } = await transcribeAudioApi(base64Audio, mimeType);

      if (transcript && transcript.trim()) {
        onTranscriptReady(transcript.trim());
        setTranscribeNotice("Voice transcribed into composer. Review and edit before sending.");
      } else {
        setErrorMessage("No clear speech was detected. Please try speaking again.");
      }
    } catch (err: any) {
      console.warn("[VoiceComposer] Transcription error:", err);
      setErrorMessage("Could not transcribe voice thought. Please try again or type directly.");
    } finally {
      setIsTranscribing(false);
      setDuration(0);
      setAmplitudeBars(new Array(16).fill(4));
    }
  };

  const handleCancelRecording = () => {
    if (captureRef.current) {
      captureRef.current.cancel();
      captureRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsRecording(false);
    setIsTranscribing(false);
    setDuration(0);
    setAmplitudeBars(new Array(16).fill(4));
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // DEGRADED MODE: if the browser denies mic access or does not support it, the voice
  // affordance disappears entirely rather than offering something that cannot work.
  if (!micSupported) {
    return null;
  }

  // Recording is a state the writer is in, so it reads as a shift of ground rather
  // than a coloured alert. Gold is used as a fill, never as text.
  const noticeStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--s3)",
    padding: "var(--s2) var(--s3)",
    borderRadius: "var(--radius)",
    marginBottom: "var(--s3)",
    fontFamily: "var(--font-ai)",
    fontSize: 13,
  };

  return (
    <div style={{ width: "100%" }}>
      {isRecording && (
        <div
          id="voice-recording-floor"
          role="region"
          aria-label="Recording"
          style={{
            marginBottom: "var(--s3)",
            padding: "var(--s4)",
            borderRadius: "var(--radius)",
            background: "var(--accent-soft)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--s3)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--s2)" }}>
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: 4, background: "var(--accent-ink)" }}
              />
              <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
                Recording
              </span>
              <span className="chrome" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                {formatTime(duration)}
              </span>
            </span>

            <span style={{ display: "flex", gap: "var(--s2)" }}>
              <button
                type="button"
                id="voice-cancel-button"
                className="btn btn-quiet"
                style={{ fontSize: 13 }}
                onClick={handleCancelRecording}
              >
                Cancel
              </button>
              <button
                type="button"
                id="voice-finish-speaking-button"
                className="btn btn-primary"
                style={{ fontSize: 13, padding: "var(--s2) var(--s4)" }}
                onClick={handleStopRecording}
              >
                Finish
              </button>
            </span>
          </div>

          <div
            style={{
              marginTop: "var(--s3)",
              paddingTop: "var(--s3)",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "center",
            }}
          >
            {prefersReducedMotion ? (
              <span className="chrome" style={{ fontSize: 13 }}>
                Listening. {formatTime(duration)} so far.
              </span>
            ) : (
              <div
                aria-hidden="true"
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  gap: 3,
                  height: 32,
                  width: "100%",
                  maxWidth: "20rem",
                }}
              >
                {amplitudeBars.map((height, idx) => (
                  <div
                    key={idx}
                    style={{
                      width: 5,
                      borderRadius: 2,
                      background: "var(--accent-ink)",
                      height: `${Math.max(height, 4)}px`,
                      transition: "height 75ms linear",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isTranscribing && (
        <div id="voice-transcribing-banner" style={{ ...noticeStyle, background: "var(--bg-sunk)" }} aria-live="polite">
          <span style={{ color: "var(--text)" }}>Turning that into text</span>
          <span className="chrome" style={{ fontSize: 13 }}>
            The audio goes to your own server, not to another service
          </span>
        </div>
      )}

      {transcribeNotice && (
        <div id="voice-transcript-notice" style={{ ...noticeStyle, background: "var(--ai-ground)" }} role="status">
          <span style={{ color: "var(--text)" }}>{transcribeNotice}</span>
          <button
            type="button"
            className="btn btn-quiet"
            style={{ fontSize: 13, minHeight: 0, padding: "var(--s1) var(--s2)" }}
            onClick={() => setTranscribeNotice(null)}
            aria-label="Dismiss transcript notice"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          id="voice-error-notice"
          style={{ ...noticeStyle, background: "var(--danger-soft)", border: "1px solid var(--danger)" }}
          role="alert"
        >
          <span style={{ color: "var(--danger)" }}>{errorMessage}</span>
          <button
            type="button"
            className="btn btn-quiet"
            style={{ fontSize: 13, minHeight: 0, padding: "var(--s1) var(--s2)" }}
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {children
        ? children({
            isRecording,
            isTranscribing,
            micSupported,
            startRecording: handleStartRecording,
            stopRecording: handleStopRecording,
          })
        : !isRecording && (
            <button
              type="button"
              id="voice-mic-trigger-button"
              className="btn btn-secondary"
              style={{ fontSize: 14 }}
              onClick={handleStartRecording}
              disabled={disabled || isThinking || isTranscribing}
            >
              Voice
            </button>
          )}
    </div>
  );
};

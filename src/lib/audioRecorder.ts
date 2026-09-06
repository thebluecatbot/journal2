/**
 * Audio Recording and Web Audio Analyser utilities for Compass
 * Implements:
 * - Soft earcons on record start and stop via Web Audio API oscillators
 * - Real-time amplitude analysis with AnalyserNode for live waveforms
 * - Degraded mode detection when microphone permissions are denied
 * - WebM/Opus audio capture and Base64 conversion
 */

export function playEarcon(type: "start" | "stop"): void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";

    if (type === "start") {
      // Soft ascending chime: 440Hz -> 587.33Hz (D5) over 120ms
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.12);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.19);
    } else {
      // Soft resolving chime: 587.33Hz -> 440Hz (A4) over 140ms
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.14);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.21);
    }

    // Clean up audio context
    setTimeout(() => {
      try {
        ctx.close();
      } catch {
        // ignore
      }
    }, 300);
  } catch {
    // AudioContext blocked or not allowed, ignore gracefully
  }
}

export async function checkMicrophoneSupport(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }

  try {
    if (navigator.permissions?.query) {
      const permissionStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (permissionStatus.state === "denied") {
        return false;
      }
    }
    return true;
  } catch {
    // Some browsers don't support querying microphone permission, assume supported
    return true;
  }
}

export class VoiceAudioCapture {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private audioChunks: Blob[] = [];
  private mimeType: string = "audio/webm;codecs=opus";

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public async start(): Promise<void> {
    this.audioChunks = [];

    // Request audio stream with browser speech optimizations
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Setup Web Audio AnalyserNode for real-time amplitude tracking
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume();
        }
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 64; // 32 frequency bins, quick response
        this.analyser.smoothingTimeConstant = 0.4; // Responsive, not laggy
        source.connect(this.analyser);
      }
    } catch (e) {
      console.warn("[VoiceCapture] Analyser initialization error:", e);
    }

    // Select supported mimeType
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        this.mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        this.mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        this.mimeType = "audio/mp4";
      } else {
        this.mimeType = "";
      }

      const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100); // 100ms timeslice for steady chunk accumulation
    } else {
      throw new Error("MediaRecorder is not supported in this browser.");
    }
  }

  public getAmplitudeBins(barCount: number = 14): number[] {
    if (!this.analyser) {
      return new Array(barCount).fill(4);
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const step = Math.max(1, Math.floor(bufferLength / barCount));
    const bars: number[] = [];

    for (let i = 0; i < barCount; i++) {
      const idx = Math.min(i * step, bufferLength - 1);
      const rawVal = dataArray[idx] || 0;
      // Map 0-255 to normalized amplitude height (4px min to 28px max)
      const height = Math.max(4, Math.min(28, Math.round((rawVal / 255) * 28)));
      bars.push(height);
    }

    return bars;
  }

  public stop(): Promise<{ blob: Blob; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.cleanup();
        reject(new Error("MediaRecorder is not recording."));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const finalBlob = new Blob(this.audioChunks, {
          type: this.mimeType || "audio/webm",
        });
        const recordedMime = this.mimeType || "audio/webm";
        this.cleanup();
        resolve({ blob: finalBlob, mimeType: recordedMime });
      };

      this.mediaRecorder.stop();
    });
  }

  public cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }
    this.analyser = null;
    this.audioChunks = [];
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        // Strip data URL scheme (e.g. data:audio/webm;base64,)
        const base64 = reader.result.split(",")[1] || "";
        resolve(base64);
      } else {
        reject(new Error("Failed to convert audio Blob to base64."));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

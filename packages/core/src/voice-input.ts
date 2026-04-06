// ============================================================================
// Voice-to-Code — OpenAI Whisper API integration.
// Based on Aider's voice.py implementation pattern.
// ============================================================================

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

/** Maximum file size the Whisper API accepts (25 MB). */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export interface VoiceInputConfig {
  /** Whisper model to use. Default: "whisper-1". */
  whisperModel?: string;
  /** BCP-47 language code (e.g. "en"). Auto-detect if omitted. */
  language?: string;
  /** OpenAI API key (or Anthropic key if routing through a proxy). */
  apiKey: string;
  /** Maximum recording duration accepted. Default: 60 seconds. */
  maxDurationSeconds?: number;
}

export interface VoiceTranscription {
  text: string;
  language: string;
  durationSeconds: number;
  confidence?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFormDataEntry(
  body: FormData,
  config: VoiceInputConfig,
  filename: string,
  blob: Blob,
): void {
  body.append("model", config.whisperModel ?? "whisper-1");
  body.append("file", blob, filename);
  body.append("response_format", "verbose_json");
  if (config.language) {
    body.append("language", config.language);
  }
}

async function callWhisperApi(body: FormData, apiKey: string): Promise<VoiceTranscription> {
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(no body)");
    throw new Error(`Whisper API error ${response.status}: ${errText}`);
  }

  const json = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ avg_logprob?: number }>;
  };

  const text = json.text ?? "";
  const language = json.language ?? "unknown";
  const durationSeconds = json.duration ?? 0;

  // Derive a rough confidence from segment avg log-prob if available
  let confidence: number | undefined;
  if (Array.isArray(json.segments) && json.segments.length > 0) {
    const avgLogprob =
      json.segments.reduce((acc, s) => acc + (s.avg_logprob ?? 0), 0) / json.segments.length;
    // Log-prob is typically in [-1, 0] range; convert to [0, 1]
    confidence = Math.max(0, Math.min(1, 1 + avgLogprob));
  }

  return { text, language, durationSeconds, confidence };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Transcribe an audio file (WAV / MP3 / WebM / OGG / MP4) using the OpenAI
 * Whisper API.  The VS Code extension captures audio and sends the file path
 * here.
 *
 * @throws if the file exceeds 25 MB (Whisper API limit).
 * @throws on network or API errors.
 */
export async function transcribeAudio(
  audioFilePath: string,
  config: VoiceInputConfig,
): Promise<VoiceTranscription> {
  // Guard: file size
  const stats = await stat(audioFilePath);
  if (stats.size > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio file is ${(stats.size / 1024 / 1024).toFixed(1)} MB, which exceeds the ` +
        `Whisper API limit of 25 MB. Please shorten the recording or use a more aggressive ` +
        `compression codec (e.g. Opus at 16 kHz).`,
    );
  }

  const filename = basename(audioFilePath);
  const mimeType = mimeFromFilename(filename);

  // Read file into a Blob so we can append it to FormData
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(audioFilePath);
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const buffer = Buffer.concat(chunks);
  const bufSlice = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const blob = new Blob([bufSlice as ArrayBuffer], { type: mimeType });

  const body = new FormData();
  buildFormDataEntry(body, config, filename, blob);

  return callWhisperApi(body, config.apiKey);
}

/**
 * Transcribe raw audio bytes using the OpenAI Whisper API.
 * Useful when audio is captured in memory (e.g. in the VS Code webview's
 * MediaRecorder API).
 *
 * @throws on network or API errors.
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: "audio/wav" | "audio/webm" | "audio/ogg" | "audio/mp4",
  config: VoiceInputConfig,
): Promise<VoiceTranscription> {
  if (audioBuffer.byteLength > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio buffer is ${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)} MB, which exceeds ` +
        `the Whisper API 25 MB limit.`,
    );
  }

  const ext = extensionFromMime(mimeType);
  const abSlice = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
  const blob = new Blob([abSlice as ArrayBuffer], { type: mimeType });

  const body = new FormData();
  buildFormDataEntry(body, config, `recording.${ext}`, blob);

  return callWhisperApi(body, config.apiKey);
}

// ─── Internal utilities ──────────────────────────────────────────────────────

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    webm: "audio/webm",
    ogg: "audio/ogg",
    mp4: "audio/mp4",
    m4a: "audio/mp4",
    flac: "audio/flac",
  };
  return map[ext] ?? "audio/wav";
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
  };
  return map[mime] ?? "wav";
}

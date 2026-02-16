/**
 * ElevenLabs TTS Service
 * 
 * Provides text-to-speech synthesis with viseme (lip sync) data generation.
 * Uses the ElevenLabs API for high-quality voice synthesis and generates
 * phoneme-to-viseme mappings for 3D avatar lip synchronization.
 */
import axios from "axios";

// ─── Types ───────────────────────────────────────────────────────────

export type TTSVoice = {
  voiceId: string;
  name: string;
  language: string;
};

export type VisemeTimestamp = {
  time: number;       // Time in milliseconds from audio start
  visemeIndex: number; // MPEG-4 viseme index (0-21)
  phoneme: string;    // Source phoneme
  duration: number;   // Duration of this viseme in ms
};

export type TTSResult = {
  audioBuffer: Buffer;
  audioUrl?: string;
  contentType: string;
  visemeTimeline: VisemeTimestamp[];
  duration: number;   // Total duration in ms
  text: string;
};

export type TTSStreamChunk = {
  audioChunk: Buffer;
  visemeTimestamps: VisemeTimestamp[];
  text: string;
  isFinal: boolean;
  chunkIndex: number;
};

// ─── Phoneme to Viseme Mapping (MPEG-4 Standard) ─────────────────────
// Based on the MPEG-4 Facial Animation standard
// Maps IPA phonemes to viseme indices for lip sync

const PHONEME_TO_VISEME: Record<string, number> = {
  // Silence
  "sil": 0, "sp": 0, "": 0,
  // Bilabial: p, b, m
  "p": 1, "b": 1, "m": 1,
  // Labiodental: f, v
  "f": 2, "v": 2,
  // Dental/Alveolar: θ, ð (th)
  "T": 3, "D": 3, "θ": 3, "ð": 3,
  // Alveolar: t, d, s, z, n, l
  "t": 4, "d": 4, "s": 4, "z": 4, "n": 4, "l": 4,
  // Postalveolar: ʃ, ʒ, tʃ, dʒ
  "S": 5, "Z": 5, "tS": 5, "dZ": 5, "ʃ": 5, "ʒ": 5,
  // Velar: k, g, ŋ
  "k": 6, "g": 6, "N": 6, "ŋ": 6,
  // Glottal: h
  "h": 7,
  // Approximants: r, w, j
  "r": 8, "w": 9, "j": 10,
  // Vowels - open
  "a": 11, "A": 11, "æ": 11, "ɑ": 11, "aɪ": 11,
  // Vowels - mid
  "e": 12, "E": 12, "ɛ": 12, "eɪ": 12,
  // Vowels - close front
  "i": 13, "I": 13, "ɪ": 13,
  // Vowels - close back rounded
  "o": 14, "O": 14, "ɔ": 14, "oʊ": 14,
  // Vowels - close back
  "u": 15, "U": 15, "ʊ": 15,
  // Schwa
  "@": 16, "ə": 16, "ʌ": 16,
  // Diphthongs
  "aU": 17, "aʊ": 17,
  "OI": 18, "ɔɪ": 18,
  // Chinese specific phonemes
  "x": 7, "q": 6, "zh": 5, "ch": 5, "sh": 5,
  "ü": 15, "iu": 15, "ou": 14, "ao": 17,
  "ai": 11, "ei": 12, "an": 11, "en": 12,
  "ang": 11, "eng": 12, "ing": 13, "ong": 14,
};

// Default viseme durations (ms) based on phoneme type
const VISEME_DURATIONS: Record<number, number> = {
  0: 80,   // Silence
  1: 90,   // Bilabial
  2: 80,   // Labiodental
  3: 70,   // Dental
  4: 60,   // Alveolar
  5: 70,   // Postalveolar
  6: 60,   // Velar
  7: 50,   // Glottal
  8: 60,   // r
  9: 70,   // w
  10: 60,  // j
  11: 100, // Open vowel
  12: 90,  // Mid vowel
  13: 80,  // Close front
  14: 90,  // Close back rounded
  15: 80,  // Close back
  16: 70,  // Schwa
  17: 110, // Diphthong
  18: 110, // Diphthong
};

// ─── ElevenLabs API Client ──────────────────────────────────────────

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY environment variable is not set");
  }
  return key;
}

/**
 * List available voices from ElevenLabs
 */
export async function listVoices(): Promise<TTSVoice[]> {
  try {
    const response = await axios.get(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: { "xi-api-key": getApiKey() },
      timeout: 10000,
    });

    return (response.data.voices || []).map((v: any) => ({
      voiceId: v.voice_id,
      name: v.name,
      language: v.labels?.language || "en",
    }));
  } catch (error) {
    console.error("[TTS] Failed to list voices:", error);
    throw error;
  }
}

/**
 * Validate the ElevenLabs API key by making a lightweight request
 */
export async function validateApiKey(): Promise<boolean> {
  try {
    const response = await axios.get(`${ELEVENLABS_BASE_URL}/user`, {
      headers: { "xi-api-key": getApiKey() },
      timeout: 10000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Synthesize speech from text using ElevenLabs API
 * Returns audio buffer and generates viseme timeline for lip sync
 */
export async function synthesizeSpeech(
  text: string,
  options: {
    voiceId?: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
    language?: string;
  } = {}
): Promise<TTSResult> {
  const {
    voiceId = "21m00Tcm4TlvDq8ikWAM", // Rachel (default)
    modelId = "eleven_multilingual_v2",
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0.0,
    speakerBoost = true,
  } = options;

  try {
    // Request audio with timestamps for alignment
    const response = await axios.post(
      `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}/with-timestamps`,
      {
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: speakerBoost,
        },
      },
      {
        headers: {
          "xi-api-key": getApiKey(),
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const data = response.data;

    // Extract audio (base64 encoded)
    const audioBuffer = Buffer.from(data.audio_base64, "base64");

    // Generate viseme timeline from alignment data
    const visemeTimeline = generateVisemeTimeline(data.alignment, text);

    // Estimate total duration from alignment or audio
    const duration = visemeTimeline.length > 0
      ? visemeTimeline[visemeTimeline.length - 1].time + visemeTimeline[visemeTimeline.length - 1].duration
      : estimateDuration(text);

    return {
      audioBuffer,
      contentType: "audio/mpeg",
      visemeTimeline,
      duration,
      text,
    };
  } catch (error: any) {
    // Fallback: try without timestamps
    if (error.response?.status === 422 || error.response?.status === 400) {
      console.warn("[TTS] Timestamps not available, falling back to basic synthesis");
      return synthesizeSpeechBasic(text, { voiceId, modelId, stability, similarityBoost });
    }
    console.error("[TTS] Synthesis failed:", error.message);
    throw error;
  }
}

/**
 * Basic speech synthesis without alignment timestamps
 * Generates estimated viseme timeline from text analysis
 */
async function synthesizeSpeechBasic(
  text: string,
  options: {
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
  }
): Promise<TTSResult> {
  const response = await axios.post(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${options.voiceId}`,
    {
      text,
      model_id: options.modelId,
      voice_settings: {
        stability: options.stability,
        similarity_boost: options.similarityBoost,
      },
    },
    {
      headers: {
        "xi-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
      timeout: 30000,
    }
  );

  const audioBuffer = Buffer.from(response.data);
  const duration = estimateDuration(text);
  const visemeTimeline = generateEstimatedVisemeTimeline(text, duration);

  return {
    audioBuffer,
    contentType: "audio/mpeg",
    visemeTimeline,
    duration,
    text,
  };
}

/**
 * Stream speech synthesis for real-time playback
 * Yields audio chunks with corresponding viseme data
 */
export async function synthesizeSpeechStream(
  text: string,
  options: {
    voiceId?: string;
    modelId?: string;
    onChunk?: (chunk: TTSStreamChunk) => void;
    abortSignal?: AbortSignal;
  } = {}
): Promise<TTSResult> {
  const {
    voiceId = "21m00Tcm4TlvDq8ikWAM",
    modelId = "eleven_multilingual_v2",
    onChunk,
    abortSignal,
  } = options;

  // For streaming, we split text into sentences and process each
  const sentences = splitIntoSentences(text);
  const allChunks: Buffer[] = [];
  const allVisemes: VisemeTimestamp[] = [];
  let totalDuration = 0;
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (abortSignal?.aborted) break;
    if (!sentence.trim()) continue;

    try {
      const result = await synthesizeSpeech(sentence, { voiceId, modelId });

      // Offset viseme timestamps by accumulated duration
      const offsetVisemes = result.visemeTimeline.map(v => ({
        ...v,
        time: v.time + totalDuration,
      }));

      allChunks.push(result.audioBuffer);
      allVisemes.push(...offsetVisemes);

      if (onChunk) {
        onChunk({
          audioChunk: result.audioBuffer,
          visemeTimestamps: offsetVisemes,
          text: sentence,
          isFinal: chunkIndex === sentences.length - 1,
          chunkIndex,
        });
      }

      totalDuration += result.duration;
      chunkIndex++;
    } catch (error) {
      console.error(`[TTS] Failed to synthesize sentence: "${sentence}"`, error);
      // Continue with next sentence
    }
  }

  return {
    audioBuffer: Buffer.concat(allChunks),
    contentType: "audio/mpeg",
    visemeTimeline: allVisemes,
    duration: totalDuration,
    text,
  };
}

// ─── Viseme Generation ──────────────────────────────────────────────

/**
 * Generate viseme timeline from ElevenLabs alignment data
 */
function generateVisemeTimeline(
  alignment: any,
  text: string
): VisemeTimestamp[] {
  if (!alignment || !alignment.characters) {
    return generateEstimatedVisemeTimeline(text, estimateDuration(text));
  }

  const visemes: VisemeTimestamp[] = [];
  const chars = alignment.characters || [];
  const charStartTimes = alignment.character_start_times_seconds || [];
  const charEndTimes = alignment.character_end_times_seconds || [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const startTime = (charStartTimes[i] || 0) * 1000; // Convert to ms
    const endTime = (charEndTimes[i] || startTime + 0.05) * 1000;

    const phoneme = charToPhoneme(char);
    const visemeIndex = PHONEME_TO_VISEME[phoneme] ?? 0;

    // Merge consecutive same visemes
    const lastViseme = visemes[visemes.length - 1];
    if (lastViseme && lastViseme.visemeIndex === visemeIndex && startTime - (lastViseme.time + lastViseme.duration) < 20) {
      lastViseme.duration = endTime - lastViseme.time;
    } else {
      visemes.push({
        time: Math.round(startTime),
        visemeIndex,
        phoneme,
        duration: Math.round(endTime - startTime),
      });
    }
  }

  return visemes;
}

/**
 * Generate estimated viseme timeline from text when alignment data is unavailable
 * Uses character-level analysis and average speaking rate
 */
function generateEstimatedVisemeTimeline(text: string, totalDuration: number): VisemeTimestamp[] {
  const visemes: VisemeTimestamp[] = [];
  const chars = text.replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, "").split("");

  if (chars.length === 0) return visemes;

  const timePerChar = totalDuration / chars.length;
  let currentTime = 0;

  for (const char of chars) {
    const phoneme = charToPhoneme(char);
    const visemeIndex = PHONEME_TO_VISEME[phoneme] ?? 0;
    const duration = VISEME_DURATIONS[visemeIndex] || 70;

    visemes.push({
      time: Math.round(currentTime),
      visemeIndex,
      phoneme,
      duration: Math.min(Math.round(duration), Math.round(timePerChar)),
    });

    currentTime += timePerChar;
  }

  return visemes;
}

/**
 * Map a character to its approximate phoneme
 */
function charToPhoneme(char: string): string {
  const c = char.toLowerCase();

  // Chinese characters → approximate mouth shapes
  if (/[\u4e00-\u9fff]/.test(c)) {
    // Map common Chinese finals to visemes
    const chineseVisemeMap: Record<string, string> = {};
    // For Chinese, we cycle through common mouth shapes
    const codePoint = c.charCodeAt(0);
    const shapes = ["a", "o", "e", "i", "u", "ü", "ai", "ei", "ao", "ou", "an", "en"];
    return shapes[codePoint % shapes.length];
  }

  // Latin characters
  const vowels = "aeiou";
  if (vowels.includes(c)) return c;

  // Consonant mappings
  const consonantMap: Record<string, string> = {
    b: "b", c: "k", d: "d", f: "f", g: "g", h: "h",
    j: "dZ", k: "k", l: "l", m: "m", n: "n", p: "p",
    q: "k", r: "r", s: "s", t: "t", v: "v", w: "w",
    x: "k", y: "j", z: "z",
  };

  return consonantMap[c] || "sil";
}

// ─── Utility Functions ──────────────────────────────────────────────

/**
 * Estimate speech duration from text length
 * Average speaking rate: ~4 characters/second for Chinese, ~15 chars/sec for English
 */
function estimateDuration(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;

  // Chinese: ~250ms per character, English: ~67ms per character
  const chineseDuration = chineseChars * 250;
  const otherDuration = otherChars * 67;

  return Math.max(500, chineseDuration + otherDuration);
}

/**
 * Split text into sentences for streaming
 */
function splitIntoSentences(text: string): string[] {
  // Split on Chinese and English sentence terminators
  const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
  return sentences.filter(s => s.trim().length > 0);
}

/**
 * Get a suitable default voice for a language
 */
export function getDefaultVoiceId(language: string = "zh"): string {
  // ElevenLabs multilingual voices
  const voiceMap: Record<string, string> = {
    zh: "21m00Tcm4TlvDq8ikWAM",  // Rachel - good for multilingual
    en: "21m00Tcm4TlvDq8ikWAM",  // Rachel
    ja: "21m00Tcm4TlvDq8ikWAM",  // Rachel
  };
  return voiceMap[language] || voiceMap.en;
}

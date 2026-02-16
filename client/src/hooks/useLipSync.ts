/**
 * useLipSync - Lip Synchronization Controller Hook
 * 
 * Manages the complete pipeline:
 * 1. Audio playback (from TTS-generated audio URL)
 * 2. Viseme timeline scheduling (synced to audio currentTime)
 * 3. 3D avatar mouth animation via AvatarPreview3DHandle.setViseme()
 * 
 * Supports:
 * - Real-time viseme scheduling synced to audio playback
 * - Interrupt/stop functionality
 * - Emotion-driven facial expressions during speech
 * - Fallback estimated visemes when timeline is unavailable
 */
import { useRef, useState, useCallback, useEffect } from "react";
import type { AvatarPreview3DHandle } from "@/components/AvatarPreview3D";

export type VisemeTimestamp = {
  time: number;       // ms from audio start
  visemeIndex: number; // MPEG-4 viseme index (0-21)
  phoneme: string;
  duration: number;   // ms
};

export type LipSyncState = {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;     // ms
  duration: number;        // ms
  currentViseme: number;   // current viseme index
  progress: number;        // 0-1
};

export type LipSyncOptions = {
  /** Reference to the 3D avatar handle */
  avatarRef: React.RefObject<AvatarPreview3DHandle | null>;
  /** Callback when playback completes */
  onComplete?: () => void;
  /** Callback when playback is interrupted */
  onInterrupt?: () => void;
  /** Callback on each viseme change */
  onVisemeChange?: (visemeIndex: number, phoneme: string) => void;
  /** Enable emotion-based expression during speech */
  enableEmotionExpression?: boolean;
};

export function useLipSync(options: LipSyncOptions) {
  const { avatarRef, onComplete, onInterrupt, onVisemeChange, enableEmotionExpression = true } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const visemeTimelineRef = useRef<VisemeTimestamp[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const currentVisemeIndexRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  const [state, setState] = useState<LipSyncState>({
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    duration: 0,
    currentViseme: 0,
    progress: 0,
  });

  // ─── Cleanup ───────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    isPlayingRef.current = false;
    currentVisemeIndexRef.current = 0;
    visemeTimelineRef.current = [];
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // ─── Viseme Animation Loop ────────────────────────────────────────

  const startVisemeLoop = useCallback(() => {
    const loop = () => {
      if (!isPlayingRef.current || !audioRef.current) return;

      const audio = audioRef.current;
      const currentTimeMs = audio.currentTime * 1000;
      const timeline = visemeTimelineRef.current;
      const duration = audio.duration * 1000 || state.duration;

      // Find the current viseme based on audio time
      let currentViseme = 0;
      let currentPhoneme = "sil";

      for (let i = currentVisemeIndexRef.current; i < timeline.length; i++) {
        const entry = timeline[i];
        if (currentTimeMs >= entry.time && currentTimeMs < entry.time + entry.duration) {
          currentViseme = entry.visemeIndex;
          currentPhoneme = entry.phoneme;
          currentVisemeIndexRef.current = i;
          break;
        } else if (currentTimeMs < entry.time) {
          // Between visemes - use silence or interpolate
          if (i > 0) {
            const prev = timeline[i - 1];
            const gap = entry.time - (prev.time + prev.duration);
            if (gap > 50) {
              // Long gap - close mouth
              currentViseme = 0;
            } else {
              // Short gap - interpolate
              currentViseme = prev.visemeIndex;
            }
          }
          break;
        }
      }

      // Apply viseme to 3D avatar
      if (avatarRef.current) {
        avatarRef.current.setViseme(currentViseme);
      }

      // Notify callback
      if (onVisemeChange && currentViseme !== state.currentViseme) {
        onVisemeChange(currentViseme, currentPhoneme);
      }

      // Update state
      setState(prev => ({
        ...prev,
        currentTime: currentTimeMs,
        currentViseme,
        progress: duration > 0 ? Math.min(currentTimeMs / duration, 1) : 0,
      }));

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  }, [avatarRef, onVisemeChange, state.currentViseme, state.duration]);

  // ─── Play Audio with Lip Sync ─────────────────────────────────────

  const play = useCallback(async (
    audioUrl: string,
    visemeTimeline: VisemeTimestamp[],
    options?: {
      emotion?: { emotion: string; intensity: number };
      duration?: number;
    }
  ) => {
    // Stop any current playback
    cleanup();

    // Set up viseme timeline
    visemeTimelineRef.current = visemeTimeline;
    currentVisemeIndexRef.current = 0;

    // Create audio element
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    // Set emotion expression if enabled
    if (enableEmotionExpression && options?.emotion && avatarRef.current) {
      avatarRef.current.setEmotion(options.emotion.emotion, options.emotion.intensity * 100);
    }

    return new Promise<void>((resolve, reject) => {
      audio.oncanplaythrough = () => {
        const duration = audio.duration * 1000 || options?.duration || 0;
        setState({
          isPlaying: true,
          isPaused: false,
          currentTime: 0,
          duration,
          currentViseme: 0,
          progress: 0,
        });
        isPlayingRef.current = true;

        // Start audio playback
        audio.play().then(() => {
          // Start viseme animation loop
          startVisemeLoop();
        }).catch(reject);
      };

      audio.onended = () => {
        isPlayingRef.current = false;
        // Reset mouth to closed
        if (avatarRef.current) {
          avatarRef.current.setViseme(0);
        }
        setState(prev => ({
          ...prev,
          isPlaying: false,
          currentViseme: 0,
          progress: 1,
        }));
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        onComplete?.();
        resolve();
      };

      audio.onerror = (e) => {
        console.error("[LipSync] Audio playback error:", e);
        cleanup();
        setState(prev => ({ ...prev, isPlaying: false, currentViseme: 0 }));
        reject(new Error("Audio playback failed"));
      };

      // Load audio
      audio.src = audioUrl;
      audio.load();
    });
  }, [cleanup, startVisemeLoop, avatarRef, enableEmotionExpression, onComplete]);

  // ─── Play with Fallback Visemes ───────────────────────────────────

  const playWithEstimatedVisemes = useCallback(async (
    audioUrl: string,
    text: string,
    options?: {
      emotion?: { emotion: string; intensity: number };
    }
  ) => {
    // Generate estimated viseme timeline from text
    const estimatedDuration = estimateTextDuration(text);
    const visemes = generateEstimatedVisemes(text, estimatedDuration);
    return play(audioUrl, visemes, { ...options, duration: estimatedDuration });
  }, [play]);

  // ─── Stop / Interrupt ─────────────────────────────────────────────

  const stop = useCallback(() => {
    const wasPlaying = isPlayingRef.current;
    cleanup();
    
    // Reset mouth
    if (avatarRef.current) {
      avatarRef.current.setViseme(0);
    }

    setState({
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
      duration: 0,
      currentViseme: 0,
      progress: 0,
    });

    if (wasPlaying) {
      onInterrupt?.();
    }
  }, [cleanup, avatarRef, onInterrupt]);

  // ─── Pause / Resume ───────────────────────────────────────────────

  const pause = useCallback(() => {
    if (audioRef.current && isPlayingRef.current) {
      audioRef.current.pause();
      isPlayingRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setState(prev => ({ ...prev, isPlaying: false, isPaused: true }));
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current && state.isPaused) {
      audioRef.current.play();
      isPlayingRef.current = true;
      startVisemeLoop();
      setState(prev => ({ ...prev, isPlaying: true, isPaused: false }));
    }
  }, [state.isPaused, startVisemeLoop]);

  // ─── Volume Control ───────────────────────────────────────────────

  const setVolume = useCallback((volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  return {
    state,
    play,
    playWithEstimatedVisemes,
    stop,
    pause,
    resume,
    setVolume,
  };
}

// ─── Utility Functions ──────────────────────────────────────────────

function estimateTextDuration(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.max(500, chineseChars * 250 + otherChars * 67);
}

function generateEstimatedVisemes(text: string, totalDuration: number): VisemeTimestamp[] {
  const chars = text.replace(/[^\w\u4e00-\u9fff]/g, "").split("");
  if (chars.length === 0) return [];

  const timePerChar = totalDuration / chars.length;
  const visemes: VisemeTimestamp[] = [];
  let currentTime = 0;

  for (const char of chars) {
    const visemeIndex = charToViseme(char);
    visemes.push({
      time: Math.round(currentTime),
      visemeIndex,
      phoneme: char,
      duration: Math.round(timePerChar * 0.8), // 80% of slot for mouth open
    });
    currentTime += timePerChar;
  }

  return visemes;
}

function charToViseme(char: string): number {
  const c = char.toLowerCase();
  
  // Chinese characters
  if (/[\u4e00-\u9fff]/.test(c)) {
    const shapes = [11, 14, 12, 13, 15, 1, 4, 6]; // Various mouth shapes
    return shapes[c.charCodeAt(0) % shapes.length];
  }

  // Vowels
  const vowelMap: Record<string, number> = { a: 11, e: 12, i: 13, o: 14, u: 15 };
  if (vowelMap[c]) return vowelMap[c];

  // Consonants
  const consonantMap: Record<string, number> = {
    b: 1, p: 1, m: 1, f: 2, v: 2,
    t: 4, d: 4, s: 4, z: 4, n: 4, l: 4,
    k: 6, g: 6, r: 8, w: 9, j: 10, h: 7,
  };
  return consonantMap[c] || 0;
}

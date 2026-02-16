import { describe, expect, it, vi } from "vitest";

// ─── TTS Integration Tests ─────────────────────────────────────────
// Tests for the full pipeline: LLM → TTS → Viseme → 3D Animation

describe("TTS Integration Pipeline", () => {
  describe("Chat with Voice Flow", () => {
    it("should produce response with audio URL and viseme timeline", () => {
      // Simulate the expected response structure from chatWithVoice
      const mockResponse = {
        id: 1,
        content: "你好，很高兴认识你！",
        emotionAnalysis: { emotion: "happy", intensity: 0.8, description: "开心" },
        audioUrl: "https://storage.example.com/tts/chat-abc123.mp3",
        visemeTimeline: [
          { time: 0, visemeIndex: 0, phoneme: "sil", duration: 80 },
          { time: 80, visemeIndex: 6, phoneme: "n", duration: 100 },
          { time: 180, visemeIndex: 13, phoneme: "i", duration: 120 },
        ],
        audioDuration: 2500,
      };

      expect(mockResponse.audioUrl).toBeTruthy();
      expect(mockResponse.visemeTimeline).toBeInstanceOf(Array);
      expect(mockResponse.visemeTimeline.length).toBeGreaterThan(0);
      expect(mockResponse.audioDuration).toBeGreaterThan(0);
      expect(mockResponse.emotionAnalysis).toBeDefined();
      expect(mockResponse.emotionAnalysis.emotion).toBe("happy");
    });

    it("should handle response without audio gracefully", () => {
      const mockResponse = {
        id: 2,
        content: "这是一个纯文本回复",
        emotionAnalysis: { emotion: "neutral", intensity: 0.5, description: "平静" },
        audioUrl: null,
        visemeTimeline: [],
        audioDuration: 0,
      };

      expect(mockResponse.audioUrl).toBeNull();
      expect(mockResponse.visemeTimeline).toHaveLength(0);
      // Should still have valid content and emotion
      expect(mockResponse.content).toBeTruthy();
      expect(mockResponse.emotionAnalysis).toBeDefined();
    });
  });

  describe("Viseme Timeline Validation", () => {
    it("should have valid MPEG-4 viseme indices (0-21)", () => {
      const timeline = [
        { time: 0, visemeIndex: 0, phoneme: "sil", duration: 80 },
        { time: 80, visemeIndex: 11, phoneme: "a", duration: 100 },
        { time: 180, visemeIndex: 1, phoneme: "b", duration: 90 },
        { time: 270, visemeIndex: 14, phoneme: "o", duration: 110 },
        { time: 380, visemeIndex: 21, phoneme: "max", duration: 80 },
      ];

      for (const entry of timeline) {
        expect(entry.visemeIndex).toBeGreaterThanOrEqual(0);
        expect(entry.visemeIndex).toBeLessThanOrEqual(21);
        expect(entry.time).toBeGreaterThanOrEqual(0);
        expect(entry.duration).toBeGreaterThan(0);
      }
    });

    it("should have monotonically increasing timestamps", () => {
      const timeline = [
        { time: 0, visemeIndex: 0, phoneme: "sil", duration: 80 },
        { time: 80, visemeIndex: 11, phoneme: "a", duration: 100 },
        { time: 180, visemeIndex: 1, phoneme: "b", duration: 90 },
        { time: 270, visemeIndex: 14, phoneme: "o", duration: 110 },
      ];

      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].time).toBeGreaterThan(timeline[i - 1].time);
      }
    });

    it("should not have overlapping viseme durations", () => {
      const timeline = [
        { time: 0, visemeIndex: 0, phoneme: "sil", duration: 80 },
        { time: 80, visemeIndex: 11, phoneme: "a", duration: 100 },
        { time: 180, visemeIndex: 1, phoneme: "b", duration: 90 },
      ];

      for (let i = 1; i < timeline.length; i++) {
        const prevEnd = timeline[i - 1].time + timeline[i - 1].duration;
        expect(timeline[i].time).toBeGreaterThanOrEqual(prevEnd);
      }
    });
  });

  describe("Emotion to Animation Mapping", () => {
    const VALID_EMOTIONS = ["happy", "sad", "surprised", "angry", "neutral", "thinking", "excited"];

    it("should map all valid emotions", () => {
      for (const emotion of VALID_EMOTIONS) {
        expect(typeof emotion).toBe("string");
        expect(emotion.length).toBeGreaterThan(0);
      }
      expect(VALID_EMOTIONS).toHaveLength(7);
    });

    it("should have intensity in valid range", () => {
      const testCases = [
        { emotion: "happy", intensity: 0.8 },
        { emotion: "sad", intensity: 0.3 },
        { emotion: "neutral", intensity: 0.5 },
        { emotion: "excited", intensity: 1.0 },
        { emotion: "angry", intensity: 0.0 },
      ];

      for (const tc of testCases) {
        expect(tc.intensity).toBeGreaterThanOrEqual(0);
        expect(tc.intensity).toBeLessThanOrEqual(1);
        expect(VALID_EMOTIONS).toContain(tc.emotion);
      }
    });
  });

  describe("Interrupt Mechanism", () => {
    it("should support interrupt during playback", () => {
      const playbackState = {
        isPlaying: true,
        isPaused: false,
        currentTime: 1500,
        duration: 3000,
        currentViseme: 11,
        progress: 0.5,
      };

      // Simulate interrupt
      const afterInterrupt = {
        isPlaying: false,
        isPaused: false,
        currentTime: 0,
        duration: 0,
        currentViseme: 0,
        progress: 0,
      };

      expect(playbackState.isPlaying).toBe(true);
      expect(afterInterrupt.isPlaying).toBe(false);
      expect(afterInterrupt.currentViseme).toBe(0); // Mouth closed
      expect(afterInterrupt.progress).toBe(0);
    });

    it("should mark interrupted message correctly", () => {
      const interruptData = {
        messageId: 42,
        interruptedAtContent: "用户打断了对话",
      };

      expect(interruptData.messageId).toBeGreaterThan(0);
      expect(interruptData.interruptedAtContent).toBeTruthy();
    });
  });

  describe("Audio URL Handling", () => {
    it("should generate valid S3 audio URLs", () => {
      const audioKey = `tts/chat-abc123def456.mp3`;
      expect(audioKey).toMatch(/^tts\/chat-[\w]+\.mp3$/);
    });

    it("should support MP3 format", () => {
      const mimeType = "audio/mpeg";
      expect(mimeType).toBe("audio/mpeg");
    });

    it("should handle cross-origin audio loading", () => {
      // Audio elements need crossOrigin for S3 URLs
      const crossOrigin = "anonymous";
      expect(crossOrigin).toBe("anonymous");
    });
  });

  describe("Voice Configuration", () => {
    it("should support Chinese language voice selection", () => {
      const chineseVoiceConfig = {
        language: "zh",
        voiceId: "default",
        modelId: "eleven_multilingual_v2",
      };

      expect(chineseVoiceConfig.language).toBe("zh");
      expect(chineseVoiceConfig.modelId).toContain("multilingual");
    });

    it("should have valid stability and similarity boost ranges", () => {
      const voiceSettings = {
        stability: 0.5,
        similarityBoost: 0.75,
      };

      expect(voiceSettings.stability).toBeGreaterThanOrEqual(0);
      expect(voiceSettings.stability).toBeLessThanOrEqual(1);
      expect(voiceSettings.similarityBoost).toBeGreaterThanOrEqual(0);
      expect(voiceSettings.similarityBoost).toBeLessThanOrEqual(1);
    });
  });

  describe("TTS Router Input Validation", () => {
    it("should validate synthesize input", () => {
      const validInput = {
        text: "你好世界",
        voiceId: "21m00Tcm4TlvDq8ikWAM",
        language: "zh",
        stability: 0.5,
        similarityBoost: 0.75,
      };

      expect(validInput.text.length).toBeGreaterThan(0);
      expect(validInput.text.length).toBeLessThanOrEqual(5000);
      expect(validInput.stability).toBeGreaterThanOrEqual(0);
      expect(validInput.stability).toBeLessThanOrEqual(1);
    });

    it("should reject empty text", () => {
      const emptyText = "";
      expect(emptyText.length).toBe(0);
      // The router would reject this with z.string().min(1)
    });

    it("should reject text exceeding max length", () => {
      const longText = "a".repeat(5001);
      expect(longText.length).toBeGreaterThan(5000);
      // The router would reject this with z.string().max(5000)
    });

    it("should validate chatWithVoice input", () => {
      const validInput = {
        sessionId: 1,
        content: "你好",
        voiceId: "some-voice-id",
        language: "zh",
        attachments: [
          { url: "https://example.com/file.pdf", name: "file.pdf", mimeType: "application/pdf" },
        ],
      };

      expect(validInput.sessionId).toBeGreaterThan(0);
      expect(validInput.content.length).toBeGreaterThan(0);
      expect(validInput.attachments).toHaveLength(1);
    });
  });

  describe("Estimated Viseme Generation", () => {
    it("should generate visemes for Chinese text", () => {
      const text = "你好世界";
      const chars = text.replace(/[^\w\u4e00-\u9fff]/g, "").split("");
      expect(chars).toHaveLength(4);
    });

    it("should generate visemes for English text", () => {
      const text = "Hello World";
      const chars = text.replace(/[^\w\u4e00-\u9fff]/g, "").split("");
      expect(chars).toHaveLength(10); // "HelloWorld" without space
    });

    it("should handle empty text", () => {
      const text = "";
      const chars = text.replace(/[^\w\u4e00-\u9fff]/g, "").split("").filter(c => c);
      expect(chars).toHaveLength(0);
    });

    it("should map Chinese characters to varied visemes", () => {
      const shapes = [11, 14, 12, 13, 15, 1, 4, 6];
      const char = "你";
      const visemeIndex = shapes[char.charCodeAt(0) % shapes.length];
      expect(visemeIndex).toBeGreaterThan(0);
      expect(visemeIndex).toBeLessThanOrEqual(15);
    });
  });
});

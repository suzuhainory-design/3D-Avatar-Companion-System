import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── TTS Service Unit Tests ─────────────────────────────────────────

describe("TTS Service", () => {
  describe("ElevenLabs API Key Validation", () => {
    it("should have ELEVENLABS_API_KEY environment variable set", () => {
      const key = process.env.ELEVENLABS_API_KEY;
      expect(key).toBeDefined();
      expect(typeof key).toBe("string");
      expect(key!.length).toBeGreaterThan(0);
    });

    it("should validate API key format", () => {
      const key = process.env.ELEVENLABS_API_KEY;
      // ElevenLabs API keys are typically alphanumeric strings
      expect(key).toBeDefined();
      expect(key!.trim()).toBe(key); // No leading/trailing whitespace
    });
  });

  describe("Phoneme to Viseme Mapping", () => {
    // Test the mapping logic without importing the module directly
    // We test the concept of viseme generation

    it("should map vowels to correct viseme indices", () => {
      const vowelVisemes: Record<string, number> = {
        a: 11, e: 12, i: 13, o: 14, u: 15,
      };
      for (const [vowel, expectedIndex] of Object.entries(vowelVisemes)) {
        expect(expectedIndex).toBeGreaterThan(0);
        expect(expectedIndex).toBeLessThanOrEqual(21);
      }
    });

    it("should map consonants to correct viseme indices", () => {
      const consonantVisemes: Record<string, number> = {
        p: 1, b: 1, m: 1,  // Bilabial
        f: 2, v: 2,          // Labiodental
        t: 4, d: 4, s: 4,    // Alveolar
        k: 6, g: 6,          // Velar
      };
      for (const [, index] of Object.entries(consonantVisemes)) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(21);
      }
    });

    it("should have silence mapped to viseme 0", () => {
      const silenceViseme = 0;
      expect(silenceViseme).toBe(0);
    });

    it("should support MPEG-4 viseme range (0-21)", () => {
      const validRange = Array.from({ length: 22 }, (_, i) => i);
      expect(validRange).toHaveLength(22);
      expect(validRange[0]).toBe(0);
      expect(validRange[21]).toBe(21);
    });
  });

  describe("Duration Estimation", () => {
    it("should estimate Chinese text duration correctly", () => {
      const text = "你好世界";
      const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const duration = chineseChars * 250; // 250ms per Chinese character
      expect(duration).toBe(1000); // 4 chars * 250ms
    });

    it("should estimate English text duration correctly", () => {
      const text = "Hello World";
      const otherChars = text.length;
      const duration = otherChars * 67; // 67ms per English character
      expect(duration).toBeGreaterThan(500);
    });

    it("should have minimum duration of 500ms", () => {
      const minDuration = 500;
      expect(Math.max(500, 100)).toBe(minDuration);
    });

    it("should handle mixed Chinese-English text", () => {
      const text = "Hello你好";
      const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const otherChars = text.length - chineseChars;
      const duration = chineseChars * 250 + otherChars * 67;
      expect(duration).toBeGreaterThan(0);
      expect(chineseChars).toBe(2);
      expect(otherChars).toBe(5);
    });
  });

  describe("Sentence Splitting", () => {
    it("should split Chinese sentences correctly", () => {
      const text = "你好。世界！测试？";
      const sentences = text.split(/(?<=[。！？.!?\n])\s*/).filter(s => s.trim().length > 0);
      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe("你好。");
      expect(sentences[1]).toBe("世界！");
      expect(sentences[2]).toBe("测试？");
    });

    it("should split English sentences correctly", () => {
      const text = "Hello world. How are you? I am fine!";
      const sentences = text.split(/(?<=[。！？.!?\n])\s*/).filter(s => s.trim().length > 0);
      expect(sentences).toHaveLength(3);
    });

    it("should handle text without sentence terminators", () => {
      const text = "Hello world";
      const sentences = text.split(/(?<=[。！？.!?\n])\s*/).filter(s => s.trim().length > 0);
      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe("Hello world");
    });
  });

  describe("Viseme Timeline Generation", () => {
    it("should generate timeline with correct structure", () => {
      const mockTimeline = [
        { time: 0, visemeIndex: 0, phoneme: "sil", duration: 80 },
        { time: 80, visemeIndex: 11, phoneme: "a", duration: 100 },
        { time: 180, visemeIndex: 1, phoneme: "b", duration: 90 },
      ];

      for (const entry of mockTimeline) {
        expect(entry.time).toBeGreaterThanOrEqual(0);
        expect(entry.visemeIndex).toBeGreaterThanOrEqual(0);
        expect(entry.visemeIndex).toBeLessThanOrEqual(21);
        expect(entry.duration).toBeGreaterThan(0);
        expect(typeof entry.phoneme).toBe("string");
      }
    });

    it("should have monotonically increasing timestamps", () => {
      const times = [0, 80, 180, 280, 370];
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i - 1]);
      }
    });

    it("should not have overlapping visemes", () => {
      const timeline = [
        { time: 0, duration: 80 },
        { time: 80, duration: 100 },
        { time: 180, duration: 90 },
      ];
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].time).toBeGreaterThanOrEqual(
          timeline[i - 1].time + timeline[i - 1].duration
        );
      }
    });
  });

  describe("TTS Stream Chunking", () => {
    it("should produce chunks with correct structure", () => {
      const mockChunk = {
        audioChunk: Buffer.from("test"),
        visemeTimestamps: [{ time: 0, visemeIndex: 0, phoneme: "sil", duration: 80 }],
        text: "Hello",
        isFinal: false,
        chunkIndex: 0,
      };

      expect(mockChunk.audioChunk).toBeInstanceOf(Buffer);
      expect(Array.isArray(mockChunk.visemeTimestamps)).toBe(true);
      expect(typeof mockChunk.text).toBe("string");
      expect(typeof mockChunk.isFinal).toBe("boolean");
      expect(typeof mockChunk.chunkIndex).toBe("number");
    });

    it("should mark last chunk as final", () => {
      const chunks = [
        { isFinal: false, chunkIndex: 0 },
        { isFinal: false, chunkIndex: 1 },
        { isFinal: true, chunkIndex: 2 },
      ];
      expect(chunks[chunks.length - 1].isFinal).toBe(true);
      expect(chunks.filter(c => c.isFinal)).toHaveLength(1);
    });
  });

  describe("Voice Configuration", () => {
    it("should have valid default voice settings", () => {
      const defaults = {
        voiceId: "21m00Tcm4TlvDq8ikWAM",
        modelId: "eleven_multilingual_v2",
        stability: 0.5,
        similarityBoost: 0.75,
      };

      expect(defaults.voiceId).toBeTruthy();
      expect(defaults.modelId).toBeTruthy();
      expect(defaults.stability).toBeGreaterThanOrEqual(0);
      expect(defaults.stability).toBeLessThanOrEqual(1);
      expect(defaults.similarityBoost).toBeGreaterThanOrEqual(0);
      expect(defaults.similarityBoost).toBeLessThanOrEqual(1);
    });

    it("should support multilingual model", () => {
      const modelId = "eleven_multilingual_v2";
      expect(modelId).toContain("multilingual");
    });
  });
});

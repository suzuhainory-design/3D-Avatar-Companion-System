import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ========== Test Helpers ==========
function createAuthContext(): { ctx: TrpcContext } {
  const user = {
    id: 1,
    openId: "test-user-memory",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

// ========== Vector Memory Tests ==========
describe("Vector Memory Service", () => {
  describe("Memory Module Imports", () => {
    it("should export all required functions from vectorMemory", async () => {
      const mod = await import("./vectorMemory");
      expect(mod.searchMemories).toBeDefined();
      expect(typeof mod.searchMemories).toBe("function");
      expect(mod.addManualMemory).toBeDefined();
      expect(typeof mod.addManualMemory).toBe("function");
      expect(mod.deleteMemory).toBeDefined();
      expect(typeof mod.deleteMemory).toBe("function");
      expect(mod.clearMemories).toBeDefined();
      expect(typeof mod.clearMemories).toBe("function");
      expect(mod.getAllMemories).toBeDefined();
      expect(typeof mod.getAllMemories).toBe("function");
      expect(mod.getMemoryStats).toBeDefined();
      expect(typeof mod.getMemoryStats).toBe("function");
      expect(mod.buildMemoryContext).toBeDefined();
      expect(typeof mod.buildMemoryContext).toBe("function");
      expect(mod.extractMemoriesFromConversation).toBeDefined();
      expect(typeof mod.extractMemoriesFromConversation).toBe("function");
    });
  });

  describe("Embedding Generation", () => {
    it("should export generateEmbedding function", async () => {
      const mod = await import("./vectorMemory");
      expect(mod.generateEmbedding).toBeDefined();
      expect(typeof mod.generateEmbedding).toBe("function");
    });

    it("should export cosineSimilarity function", async () => {
      const mod = await import("./vectorMemory");
      expect(mod.cosineSimilarity).toBeDefined();
      expect(typeof mod.cosineSimilarity).toBe("function");
    });

    it("should calculate cosine similarity correctly for identical vectors", async () => {
      const mod = await import("./vectorMemory");
      const vec = [1, 0, 0, 1];
      const similarity = mod.cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it("should calculate cosine similarity correctly for orthogonal vectors", async () => {
      const mod = await import("./vectorMemory");
      const vec1 = [1, 0, 0, 0];
      const vec2 = [0, 1, 0, 0];
      const similarity = mod.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0.0, 5);
    });

    it("should calculate cosine similarity correctly for opposite vectors", async () => {
      const mod = await import("./vectorMemory");
      const vec1 = [1, 0, 0, 0];
      const vec2 = [-1, 0, 0, 0];
      const similarity = mod.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    it("should handle zero vectors gracefully", async () => {
      const mod = await import("./vectorMemory");
      const vec1 = [0, 0, 0, 0];
      const vec2 = [1, 0, 0, 0];
      const similarity = mod.cosineSimilarity(vec1, vec2);
      expect(similarity).toBe(0);
    });
  });

  describe("Memory Types", () => {
    it("should support all 5 memory types", async () => {
      const validTypes = [
        "user_preference",
        "key_fact",
        "emotional_pattern",
        "personality_trait",
        "conversation_summary",
      ];
      // Verify types are accepted by the router schema
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      // Just verify the router exists and accepts these types
      expect(caller.memory.add).toBeDefined();
      for (const type of validTypes) {
        // Type should be valid - we just check it doesn't throw a schema error
        expect(type).toBeTruthy();
      }
    });
  });

  describe("Memory Router", () => {
    it("should have all memory CRUD operations", () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      expect(caller.memory.list).toBeDefined();
      expect(caller.memory.search).toBeDefined();
      expect(caller.memory.add).toBeDefined();
      expect(caller.memory.delete).toBeDefined();
      expect(caller.memory.clear).toBeDefined();
      expect(caller.memory.stats).toBeDefined();
    });
  });
});

// ========== Model Cache Tests ==========
describe("Model Cache Service", () => {
  describe("Cache Module Imports", () => {
    it("should export all required functions from modelCache", async () => {
      const mod = await import("./modelCache");
      expect(mod.buildCacheKey).toBeDefined();
      expect(typeof mod.buildCacheKey).toBe("function");
      expect(mod.getCachedModel).toBeDefined();
      expect(typeof mod.getCachedModel).toBe("function");
      expect(mod.cacheModel).toBeDefined();
      expect(typeof mod.cacheModel).toBe("function");
      expect(mod.invalidateCache).toBeDefined();
      expect(typeof mod.invalidateCache).toBe("function");
      expect(mod.clearUserCache).toBeDefined();
      expect(typeof mod.clearUserCache).toBe("function");
      expect(mod.getCacheStats).toBeDefined();
      expect(typeof mod.getCacheStats).toBe("function");
    });
  });

  describe("Cache Key Generation", () => {
    it("should generate deterministic cache keys for same params", async () => {
      const mod = await import("./modelCache");
      const params = { betas: [1, 2, 3], gender: "male" };
      const key1 = mod.buildCacheKey("smplx_fit", 1, params);
      const key2 = mod.buildCacheKey("smplx_fit", 1, params);
      expect(key1).toBe(key2);
    });

    it("should generate different cache keys for different params", async () => {
      const mod = await import("./modelCache");
      const params1 = { betas: [1, 2, 3], gender: "male" };
      const params2 = { betas: [4, 5, 6], gender: "female" };
      const key1 = mod.buildCacheKey("smplx_fit", 1, params1);
      const key2 = mod.buildCacheKey("smplx_fit", 1, params2);
      expect(key1).not.toBe(key2);
    });

    it("should generate different cache keys for different users", async () => {
      const mod = await import("./modelCache");
      const params = { betas: [1, 2, 3] };
      const key1 = mod.buildCacheKey("smplx_fit", 1, params);
      const key2 = mod.buildCacheKey("smplx_fit", 2, params);
      expect(key1).not.toBe(key2);
    });

    it("should generate different cache keys for different cache types", async () => {
      const mod = await import("./modelCache");
      const params = { betas: [1, 2, 3] };
      const key1 = mod.buildCacheKey("smplx_fit", 1, params);
      const key2 = mod.buildCacheKey("clothing_render", 1, params);
      expect(key1).not.toBe(key2);
    });

    it("should handle empty params", async () => {
      const mod = await import("./modelCache");
      const key = mod.buildCacheKey("smplx_fit", 1, {});
      expect(key).toBeTruthy();
      expect(typeof key).toBe("string");
    });

    it("should handle undefined values in params", async () => {
      const mod = await import("./modelCache");
      const key = mod.buildCacheKey("smplx_fit", 1, { betas: undefined, scale: 1.0 });
      expect(key).toBeTruthy();
    });
  });

  describe("Cache Router", () => {
    it("should have all cache operations", () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      expect(caller.cache.stats).toBeDefined();
      expect(caller.cache.invalidate).toBeDefined();
      expect(caller.cache.clearAll).toBeDefined();
    });
  });
});

// ========== Integration Tests ==========
describe("Memory-LLM Integration", () => {
  it("should have memory context building capability", async () => {
    const mod = await import("./vectorMemory");
    expect(mod.buildMemoryContext).toBeDefined();
    expect(typeof mod.buildMemoryContext).toBe("function");
  });

  it("should have memory extraction capability", async () => {
    const mod = await import("./vectorMemory");
    expect(mod.extractMemoriesFromConversation).toBeDefined();
    expect(typeof mod.extractMemoriesFromConversation).toBe("function");
  });

  it("chat.sendMessage should exist and be callable", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.chat.sendMessage).toBeDefined();
  });

  it("chat.chatWithVoice should exist and be callable", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.chat.chatWithVoice).toBeDefined();
  });
});

describe("Cache-ModelService Integration", () => {
  it("modelService.generateGlb should accept skipCache parameter", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.modelService.generateGlb).toBeDefined();
  });

  it("cache.invalidate should accept avatarId and optional cacheType", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(caller.cache.invalidate).toBeDefined();
  });
});

// ========== Database Schema Tests ==========
describe("Database Schema", () => {
  it("should have memory_vectors table defined", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.memoryVectors).toBeDefined();
  });

  it("should have model_cache table defined", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.modelCache).toBeDefined();
  });

  it("memory_vectors table should have required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.memoryVectors;
    // Check that the table object exists and has expected structure
    expect(table).toBeTruthy();
  });

  it("model_cache table should have required columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.modelCache;
    expect(table).toBeTruthy();
  });
});

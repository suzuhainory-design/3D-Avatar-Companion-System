/**
 * 向量记忆服务 (Vector Memory Service)
 * 
 * 使用 LLM API 生成 text embedding，存储在 MySQL 中，
 * 通过余弦相似度实现语义检索，为3D数字人提供长期记忆和个性化回应能力。
 * 
 * 架构设计：
 * 1. Embedding 生成：调用 Manus Forge API 的 embedding 端点
 * 2. 向量存储：MySQL JSON 列存储 float[] 向量
 * 3. 检索：服务端计算余弦相似度，返回 Top-K 相关记忆
 * 4. 记忆类型：对话摘要、用户偏好、情感模式、关键事实
 */

import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { nanoid } from "nanoid";

// ========== Types ==========

export interface MemoryEntry {
  id: string;
  userId: number;
  avatarId: number;
  /** 记忆类型 */
  type: "conversation_summary" | "user_preference" | "emotional_pattern" | "key_fact" | "personality_trait";
  /** 原始文本内容 */
  content: string;
  /** embedding 向量 */
  embedding: number[];
  /** 元数据 */
  metadata: Record<string, any>;
  /** 重要性评分 0-1 */
  importance: number;
  /** 访问次数（用于衰减） */
  accessCount: number;
  /** 最后访问时间 */
  lastAccessedAt: number;
  createdAt: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  similarity: number;
}

export interface MemoryContext {
  relevantMemories: MemorySearchResult[];
  userPreferences: MemoryEntry[];
  emotionalPatterns: MemoryEntry[];
  personalityTraits: MemoryEntry[];
  /** 格式化后的 prompt 注入文本 */
  formattedContext: string;
}

// ========== Embedding Generation ==========

/**
 * 使用 LLM 生成文本的 embedding 向量
 * 通过让 LLM 输出固定维度的数值数组来模拟 embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiUrl = ENV.forgeApiUrl
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/embeddings`
    : "https://forge.manus.im/v1/embeddings";

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000), // 截断过长文本
      }),
    });

    if (!response.ok) {
      // 如果 embedding API 不可用，使用 LLM 生成简化版 embedding
      console.warn("[VectorMemory] Embedding API unavailable, using LLM fallback");
      return generateEmbeddingFallback(text);
    }

    const result = await response.json() as any;
    if (result.data?.[0]?.embedding) {
      return result.data[0].embedding;
    }

    return generateEmbeddingFallback(text);
  } catch (error) {
    console.warn("[VectorMemory] Embedding generation failed, using fallback:", error);
    return generateEmbeddingFallback(text);
  }
}

/**
 * 使用 LLM 生成简化版 embedding（当 embedding API 不可用时的降级方案）
 * 通过 LLM 提取文本的语义特征向量
 */
async function generateEmbeddingFallback(text: string): Promise<number[]> {
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一个文本特征提取器。将输入文本转换为一个32维的语义特征向量。
每个维度代表一个语义特征，值在-1到1之间。
维度含义：[情感正负, 情感强度, 正式程度, 话题-日常, 话题-工作, 话题-情感, 话题-技术, 话题-创意, 
紧急程度, 确定性, 主观性, 复杂度, 社交性, 亲密度, 幽默感, 严肃度,
请求性, 信息性, 表达性, 叙事性, 时间-过去, 时间-现在, 时间-未来, 空间-近,
具体性, 抽象性, 积极行动, 消极被动, 个人相关, 群体相关, 新颖度, 重复度]
只返回JSON数组，不要其他内容。`,
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "embedding_vector",
          strict: true,
          schema: {
            type: "object",
            properties: {
              vector: {
                type: "array",
                items: { type: "number" },
              },
            },
            required: ["vector"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof result.choices[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : JSON.stringify(result.choices[0]?.message?.content);
    const parsed = JSON.parse(content);
    const vector = parsed.vector || parsed;

    if (Array.isArray(vector) && vector.length > 0) {
      // 归一化向量
      return normalizeVector(vector);
    }
  } catch (error) {
    console.warn("[VectorMemory] LLM fallback embedding failed:", error);
  }

  // 最终降级：返回随机向量（不理想但不会阻塞流程）
  return Array.from({ length: 32 }, () => Math.random() * 2 - 1);
}

// ========== Vector Operations ==========

/** 归一化向量（L2范数） */
export function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

/** 计算余弦相似度 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // 长度不同时，截取较短的长度
    const minLen = Math.min(a.length, b.length);
    a = a.slice(0, minLen);
    b = b.slice(0, minLen);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ========== Memory Storage (MySQL-based) ==========

/** 内存缓存（减少数据库查询） */
const memoryCache = new Map<string, { entries: MemoryEntry[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

function getCacheKey(userId: number, avatarId: number): string {
  return `${userId}:${avatarId}`;
}

function invalidateCache(userId: number, avatarId: number): void {
  memoryCache.delete(getCacheKey(userId, avatarId));
}

/** 存储记忆条目到数据库 */
export async function storeMemory(entry: Omit<MemoryEntry, "id" | "accessCount" | "lastAccessedAt" | "createdAt">): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const id = nanoid();
  const now = Date.now();

  await db.execute({
    sql: `INSERT INTO memory_vectors (id, userId, avatarId, type, content, embedding, metadata, importance, accessCount, lastAccessedAt, createdAt) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    params: [
      id,
      entry.userId,
      entry.avatarId,
      entry.type,
      entry.content,
      JSON.stringify(entry.embedding),
      JSON.stringify(entry.metadata),
      entry.importance,
      now,
      now,
    ],
  } as any);

  invalidateCache(entry.userId, entry.avatarId);
  return id;
}

/** 从数据库检索所有记忆条目 */
export async function getAllMemories(userId: number, avatarId: number): Promise<MemoryEntry[]> {
  const cacheKey = getCacheKey(userId, avatarId);
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.entries;
  }

  const db = await getDb();
  if (!db) return [];

  try {
    const rows = await db.execute({
      sql: `SELECT * FROM memory_vectors WHERE userId = ? AND avatarId = ? ORDER BY createdAt DESC LIMIT 500`,
      params: [userId, avatarId],
    } as any) as any;

    const entries: MemoryEntry[] = (rows[0] || rows || []).map((row: any) => ({
      id: row.id,
      userId: row.userId,
      avatarId: row.avatarId,
      type: row.type,
      content: row.content,
      embedding: typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      importance: row.importance,
      accessCount: row.accessCount,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
    }));

    memoryCache.set(cacheKey, { entries, timestamp: Date.now() });
    return entries;
  } catch (error) {
    console.warn("[VectorMemory] Failed to load memories:", error);
    return [];
  }
}

/** 语义搜索：返回与查询最相关的 Top-K 记忆 */
export async function searchMemories(
  userId: number,
  avatarId: number,
  query: string,
  options: {
    topK?: number;
    minSimilarity?: number;
    types?: MemoryEntry["type"][];
  } = {}
): Promise<MemorySearchResult[]> {
  const { topK = 5, minSimilarity = 0.3, types } = options;

  // 生成查询的 embedding
  const queryEmbedding = await generateEmbedding(query);

  // 获取所有记忆
  let memories = await getAllMemories(userId, avatarId);

  // 按类型过滤
  if (types && types.length > 0) {
    memories = memories.filter(m => types.includes(m.type));
  }

  // 计算相似度并排序
  const results: MemorySearchResult[] = memories
    .map(entry => ({
      entry,
      similarity: cosineSimilarity(queryEmbedding, entry.embedding),
    }))
    .filter(r => r.similarity >= minSimilarity)
    .sort((a, b) => {
      // 综合评分：相似度 * 0.7 + 重要性 * 0.2 + 时间衰减 * 0.1
      const timeDecayA = Math.exp(-(Date.now() - a.entry.createdAt) / (30 * 24 * 60 * 60 * 1000)); // 30天衰减
      const timeDecayB = Math.exp(-(Date.now() - b.entry.createdAt) / (30 * 24 * 60 * 60 * 1000));
      const scoreA = a.similarity * 0.7 + a.entry.importance * 0.2 + timeDecayA * 0.1;
      const scoreB = b.similarity * 0.7 + b.entry.importance * 0.2 + timeDecayB * 0.1;
      return scoreB - scoreA;
    })
    .slice(0, topK);

  // 更新访问计数
  for (const result of results) {
    updateMemoryAccess(result.entry.id).catch(() => {});
  }

  return results;
}

/** 更新记忆访问信息 */
async function updateMemoryAccess(memoryId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.execute({
      sql: `UPDATE memory_vectors SET accessCount = accessCount + 1, lastAccessedAt = ? WHERE id = ?`,
      params: [Date.now(), memoryId],
    } as any);
  } catch (error) {
    // 非关键操作，静默失败
  }
}

/** 删除记忆 */
export async function deleteMemory(memoryId: string, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.execute({
      sql: `DELETE FROM memory_vectors WHERE id = ? AND userId = ?`,
      params: [memoryId, userId],
    } as any);
    // 清除所有该用户的缓存
    const keysToDelete = Array.from(memoryCache.keys()).filter(key => key.startsWith(`${userId}:`));
    for (const key of keysToDelete) {
      memoryCache.delete(key);
    }
    return true;
  } catch (error) {
    console.error("[VectorMemory] Failed to delete memory:", error);
    return false;
  }
}

/** 清除指定数字人的所有记忆 */
export async function clearMemories(userId: number, avatarId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.execute({
      sql: `DELETE FROM memory_vectors WHERE userId = ? AND avatarId = ?`,
      params: [userId, avatarId],
    } as any);
    invalidateCache(userId, avatarId);
    return true;
  } catch (error) {
    console.error("[VectorMemory] Failed to clear memories:", error);
    return false;
  }
}

/** 获取记忆统计信息 */
export async function getMemoryStats(userId: number, avatarId: number): Promise<{
  total: number;
  byType: Record<string, number>;
  oldestMemory: number | null;
  newestMemory: number | null;
}> {
  const memories = await getAllMemories(userId, avatarId);

  const byType: Record<string, number> = {};
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const m of memories) {
    byType[m.type] = (byType[m.type] || 0) + 1;
    if (oldest === null || m.createdAt < oldest) oldest = m.createdAt;
    if (newest === null || m.createdAt > newest) newest = m.createdAt;
  }

  return {
    total: memories.length,
    byType,
    oldestMemory: oldest,
    newestMemory: newest,
  };
}

// ========== Conversation Analysis & Memory Extraction ==========

/** 从对话中自动提取记忆（用户偏好、关键事实、情感模式等） */
export async function extractMemoriesFromConversation(
  userId: number,
  avatarId: number,
  messages: Array<{ role: string; content: string }>,
  existingMemories: MemoryEntry[] = []
): Promise<MemoryEntry[]> {
  if (messages.length < 2) return [];

  const conversationText = messages
    .map(m => `${m.role === "user" ? "用户" : "数字人"}: ${m.content}`)
    .join("\n");

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一个记忆提取专家。分析以下对话，提取值得长期记忆的信息。
提取以下类型的记忆：
1. user_preference - 用户的偏好（如喜欢的颜色、食物、音乐等）
2. key_fact - 关于用户的关键事实（如职业、年龄、家庭情况等）
3. emotional_pattern - 用户的情感模式（如在什么话题下会开心/难过）
4. personality_trait - 用户的性格特征（如幽默、内向、好奇等）
5. conversation_summary - 对话的核心摘要

已有记忆（避免重复）：
${existingMemories.slice(0, 10).map(m => `- [${m.type}] ${m.content}`).join("\n") || "无"}

返回JSON格式的记忆列表。每条记忆包含 type, content, importance(0-1)。
只提取确定的、有价值的信息，不要猜测。`,
        },
        { role: "user", content: conversationText },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_memories",
          strict: true,
          schema: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["user_preference", "key_fact", "emotional_pattern", "personality_trait", "conversation_summary"],
                    },
                    content: { type: "string" },
                    importance: { type: "number" },
                  },
                  required: ["type", "content", "importance"],
                  additionalProperties: false,
                },
              },
            },
            required: ["memories"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof result.choices[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : JSON.stringify(result.choices[0]?.message?.content);
    const parsed = JSON.parse(content);

    const newMemories: MemoryEntry[] = [];

    for (const mem of parsed.memories || []) {
      // 检查是否与已有记忆重复
      // Check for duplicate memories
      let isDuplicate = false;
      for (const existing of existingMemories) {
        if (existing.content === mem.content) {
          isDuplicate = true;
          break;
        }
        if (existing.type === mem.type) {
          const existingEmb = await generateEmbedding(existing.content).catch(() => []);
          const newEmb = await generateEmbedding(mem.content).catch(() => []);
          if (existingEmb.length > 0 && newEmb.length > 0 && cosineSimilarity(existingEmb, newEmb) > 0.85) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (!isDuplicate) {
        const embedding = await generateEmbedding(mem.content);
        const id = await storeMemory({
          userId,
          avatarId,
          type: mem.type,
          content: mem.content,
          embedding,
          metadata: { source: "conversation_extraction", messageCount: messages.length },
          importance: Math.min(1, Math.max(0, mem.importance)),
        });

        newMemories.push({
          id,
          userId,
          avatarId,
          type: mem.type,
          content: mem.content,
          embedding,
          metadata: { source: "conversation_extraction" },
          importance: mem.importance,
          accessCount: 0,
          lastAccessedAt: Date.now(),
          createdAt: Date.now(),
        });
      }
    }

    return newMemories;
  } catch (error) {
    console.error("[VectorMemory] Memory extraction failed:", error);
    return [];
  }
}

// ========== Memory Context Builder ==========

/** 构建对话的记忆上下文（注入到 LLM prompt 中） */
export async function buildMemoryContext(
  userId: number,
  avatarId: number,
  currentQuery: string
): Promise<MemoryContext> {
  // 并行搜索不同类型的记忆
  const [relevantMemories, userPreferences, emotionalPatterns, personalityTraits] = await Promise.all([
    searchMemories(userId, avatarId, currentQuery, { topK: 5, minSimilarity: 0.25 }),
    searchMemories(userId, avatarId, currentQuery, { topK: 3, types: ["user_preference"] }),
    searchMemories(userId, avatarId, currentQuery, { topK: 2, types: ["emotional_pattern"] }),
    searchMemories(userId, avatarId, currentQuery, { topK: 2, types: ["personality_trait"] }),
  ]);

  // 去重
  const seenIds = new Set<string>();
  const dedup = (results: MemorySearchResult[]) =>
    results.filter(r => {
      if (seenIds.has(r.entry.id)) return false;
      seenIds.add(r.entry.id);
      return true;
    });

  const allRelevant = dedup(relevantMemories);
  const allPrefs = dedup(userPreferences);
  const allEmotional = dedup(emotionalPatterns);
  const allPersonality = dedup(personalityTraits);

  // 格式化为 prompt 文本
  const sections: string[] = [];

  if (allPrefs.length > 0) {
    sections.push("【用户偏好】\n" + allPrefs.map(r => `- ${r.entry.content}`).join("\n"));
  }

  if (allPersonality.length > 0) {
    sections.push("【性格特征】\n" + allPersonality.map(r => `- ${r.entry.content}`).join("\n"));
  }

  if (allEmotional.length > 0) {
    sections.push("【情感模式】\n" + allEmotional.map(r => `- ${r.entry.content}`).join("\n"));
  }

  if (allRelevant.length > 0) {
    const nonPrefRelevant = allRelevant.filter(
      r => !["user_preference", "personality_trait", "emotional_pattern"].includes(r.entry.type)
    );
    if (nonPrefRelevant.length > 0) {
      sections.push("【相关记忆】\n" + nonPrefRelevant.map(r => `- ${r.entry.content} (相关度: ${(r.similarity * 100).toFixed(0)}%)`).join("\n"));
    }
  }

  const formattedContext = sections.length > 0
    ? `\n--- 长期记忆 ---\n${sections.join("\n\n")}\n--- 记忆结束 ---\n`
    : "";

  return {
    relevantMemories: allRelevant,
    userPreferences: allPrefs.map(r => r.entry),
    emotionalPatterns: allEmotional.map(r => r.entry),
    personalityTraits: allPersonality.map(r => r.entry),
    formattedContext,
  };
}

/** 手动添加记忆 */
export async function addManualMemory(
  userId: number,
  avatarId: number,
  type: MemoryEntry["type"],
  content: string,
  importance: number = 0.8
): Promise<string> {
  const embedding = await generateEmbedding(content);
  return storeMemory({
    userId,
    avatarId,
    type,
    content,
    embedding,
    metadata: { source: "manual" },
    importance,
  });
}

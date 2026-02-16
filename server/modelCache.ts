/**
 * GLB 模型 S3 缓存服务 (Model Cache Service)
 * 
 * 对已生成的 SMPL-X 拟合结果进行缓存，避免重复计算。
 * 缓存策略：
 * 1. 缓存键：基于输入参数（图片hash + 骨架参数 + 外观参数）生成唯一hash
 * 2. 存储：GLB 文件存储在 S3，元数据存储在 MySQL
 * 3. 失效：30天自动过期 + 参数变更时主动失效
 * 4. LRU：超过存储限额时，淘汰最久未命中的缓存
 */

import { getDb } from "./db";
import { storagePut, storageGet } from "./storage";
import { nanoid } from "nanoid";

// ========== Types ==========

export interface CacheEntry {
  id: number;
  cacheKey: string;
  userId: number;
  avatarId: number | null;
  cacheType: "smplx_fit" | "clothing_render" | "final_render";
  modelUrl: string;
  modelKey: string;
  paramsHash: string;
  paramsSnapshot: Record<string, any> | null;
  fileSize: number | null;
  hitCount: number;
  lastHitAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CacheResult {
  hit: boolean;
  modelUrl?: string;
  cacheEntry?: CacheEntry;
}

// ========== Hash Generation ==========

/**
 * 生成参数的确定性 hash（用作缓存键）
 * 使用简单的字符串hash算法，足够用于缓存键
 */
export function generateParamsHash(params: Record<string, any>): string {
  const str = JSON.stringify(params, Object.keys(params).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // 转换为16进制并补零
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  // 添加长度信息避免碰撞
  const lenHex = str.length.toString(16).padStart(4, "0");
  return `${hex}${lenHex}`;
}

/**
 * 生成完整的缓存键
 * 格式: {cacheType}:{userId}:{paramsHash}
 */
export function buildCacheKey(
  cacheType: CacheEntry["cacheType"],
  userId: number,
  params: Record<string, any>
): string {
  const paramsHash = generateParamsHash(params);
  return `${cacheType}:${userId}:${paramsHash}`;
}

// ========== Cache Operations ==========

/** 默认缓存过期时间：30天 */
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 每个用户最大缓存数量 */
const MAX_CACHE_PER_USER = 50;

/**
 * 查询缓存
 * 返回缓存命中结果，如果命中则更新命中计数
 */
export async function getCachedModel(
  cacheKey: string
): Promise<CacheResult> {
  const db = await getDb();
  if (!db) return { hit: false };

  try {
    const rows = await db.execute({
      sql: `SELECT * FROM model_cache WHERE cacheKey = ? LIMIT 1`,
      params: [cacheKey],
    } as any) as any;

    const row = (rows[0] || rows)?.[0];
    if (!row) return { hit: false };

    // 检查是否过期
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      // 过期，删除缓存
      await db.execute({
        sql: `DELETE FROM model_cache WHERE id = ?`,
        params: [row.id],
      } as any);
      return { hit: false };
    }

    // 更新命中计数
    await db.execute({
      sql: `UPDATE model_cache SET hitCount = hitCount + 1, lastHitAt = NOW() WHERE id = ?`,
      params: [row.id],
    } as any);

    return {
      hit: true,
      modelUrl: row.modelUrl,
      cacheEntry: {
        id: row.id,
        cacheKey: row.cacheKey,
        userId: row.userId,
        avatarId: row.avatarId,
        cacheType: row.cacheType,
        modelUrl: row.modelUrl,
        modelKey: row.modelKey,
        paramsHash: row.paramsHash,
        paramsSnapshot: typeof row.paramsSnapshot === "string" ? JSON.parse(row.paramsSnapshot) : row.paramsSnapshot,
        fileSize: row.fileSize,
        hitCount: row.hitCount + 1,
        lastHitAt: new Date(),
        expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        createdAt: new Date(row.createdAt),
      },
    };
  } catch (error) {
    console.warn("[ModelCache] Cache lookup failed:", error);
    return { hit: false };
  }
}

/**
 * 存储模型到缓存
 * 将 GLB 文件上传到 S3 并记录缓存元数据
 */
export async function cacheModel(options: {
  cacheKey: string;
  userId: number;
  avatarId?: number;
  cacheType: CacheEntry["cacheType"];
  /** GLB 文件数据 (Buffer) */
  modelData: Buffer;
  /** 输入参数（用于快照） */
  params: Record<string, any>;
  /** 自定义过期时间(ms)，默认30天 */
  ttlMs?: number;
}): Promise<{ modelUrl: string; modelKey: string }> {
  const {
    cacheKey,
    userId,
    avatarId,
    cacheType,
    modelData,
    params,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  } = options;

  // 上传到 S3
  const suffix = nanoid(8);
  const s3Key = `model-cache/${userId}/${cacheType}-${suffix}.glb`;

  const { url: modelUrl } = await storagePut(s3Key, modelData, "model/gltf-binary");

  const paramsHash = generateParamsHash(params);
  const expiresAt = new Date(Date.now() + ttlMs);

  const db = await getDb();
  if (!db) {
    return { modelUrl, modelKey: s3Key };
  }

  try {
    // 先检查是否需要淘汰旧缓存（LRU）
    await evictOldCache(userId);

    // 插入缓存记录（使用 REPLACE 避免重复键冲突）
    await db.execute({
      sql: `REPLACE INTO model_cache (cacheKey, userId, avatarId, cacheType, modelUrl, modelKey, paramsHash, paramsSnapshot, fileSize, hitCount, lastHitAt, expiresAt, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NOW())`,
      params: [
        cacheKey,
        userId,
        avatarId || null,
        cacheType,
        modelUrl,
        s3Key,
        paramsHash,
        JSON.stringify(params),
        modelData.length,
        expiresAt,
      ],
    } as any);
  } catch (error) {
    console.warn("[ModelCache] Failed to store cache metadata:", error);
  }

  return { modelUrl, modelKey: s3Key };
}

/**
 * 淘汰旧缓存（LRU策略）
 * 当用户缓存数量超过限额时，删除最久未命中的缓存
 */
async function evictOldCache(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // 统计当前用户的缓存数量
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM model_cache WHERE userId = ?`,
      params: [userId],
    } as any) as any;

    const count = (countResult[0] || countResult)?.[0]?.cnt || 0;

    if (count >= MAX_CACHE_PER_USER) {
      // 删除最久未命中的缓存（保留最新的 MAX_CACHE_PER_USER - 5 条）
      const toKeep = MAX_CACHE_PER_USER - 5;
      await db.execute({
        sql: `DELETE FROM model_cache 
              WHERE userId = ? AND id NOT IN (
                SELECT id FROM (
                  SELECT id FROM model_cache 
                  WHERE userId = ? 
                  ORDER BY COALESCE(lastHitAt, createdAt) DESC 
                  LIMIT ${toKeep}
                ) as keep_ids
              )`,
        params: [userId, userId],
      } as any);
    }

    // 同时清理所有已过期的缓存
    await db.execute({
      sql: `DELETE FROM model_cache WHERE expiresAt IS NOT NULL AND expiresAt < NOW()`,
      params: [],
    } as any);
  } catch (error) {
    console.warn("[ModelCache] Cache eviction failed:", error);
  }
}

/**
 * 主动失效指定数字人的缓存
 * 当用户修改了参数后，旧缓存不再有效
 */
export async function invalidateCache(
  userId: number,
  avatarId: number,
  cacheType?: CacheEntry["cacheType"]
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    let sql = `DELETE FROM model_cache WHERE userId = ? AND avatarId = ?`;
    const params: any[] = [userId, avatarId];

    if (cacheType) {
      sql += ` AND cacheType = ?`;
      params.push(cacheType);
    }

    const result = await db.execute({ sql, params } as any) as any;
    const affected = result[0]?.affectedRows || result?.affectedRows || 0;
    return affected;
  } catch (error) {
    console.warn("[ModelCache] Cache invalidation failed:", error);
    return 0;
  }
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(userId: number): Promise<{
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  byType: Record<string, { count: number; size: number; hits: number }>;
}> {
  const db = await getDb();
  if (!db) {
    return { totalEntries: 0, totalSize: 0, hitRate: 0, byType: {} };
  }

  try {
    const rows = await db.execute({
      sql: `SELECT cacheType, COUNT(*) as cnt, SUM(COALESCE(fileSize, 0)) as totalSize, SUM(hitCount) as totalHits
            FROM model_cache WHERE userId = ? GROUP BY cacheType`,
      params: [userId],
    } as any) as any;

    const results = rows[0] || rows || [];
    let totalEntries = 0;
    let totalSize = 0;
    let totalHits = 0;
    const byType: Record<string, { count: number; size: number; hits: number }> = {};

    for (const row of results) {
      const count = Number(row.cnt) || 0;
      const size = Number(row.totalSize) || 0;
      const hits = Number(row.totalHits) || 0;
      totalEntries += count;
      totalSize += size;
      totalHits += hits;
      byType[row.cacheType] = { count, size, hits };
    }

    return {
      totalEntries,
      totalSize,
      hitRate: totalEntries > 0 ? totalHits / (totalHits + totalEntries) : 0,
      byType,
    };
  } catch (error) {
    console.warn("[ModelCache] Failed to get cache stats:", error);
    return { totalEntries: 0, totalSize: 0, hitRate: 0, byType: {} };
  }
}

/**
 * 清除用户所有缓存
 */
export async function clearUserCache(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const result = await db.execute({
      sql: `DELETE FROM model_cache WHERE userId = ?`,
      params: [userId],
    } as any) as any;
    return result[0]?.affectedRows || result?.affectedRows || 0;
  } catch (error) {
    console.warn("[ModelCache] Failed to clear user cache:", error);
    return 0;
  }
}

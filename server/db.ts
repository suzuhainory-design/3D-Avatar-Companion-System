import { eq, and, desc, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  avatars, InsertAvatar, Avatar,
  avatarStepHistory, InsertAvatarStepHistory,
  clothingItems, InsertClothingItem,
  chatSessions, InsertChatSession,
  chatMessages, InsertChatMessage,
  uploadedFiles, InsertUploadedFile,
  userPreferences, InsertUserPreference,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ========== User Helpers ==========
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ========== Avatar Helpers ==========
export async function createAvatar(data: InsertAvatar) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(avatars).values(data);
  return result[0].insertId;
}

export async function getAvatarById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(avatars).where(eq(avatars.id, id)).limit(1);
  return result[0];
}

export async function getUserAvatars(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(avatars).where(eq(avatars.userId, userId)).orderBy(desc(avatars.updatedAt));
}

export async function updateAvatar(id: number, data: Partial<InsertAvatar>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(avatars).set(data).where(eq(avatars.id, id));
}

export async function deleteAvatar(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(avatars).where(eq(avatars.id, id));
}

// ========== Avatar Step History Helpers ==========
export async function saveStepHistory(data: InsertAvatarStepHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(avatarStepHistory).values(data);
}

export async function getStepHistory(avatarId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(avatarStepHistory)
    .where(eq(avatarStepHistory.avatarId, avatarId))
    .orderBy(asc(avatarStepHistory.stepOrder));
}

export async function getLatestStepSnapshot(avatarId: number, stepName: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(avatarStepHistory)
    .where(and(eq(avatarStepHistory.avatarId, avatarId), eq(avatarStepHistory.stepName, stepName)))
    .orderBy(desc(avatarStepHistory.stepOrder))
    .limit(1);
  return result[0];
}

export async function deleteStepsAfter(avatarId: number, stepOrder: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete all steps with order > stepOrder for rollback
  const allSteps = await db.select().from(avatarStepHistory)
    .where(eq(avatarStepHistory.avatarId, avatarId));
  const toDelete = allSteps.filter(s => s.stepOrder > stepOrder);
  for (const step of toDelete) {
    await db.delete(avatarStepHistory).where(eq(avatarStepHistory.id, step.id));
  }
}

// ========== Clothing Helpers ==========
export async function createClothingItem(data: InsertClothingItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clothingItems).values(data);
  return result[0].insertId;
}

export async function getClothingItems(userId?: number) {
  const db = await getDb();
  if (!db) return [];
  if (userId) {
    // Get default items + user's custom items
    const defaults = await db.select().from(clothingItems).where(eq(clothingItems.isDefault, 1));
    const custom = await db.select().from(clothingItems).where(eq(clothingItems.userId, userId));
    return [...defaults, ...custom.filter(c => !c.isDefault)];
  }
  return db.select().from(clothingItems).where(eq(clothingItems.isDefault, 1));
}

export async function getClothingItemById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clothingItems).where(eq(clothingItems.id, id)).limit(1);
  return result[0];
}

export async function updateClothingItem(id: number, data: Partial<InsertClothingItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(clothingItems).set(data).where(eq(clothingItems.id, id));
}

// ========== Chat Session Helpers ==========
export async function createChatSession(data: InsertChatSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatSessions).values(data);
  return result[0].insertId;
}

export async function getUserChatSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatSessions)
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(chatSessions.updatedAt));
}

export async function getChatSessionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
  return result[0];
}

export async function updateChatSession(id: number, data: Partial<InsertChatSession>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chatSessions).set(data).where(eq(chatSessions.id, id));
}

// ========== Chat Message Helpers ==========
export async function createChatMessage(data: InsertChatMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatMessages).values(data);
  return result[0].insertId;
}

export async function getSessionMessages(sessionId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit);
}

export async function updateChatMessage(id: number, data: Partial<InsertChatMessage>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chatMessages).set(data).where(eq(chatMessages.id, id));
}

// ========== File Upload Helpers ==========
export async function createFileRecord(data: InsertUploadedFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(uploadedFiles).values(data);
  return result[0].insertId;
}

export async function getUserFiles(userId: number, purpose?: string) {
  const db = await getDb();
  if (!db) return [];
  if (purpose) {
    return db.select().from(uploadedFiles)
      .where(and(eq(uploadedFiles.userId, userId), eq(uploadedFiles.purpose, purpose as any)))
      .orderBy(desc(uploadedFiles.createdAt));
  }
  return db.select().from(uploadedFiles)
    .where(eq(uploadedFiles.userId, userId))
    .orderBy(desc(uploadedFiles.createdAt));
}

// ========== User Preferences Helpers ==========
export async function setUserPreference(data: InsertUserPreference) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Upsert by userId + category + prefKey
  const existing = await db.select().from(userPreferences)
    .where(and(
      eq(userPreferences.userId, data.userId),
      eq(userPreferences.category, data.category),
      eq(userPreferences.prefKey, data.prefKey)
    )).limit(1);
  if (existing.length > 0) {
    await db.update(userPreferences)
      .set({ prefValue: data.prefValue, embeddingId: data.embeddingId })
      .where(eq(userPreferences.id, existing[0].id));
  } else {
    await db.insert(userPreferences).values(data);
  }
}

export async function getUserPreferences(userId: number, category?: string) {
  const db = await getDb();
  if (!db) return [];
  if (category) {
    return db.select().from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.category, category)));
  }
  return db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
}

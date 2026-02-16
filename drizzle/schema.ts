import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, float, bigint, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 3D数字人模型表 - 存储用户创建的数字人及其所有参数
 */
export const avatars = mysqlTable("avatars", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull().default("我的数字人"),
  /** 创建状态: draft(草稿) / customizing(定制中) / rendering(渲染中) / completed(完成) */
  status: mysqlEnum("status", ["draft", "customizing", "rendering", "completed"]).default("draft").notNull(),
  /** 当前创建步骤: upload / skeleton / appearance / hair / clothing / final */
  currentStep: varchar("currentStep", { length: 32 }).default("upload").notNull(),
  /** 原始上传图片URL (S3) */
  sourceImageUrl: text("sourceImageUrl"),
  /** SAM分割后的人体图片URL */
  segmentedImageUrl: text("segmentedImageUrl"),
  /** 性别 */
  gender: mysqlEnum("gender", ["male", "female"]).default("female").notNull(),
  /** 骨架参数 JSON: { height, shoulderWidth, hipHeight, hipWidth, armLength, legLength, ... } */
  skeletonParams: json("skeletonParams"),
  /** 肤色参数 JSON: { r, g, b, brightness, saturation } */
  skinParams: json("skinParams"),
  /** 五官参数 JSON: { eyeSize, eyeDistance, noseHeight, noseWidth, mouthWidth, jawWidth, faceDepth, ... } */
  facialParams: json("facialParams"),
  /** 性别特征参数 JSON: { breastSize(女), adamsAppleSize(男), adamsAppleProminence(男) } */
  genderFeatureParams: json("genderFeatureParams"),
  /** 妆容参数 JSON: { eyeshadowColor, blushColor, lipColor, eyeshadowIntensity, ... } */
  makeupParams: json("makeupParams"),
  /** 发型参数 JSON: { style, length, color, gradientEnabled, gradientColors, tipStyle, midStyle, rootStyle } */
  hairParams: json("hairParams"),
  /** 当前穿着的服装ID */
  clothingId: int("clothingId"),
  /** 最终身高(cm) */
  finalHeight: float("finalHeight"),
  /** 最终生成的3D模型文件URL (.glb) */
  modelFileUrl: text("modelFileUrl"),
  /** 模型文件S3 key */
  modelFileKey: varchar("modelFileKey", { length: 512 }),
  /** SMPL-X模型参数 JSON (beta, expression等) */
  smplxParams: json("smplxParams"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Avatar = typeof avatars.$inferSelect;
export type InsertAvatar = typeof avatars.$inferInsert;

/**
 * 数字人创建步骤历史 - 支持回退功能
 */
export const avatarStepHistory = mysqlTable("avatarStepHistory", {
  id: int("id").autoincrement().primaryKey(),
  avatarId: int("avatarId").notNull(),
  /** 步骤名称: upload / skeleton / appearance / hair / clothing / final */
  stepName: varchar("stepName", { length: 32 }).notNull(),
  /** 该步骤的完整参数快照 JSON */
  paramsSnapshot: json("paramsSnapshot").notNull(),
  /** 步骤顺序 */
  stepOrder: int("stepOrder").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AvatarStepHistory = typeof avatarStepHistory.$inferSelect;
export type InsertAvatarStepHistory = typeof avatarStepHistory.$inferInsert;

/**
 * 服装库表
 */
export const clothingItems = mysqlTable("clothingItems", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  /** 服装名称 */
  name: varchar("name", { length: 255 }).notNull(),
  /** 服装类别: top / bottom / dress / outerwear / shoes / accessory */
  category: mysqlEnum("category", ["top", "bottom", "dress", "outerwear", "shoes", "accessory"]).notNull(),
  /** 是否为系统默认服装 */
  isDefault: int("isDefault").default(0).notNull(),
  /** 服装缩略图URL */
  thumbnailUrl: text("thumbnailUrl"),
  /** 原始上传图片URL (用户上传的) */
  sourceImageUrl: text("sourceImageUrl"),
  /** 3D模型文件URL (.glb) */
  modelFileUrl: text("modelFileUrl"),
  /** 模型文件S3 key */
  modelFileKey: varchar("modelFileKey", { length: 512 }),
  /** 默认颜色 JSON: { r, g, b } */
  defaultColor: json("defaultColor"),
  /** 当前用户自定义颜色 JSON: { r, g, b } */
  customColor: json("customColor"),
  /** 生成状态: pending / processing / completed / failed */
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClothingItem = typeof clothingItems.$inferSelect;
export type InsertClothingItem = typeof clothingItems.$inferInsert;

/**
 * 对话会话表
 */
export const chatSessions = mysqlTable("chatSessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  avatarId: int("avatarId").notNull(),
  /** 会话标题 */
  title: varchar("title", { length: 255 }).default("新对话").notNull(),
  /** 会话状态 */
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  /** 会话摘要 */
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * 对话消息表
 */
export const chatMessages = mysqlTable("chatMessages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  /** 消息角色 */
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  /** 消息文本内容 */
  content: text("content").notNull(),
  /** 附件文件URL列表 JSON */
  attachments: json("attachments"),
  /** 情绪分析结果 JSON: { emotion, intensity, description } */
  emotionAnalysis: json("emotionAnalysis"),
  /** 是否被打断 */
  wasInterrupted: int("wasInterrupted").default(0).notNull(),
  /** 打断时已播放的内容 */
  interruptedAtContent: text("interruptedAtContent"),
  /** TTS音频URL */
  ttsAudioUrl: text("ttsAudioUrl"),
  /** 向量embedding ID (用于向量数据库检索) */
  embeddingId: varchar("embeddingId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * 用户上传文件记录表
 */
export const uploadedFiles = mysqlTable("uploadedFiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** 原始文件名 */
  originalName: varchar("originalName", { length: 512 }).notNull(),
  /** MIME类型 */
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  /** 文件大小(bytes) */
  fileSize: bigint("fileSize", { mode: "number" }).notNull(),
  /** S3 URL */
  url: text("url").notNull(),
  /** S3 key */
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  /** 文件用途: avatar_source / clothing_source / chat_attachment / model_output */
  purpose: mysqlEnum("purpose", ["avatar_source", "clothing_source", "chat_attachment", "model_output"]).notNull(),
  /** 关联的数字人ID或会话ID */
  relatedId: int("relatedId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type InsertUploadedFile = typeof uploadedFiles.$inferInsert;

/**
 * 用户偏好表 - 用于长期记忆
 */
export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** 偏好类别 */
  category: varchar("category", { length: 64 }).notNull(),
  /** 偏好键 */
  prefKey: varchar("prefKey", { length: 128 }).notNull(),
  /** 偏好值 */
  prefValue: text("prefValue").notNull(),
  /** 向量embedding ID */
  embeddingId: varchar("embeddingId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

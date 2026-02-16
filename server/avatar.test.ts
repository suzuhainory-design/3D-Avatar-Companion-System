import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock database module
vi.mock("./db", () => ({
  createAvatar: vi.fn().mockResolvedValue(1),
  getUserAvatars: vi.fn().mockResolvedValue([
    { id: 1, userId: 1, name: "测试数字人", gender: "female", status: "draft", currentStep: "upload" },
  ]),
  getAvatarById: vi.fn().mockResolvedValue({
    id: 1, userId: 1, name: "测试数字人", gender: "female", status: "draft", currentStep: "upload",
    skeletonParams: null, skinParams: null, facialParams: null,
  }),
  updateAvatar: vi.fn().mockResolvedValue(undefined),
  deleteAvatar: vi.fn().mockResolvedValue(undefined),
  saveStepHistory: vi.fn().mockResolvedValue(1),
  getStepHistory: vi.fn().mockResolvedValue([
    { id: 1, avatarId: 1, stepName: "skeleton", stepOrder: 1, paramsSnapshot: { height: 170 } },
  ]),
  deleteStepsAfter: vi.fn().mockResolvedValue(undefined),
  getClothingItems: vi.fn().mockResolvedValue([]),
  getClothingItemById: vi.fn().mockResolvedValue(null),
  createClothingItem: vi.fn().mockResolvedValue(1),
  updateClothingItem: vi.fn().mockResolvedValue(undefined),
  createChatSession: vi.fn().mockResolvedValue(1),
  getUserChatSessions: vi.fn().mockResolvedValue([]),
  getChatSessionById: vi.fn().mockResolvedValue({ id: 1, userId: 1, avatarId: 1 }),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  createChatMessage: vi.fn().mockResolvedValue(1),
  updateChatMessage: vi.fn().mockResolvedValue(undefined),
  createFileRecord: vi.fn().mockResolvedValue(1),
  getUserFiles: vi.fn().mockResolvedValue([]),
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: "你好！很高兴认识你！[EMOTION]{\"emotion\":\"happy\",\"intensity\":0.8,\"description\":\"开心\"}[/EMOTION]",
      },
    }],
  }),
}));

// Mock voice transcription
vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({ text: "测试语音", language: "zh" }),
}));

// Mock notification
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Mock storage
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://example.com/test.png", key: "test.png" }),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: "test-user",
    email: "test@example.com",
    name: "测试用户",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("Avatar Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = appRouter.createCaller(createTestContext());
  });

  it("创建数字人", async () => {
    const result = await caller.avatar.create({ name: "我的数字人", gender: "female" });
    expect(result).toHaveProperty("id");
    expect(result.id).toBe(1);
  });

  it("获取数字人列表", async () => {
    const result = await caller.avatar.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("name", "测试数字人");
  });

  it("获取单个数字人", async () => {
    const result = await caller.avatar.get({ id: 1 });
    expect(result).toHaveProperty("name", "测试数字人");
    expect(result).toHaveProperty("gender", "female");
  });

  it("更新数字人参数", async () => {
    const result = await caller.avatar.update({
      id: 1,
      skeletonParams: { height: 175, shoulderWidth: 42 },
      currentStep: "skeleton",
    });
    expect(result).toEqual({ success: true });
  });

  it("保存步骤快照", async () => {
    const result = await caller.avatar.saveStep({
      avatarId: 1,
      stepName: "skeleton",
      paramsSnapshot: { height: 170, shoulderWidth: 40 },
      stepOrder: 1,
    });
    expect(result).toEqual({ success: true });
  });

  it("获取步骤历史", async () => {
    const result = await caller.avatar.getStepHistory({ avatarId: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("stepName", "skeleton");
  });

  it("回退到指定步骤", async () => {
    const result = await caller.avatar.rollbackToStep({ avatarId: 1, stepOrder: 1 });
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("restoredStep", "skeleton");
  });

  it("删除数字人", async () => {
    const result = await caller.avatar.delete({ id: 1 });
    expect(result).toEqual({ success: true });
  });

  it("拒绝访问其他用户的数字人", async () => {
    const { getAvatarById } = await import("./db");
    (getAvatarById as any).mockResolvedValueOnce({ id: 1, userId: 999, name: "他人的数字人" });

    await expect(caller.avatar.get({ id: 1 })).rejects.toThrow("数字人不存在");
  });
});

describe("Chat Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = appRouter.createCaller(createTestContext());
  });

  it("创建对话会话", async () => {
    const result = await caller.chat.createSession({ avatarId: 1, title: "测试对话" });
    expect(result).toHaveProperty("id", 1);
  });

  it("发送消息并获取LLM回复", async () => {
    const result = await caller.chat.sendMessage({
      sessionId: 1,
      content: "你好",
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("emotionAnalysis");
    expect(result.emotionAnalysis).toHaveProperty("emotion", "happy");
    expect(result.emotionAnalysis).toHaveProperty("intensity", 0.8);
    // Verify emotion was parsed and content was cleaned
    expect(result.content).not.toContain("[EMOTION]");
  });

  it("发送带附件的消息", async () => {
    const result = await caller.chat.sendMessage({
      sessionId: 1,
      content: "看看这张图片",
      attachments: [
        { url: "https://example.com/image.jpg", name: "test.jpg", mimeType: "image/jpeg" },
      ],
    });
    expect(result).toHaveProperty("content");
  });

  it("标记消息被打断", async () => {
    const result = await caller.chat.interruptMessage({
      messageId: 1,
      interruptedAtContent: "你好！很高兴认识",
    });
    expect(result).toEqual({ success: true });
  });
});

describe("Emotion Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const llmModule = await import("./_core/llm");
    (llmModule.invokeLLM as any).mockResolvedValue({
      choices: [{
        message: {
          content: '{"emotion":"happy","intensity":0.9,"description":"非常开心"}',
        },
      }],
    });
    caller = appRouter.createCaller(createTestContext());
  });

  it("分析文本情绪", async () => {
    const result = await caller.emotion.analyze({ text: "今天天气真好！" });
    expect(result).toHaveProperty("emotion", "happy");
    expect(result).toHaveProperty("intensity", 0.9);
    expect(result).toHaveProperty("description");
  });
});

describe("File Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = appRouter.createCaller(createTestContext());
  });

  it("上传文件", async () => {
    const result = await caller.file.upload({
      fileName: "test.png",
      mimeType: "image/png",
      base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      purpose: "avatar_source",
    });
    expect(result).toHaveProperty("id", 1);
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("fileKey");
  });

  it("获取文件列表", async () => {
    const result = await caller.file.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

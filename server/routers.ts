import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";
import * as db from "./db";
import { nanoid } from "nanoid";
import { synthesizeSpeech, synthesizeSpeechStream, listVoices, validateApiKey, getDefaultVoiceId } from "./tts";
import { checkModelServiceHealth, fitMeshToGlb, generateGlbFromParams, getModelInfo } from "./modelService";
import { buildMemoryContext, extractMemoriesFromConversation, searchMemories, getAllMemories, addManualMemory, deleteMemory, clearMemories, getMemoryStats } from "./vectorMemory";
import { buildCacheKey, getCachedModel, cacheModel, invalidateCache, getCacheStats, clearUserCache } from "./modelCache";

// ========== Avatar Router ==========
const avatarRouter = router({
  /** 创建新数字人 */
  create: protectedProcedure
    .input(z.object({
      name: z.string().optional(),
      gender: z.enum(["male", "female"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createAvatar({
        userId: ctx.user.id,
        name: input.name || "我的数字人",
        gender: input.gender || "female",
        status: "draft",
        currentStep: "upload",
      });
      return { id };
    }),

  /** 获取用户所有数字人 */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getUserAvatars(ctx.user.id);
  }),

  /** 获取单个数字人详情 */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.id);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      return avatar;
    }),

  /** 更新数字人参数 */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      gender: z.enum(["male", "female"]).optional(),
      currentStep: z.string().optional(),
      status: z.enum(["draft", "customizing", "rendering", "completed"]).optional(),
      sourceImageUrl: z.string().optional(),
      segmentedImageUrl: z.string().optional(),
      skeletonParams: z.any().optional(),
      skinParams: z.any().optional(),
      facialParams: z.any().optional(),
      genderFeatureParams: z.any().optional(),
      makeupParams: z.any().optional(),
      hairParams: z.any().optional(),
      clothingId: z.number().optional(),
      finalHeight: z.number().optional(),
      smplxParams: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.id);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      const { id, ...updateData } = input;
      await db.updateAvatar(id, updateData as any);
      return { success: true };
    }),

  /** 删除数字人 */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.id);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      await db.deleteAvatar(input.id);
      return { success: true };
    }),

  /** 保存步骤快照（支持回退） */
  saveStep: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      stepName: z.string(),
      paramsSnapshot: z.any(),
      stepOrder: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.avatarId);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      await db.saveStepHistory({
        avatarId: input.avatarId,
        stepName: input.stepName,
        paramsSnapshot: input.paramsSnapshot,
        stepOrder: input.stepOrder,
      });
      return { success: true };
    }),

  /** 获取步骤历史 */
  getStepHistory: protectedProcedure
    .input(z.object({ avatarId: z.number() }))
    .query(async ({ ctx, input }) => {
      return db.getStepHistory(input.avatarId);
    }),

  /** 回退到指定步骤 */
  rollbackToStep: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      stepOrder: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.avatarId);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      // Get the snapshot at the target step
      const history = await db.getStepHistory(input.avatarId);
      const targetStep = history.find(h => h.stepOrder === input.stepOrder);
      if (!targetStep) {
        throw new TRPCError({ code: "NOT_FOUND", message: "步骤快照不存在" });
      }
      // Delete all steps after the target
      await db.deleteStepsAfter(input.avatarId, input.stepOrder);
      // Restore avatar params from snapshot
      const snapshot = targetStep.paramsSnapshot as any;
      await db.updateAvatar(input.avatarId, {
        currentStep: targetStep.stepName,
        ...snapshot,
      });
      return { success: true, restoredStep: targetStep.stepName };
    }),

  /** 模拟3D模型生成（SAM分割 + SMPL-X拟合） */
  generateModel: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      sourceImageUrl: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.avatarId);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      try {
        // Update status to processing
        await db.updateAvatar(input.avatarId, {
          status: "customizing",
          sourceImageUrl: input.sourceImageUrl,
          currentStep: "skeleton",
          // Initialize default SMPL-X parameters
          smplxParams: {
            betas: Array(10).fill(0),
            expression: Array(10).fill(0),
            globalOrient: [0, 0, 0],
            bodyPose: Array(63).fill(0),
          },
          skeletonParams: {
            height: 170, shoulderWidth: 40, hipHeight: 90, hipWidth: 35,
            armLength: 60, legLength: 80, torsoLength: 50, neckLength: 10,
          },
          skinParams: { r: 235, g: 200, b: 178, brightness: 50, saturation: 50 },
          facialParams: {
            eyeSize: 50, eyeDistance: 50, eyeHeight: 50,
            noseHeight: 50, noseWidth: 50, noseBridge: 50,
            mouthWidth: 50, mouthHeight: 50, lipThickness: 50,
            jawWidth: 50, jawHeight: 50, chinLength: 50,
            cheekboneHeight: 50, faceDepth: 50,
          },
          genderFeatureParams: avatar.gender === "female"
            ? { breastSize: 50 }
            : { adamsAppleSize: 30, adamsAppleProminence: 30 },
          makeupParams: {
            eyeshadowColor: null, eyeshadowIntensity: 0,
            blushColor: null, blushIntensity: 0,
            lipColor: null, lipIntensity: 0,
            eyelinerIntensity: 0, foundationIntensity: 0,
          },
        });
        return {
          success: true,
          message: "模型生成成功，已初始化默认参数",
          nextStep: "skeleton",
        };
      } catch (error) {
        // Notify owner on failure
        await notifyOwner({
          title: "3D模型生成失败",
          content: `用户 ${ctx.user.name || ctx.user.openId} 的数字人(ID:${input.avatarId})模型生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "模型生成失败，请重试",
        });
      }
    }),

  /** 最终渲染 */
  finalRender: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      finalHeight: z.number().min(50).max(250),
    }))
    .mutation(async ({ ctx, input }) => {
      const avatar = await db.getAvatarById(input.avatarId);
      if (!avatar || avatar.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "数字人不存在" });
      }
      // Generate a model file key
      const fileKey = `avatars/${ctx.user.id}/${input.avatarId}/model-${nanoid()}.glb`;
      // In production, this would invoke the actual 3D rendering pipeline
      // For now, we mark it as completed with a placeholder
      await db.updateAvatar(input.avatarId, {
        status: "completed",
        currentStep: "final",
        finalHeight: input.finalHeight,
        modelFileKey: fileKey,
      });
      return {
        success: true,
        message: "最终渲染完成",
        modelFileKey: fileKey,
      };
    }),
});

// ========== Clothing Router ==========
const clothingRouter = router({
  /** 获取服装列表 */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.getClothingItems(ctx.user.id);
  }),

  /** 获取单件服装 */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const item = await db.getClothingItemById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "服装不存在" });
      return item;
    }),

  /** 上传自定义服装 */
  create: protectedProcedure
    .input(z.object({
      name: z.string(),
      category: z.enum(["top", "bottom", "dress", "outerwear", "shoes", "accessory"]),
      sourceImageUrl: z.string(),
      thumbnailUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createClothingItem({
        userId: ctx.user.id,
        name: input.name,
        category: input.category,
        isDefault: 0,
        sourceImageUrl: input.sourceImageUrl,
        thumbnailUrl: input.thumbnailUrl || input.sourceImageUrl,
        status: "processing",
        defaultColor: { r: 128, g: 128, b: 128 },
      });
      // In production, trigger async 3D model generation from the image
      // For now, mark as completed
      await db.updateClothingItem(id, { status: "completed" });
      return { id, message: "服装已添加到库中" };
    }),

  /** 更新服装颜色 */
  updateColor: protectedProcedure
    .input(z.object({
      id: z.number(),
      color: z.object({ r: z.number(), g: z.number(), b: z.number() }),
    }))
    .mutation(async ({ input }) => {
      await db.updateClothingItem(input.id, { customColor: input.color });
      return { success: true };
    }),
});

// ========== Chat Router ==========
const chatRouter = router({
  /** 创建新对话 */
  createSession: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      title: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createChatSession({
        userId: ctx.user.id,
        avatarId: input.avatarId,
        title: input.title || "新对话",
      });
      return { id };
    }),

  /** 获取用户对话列表 */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    return db.getUserChatSessions(ctx.user.id);
  }),

  /** 获取对话消息 */
  getMessages: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return db.getSessionMessages(input.sessionId, input.limit || 50);
    }),

  /** 发送消息并获取LLM回复（含情绪分析 + 长期记忆） */
  sendMessage: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      content: z.string(),
      avatarId: z.number().optional(),
      attachments: z.array(z.object({
        url: z.string(),
        name: z.string(),
        mimeType: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getChatSessionById(input.sessionId);
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "对话不存在" });
      }

      // Save user message
      await db.createChatMessage({
        sessionId: input.sessionId,
        role: "user",
        content: input.content,
        attachments: input.attachments || null,
      });

      // Get conversation history
      const history = await db.getSessionMessages(input.sessionId, 20);

      // Build memory context if avatarId is provided
      let memoryContextText = "";
      const avatarId = input.avatarId || session.avatarId;
      if (avatarId) {
        try {
          const memoryCtx = await buildMemoryContext(ctx.user.id, avatarId, input.content);
          memoryContextText = memoryCtx.formattedContext;
        } catch (e) {
          console.warn("[Chat] Memory context build failed:", e);
        }
      }

      // Build LLM messages with multimodal support + memory
      const systemPrompt = `你是一个友好的3D数字人伴侣。请用自然、有情感的方式回应用户。
${memoryContextText ? `\n你拥有以下关于用户的长期记忆，请在回应中自然地运用这些信息：${memoryContextText}` : ""}
在回复的末尾，请用JSON格式附加情绪分析：
[EMOTION]{"emotion":"happy|sad|surprised|angry|neutral|thinking|excited","intensity":0.0-1.0,"description":"简短描述"}[/EMOTION]`;

      const llmMessages: any[] = [{ role: "system" as const, content: systemPrompt }];

      for (const msg of history) {
        const msgContent: any[] = [{ type: "text", text: msg.content }];
        if (msg.attachments) {
          const attachments = msg.attachments as any[];
          for (const att of attachments) {
            if (att.mimeType?.startsWith("image/")) {
              msgContent.push({ type: "image_url", image_url: { url: att.url } });
            } else if (att.mimeType?.startsWith("audio/") || att.mimeType === "application/pdf" || att.mimeType?.startsWith("video/")) {
              msgContent.push({ type: "file_url", file_url: { url: att.url, mime_type: att.mimeType } });
            }
          }
        }
        llmMessages.push({
          role: msg.role as any,
          content: msgContent.length === 1 ? msg.content : msgContent,
        });
      }

      // Add current user message
      const currentContent: any[] = [{ type: "text", text: input.content }];
      if (input.attachments) {
        for (const att of input.attachments) {
          if (att.mimeType?.startsWith("image/")) {
            currentContent.push({ type: "image_url", image_url: { url: att.url } });
          } else if (att.mimeType?.startsWith("audio/") || att.mimeType === "application/pdf" || att.mimeType?.startsWith("video/")) {
            currentContent.push({ type: "file_url", file_url: { url: att.url, mime_type: att.mimeType } });
          }
        }
      }
      llmMessages.push({
        role: "user" as const,
        content: currentContent.length === 1 ? input.content : currentContent,
      });

      try {
        const llmResult = await invokeLLM({ messages: llmMessages });
        const rawContent = typeof llmResult.choices[0]?.message?.content === 'string'
          ? llmResult.choices[0].message.content
          : JSON.stringify(llmResult.choices[0]?.message?.content);

        // Parse emotion from response
        let displayContent = rawContent;
        let emotionAnalysis = { emotion: "neutral", intensity: 0.5, description: "平静" };
        const emotionMatch = rawContent.match(/\[EMOTION\]([\s\S]*?)\[\/EMOTION\]/);
        if (emotionMatch) {
          try {
            emotionAnalysis = JSON.parse(emotionMatch[1]);
            displayContent = rawContent.replace(/\[EMOTION\][\s\S]*?\[\/EMOTION\]/, "").trim();
          } catch { /* keep defaults */ }
        }

        // Save assistant message
        const msgId = await db.createChatMessage({
          sessionId: input.sessionId,
          role: "assistant",
          content: displayContent,
          emotionAnalysis,
        });

        // Async: extract memories from conversation (non-blocking)
        if (avatarId && history.length >= 4) {
          const existingMemories = await getAllMemories(ctx.user.id, avatarId).catch(() => []);
          const recentMsgs = [...history.slice(-6), { role: "user", content: input.content }, { role: "assistant", content: displayContent }];
          extractMemoriesFromConversation(ctx.user.id, avatarId, recentMsgs, existingMemories).catch(e =>
            console.warn("[Chat] Async memory extraction failed:", e)
          );
        }

        return {
          id: msgId,
          content: displayContent,
          emotionAnalysis,
          memoryUsed: memoryContextText.length > 0,
        };
      } catch (error) {
        await notifyOwner({
          title: "LLM对话失败",
          content: `用户 ${ctx.user.name || ctx.user.openId} 的对话(Session:${input.sessionId})LLM调用失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "对话处理失败，请重试",
        });
      }
    }),

  /** 标记消息被打断 */
  interruptMessage: protectedProcedure
    .input(z.object({
      messageId: z.number(),
      interruptedAtContent: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateChatMessage(input.messageId, {
        wasInterrupted: 1,
        interruptedAtContent: input.interruptedAtContent,
      });
      return { success: true };
    }),
});

// ========== File Upload Router ==========
const fileRouter = router({
  /** 上传文件到S3 */
  upload: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      mimeType: z.string(),
      base64Data: z.string(),
      purpose: z.enum(["avatar_source", "clothing_source", "chat_attachment", "model_output"]),
      relatedId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.base64Data, "base64");
      const ext = input.fileName.split(".").pop() || "bin";
      const fileKey = `uploads/${ctx.user.id}/${input.purpose}/${nanoid()}.${ext}`;

      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      const fileId = await db.createFileRecord({
        userId: ctx.user.id,
        originalName: input.fileName,
        mimeType: input.mimeType,
        fileSize: buffer.length,
        url,
        fileKey,
        purpose: input.purpose,
        relatedId: input.relatedId,
      });

      return { id: fileId, url, fileKey };
    }),

  /** 获取用户文件列表 */
  list: protectedProcedure
    .input(z.object({
      purpose: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      return db.getUserFiles(ctx.user.id, input?.purpose);
    }),
});

// ========== Voice Router ==========
const voiceRouter = router({
  /** 语音转文字 */
  transcribe: protectedProcedure
    .input(z.object({
      audioUrl: z.string(),
      language: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await transcribeAudio({
        audioUrl: input.audioUrl,
        language: input.language,
      });
      if ("error" in result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error,
          cause: result,
        });
      }
      return result;
    }),
});

// ========== Emotion Analysis Router ==========
const emotionRouter = router({
  /** 独立情绪分析 */
  analyze: protectedProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "分析以下文本的情绪。返回JSON格式：{\"emotion\":\"happy|sad|surprised|angry|neutral|thinking|excited\",\"intensity\":0.0-1.0,\"description\":\"简短描述\"}",
          },
          { role: "user", content: input.text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "emotion_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                emotion: { type: "string", enum: ["happy", "sad", "surprised", "angry", "neutral", "thinking", "excited"] },
                intensity: { type: "number" },
                description: { type: "string" },
              },
              required: ["emotion", "intensity", "description"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = typeof result.choices[0]?.message?.content === 'string'
        ? result.choices[0].message.content
        : JSON.stringify(result.choices[0]?.message?.content);
      return JSON.parse(content);
    }),
});

// ========== TTS Router ==========
const ttsRouter = router({
  /** 验证 ElevenLabs API Key */
  validateKey: protectedProcedure.query(async () => {
    const isValid = await validateApiKey();
    return { isValid };
  }),

  /** 获取可用语音列表 */
  listVoices: protectedProcedure.query(async () => {
    return listVoices();
  }),

  /** 合成语音（单次完整返回） */
  synthesize: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
      voiceId: z.string().optional(),
      language: z.string().optional(),
      stability: z.number().min(0).max(1).optional(),
      similarityBoost: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await synthesizeSpeech(input.text, {
          voiceId: input.voiceId || getDefaultVoiceId(input.language),
          stability: input.stability,
          similarityBoost: input.similarityBoost,
          language: input.language,
        });

        // Upload audio to S3 for client playback
        const audioKey = `tts/audio-${nanoid()}.mp3`;
        const { url: audioUrl } = await storagePut(audioKey, result.audioBuffer, "audio/mpeg");

        return {
          audioUrl,
          visemeTimeline: result.visemeTimeline,
          duration: result.duration,
          text: result.text,
        };
      } catch (error) {
        console.error("[TTS] Synthesis failed:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "语音合成失败，请重试",
        });
      }
    }),

  /** 发送消息并获取LLM回复 + TTS语音 + Viseme唇同步数据 */
  chatWithVoice: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      content: z.string(),
      voiceId: z.string().optional(),
      language: z.string().optional(),
      attachments: z.array(z.object({
        url: z.string(),
        name: z.string(),
        mimeType: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getChatSessionById(input.sessionId);
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "对话不存在" });
      }

      // Save user message
      await db.createChatMessage({
        sessionId: input.sessionId,
        role: "user",
        content: input.content,
        attachments: input.attachments || null,
      });

      // Get conversation history
      const history = await db.getSessionMessages(input.sessionId, 20);

      // Build memory context
      let memoryContextText = "";
      const avatarId = session.avatarId;
      if (avatarId) {
        try {
          const memoryCtx = await buildMemoryContext(ctx.user.id, avatarId, input.content);
          memoryContextText = memoryCtx.formattedContext;
        } catch (e) {
          console.warn("[ChatWithVoice] Memory context build failed:", e);
        }
      }

      // Build LLM messages with memory
      const systemPrompt = `你是一个友好的3D数字人伴侣。请用自然、有情感的方式回应用户。
${memoryContextText ? `\n你拥有以下关于用户的长期记忆，请在回应中自然地运用这些信息：${memoryContextText}` : ""}
在回复的末尾，请用JSON格式附加情绪分析：
[EMOTION]{"emotion":"happy|sad|surprised|angry|neutral|thinking|excited","intensity":0.0-1.0,"description":"简短描述"}[/EMOTION]`;
      const llmMessages: any[] = [{ role: "system" as const, content: systemPrompt }];

      for (const msg of history) {
        const msgContent: any[] = [{ type: "text", text: msg.content }];
        if (msg.attachments) {
          const attachments = msg.attachments as any[];
          for (const att of attachments) {
            if (att.mimeType?.startsWith("image/")) {
              msgContent.push({ type: "image_url", image_url: { url: att.url } });
            } else if (att.mimeType?.startsWith("audio/") || att.mimeType === "application/pdf" || att.mimeType?.startsWith("video/")) {
              msgContent.push({ type: "file_url", file_url: { url: att.url, mime_type: att.mimeType } });
            }
          }
        }
        llmMessages.push({
          role: msg.role as any,
          content: msgContent.length === 1 ? msg.content : msgContent,
        });
      }

      // Add current user message
      const currentContent: any[] = [{ type: "text", text: input.content }];
      if (input.attachments) {
        for (const att of input.attachments) {
          if (att.mimeType?.startsWith("image/")) {
            currentContent.push({ type: "image_url", image_url: { url: att.url } });
          } else if (att.mimeType?.startsWith("audio/") || att.mimeType === "application/pdf" || att.mimeType?.startsWith("video/")) {
            currentContent.push({ type: "file_url", file_url: { url: att.url, mime_type: att.mimeType } });
          }
        }
      }
      llmMessages.push({
        role: "user" as const,
        content: currentContent.length === 1 ? input.content : currentContent,
      });

      try {
        // Step 1: Get LLM response
        const llmResult = await invokeLLM({ messages: llmMessages });
        const rawContent = typeof llmResult.choices[0]?.message?.content === 'string'
          ? llmResult.choices[0].message.content
          : JSON.stringify(llmResult.choices[0]?.message?.content);

        // Parse emotion from response
        let displayContent = rawContent;
        let emotionAnalysis = { emotion: "neutral", intensity: 0.5, description: "平静" };
        const emotionMatch = rawContent.match(/\[EMOTION\]([\s\S]*?)\[\/EMOTION\]/);
        if (emotionMatch) {
          try {
            emotionAnalysis = JSON.parse(emotionMatch[1]);
            displayContent = rawContent.replace(/\[EMOTION\][\s\S]*?\[\/EMOTION\]/, "").trim();
          } catch { /* keep defaults */ }
        }

        // Step 2: Synthesize speech with ElevenLabs
        let audioUrl: string | null = null;
        let visemeTimeline: any[] = [];
        let audioDuration = 0;

        try {
          const ttsResult = await synthesizeSpeech(displayContent, {
            voiceId: input.voiceId || getDefaultVoiceId(input.language),
            language: input.language,
          });

          // Upload audio to S3
          const audioKey = `tts/chat-${nanoid()}.mp3`;
          const uploaded = await storagePut(audioKey, ttsResult.audioBuffer, "audio/mpeg");
          audioUrl = uploaded.url;
          visemeTimeline = ttsResult.visemeTimeline;
          audioDuration = ttsResult.duration;
        } catch (ttsError) {
          console.error("[TTS] Voice synthesis failed, continuing without audio:", ttsError);
          // Continue without audio - text response still works
        }

        // Step 3: Save assistant message
        const msgId = await db.createChatMessage({
          sessionId: input.sessionId,
          role: "assistant",
          content: displayContent,
          emotionAnalysis,
        });

        // Async: extract memories from conversation (non-blocking)
        if (avatarId && history.length >= 4) {
          const existingMemories = await getAllMemories(ctx.user.id, avatarId).catch(() => []);
          const recentMsgs = [...history.slice(-6), { role: "user", content: input.content }, { role: "assistant", content: displayContent }];
          extractMemoriesFromConversation(ctx.user.id, avatarId, recentMsgs, existingMemories).catch(e =>
            console.warn("[ChatWithVoice] Async memory extraction failed:", e)
          );
        }

        return {
          id: msgId,
          content: displayContent,
          emotionAnalysis,
          audioUrl,
          visemeTimeline,
          audioDuration,
          memoryUsed: memoryContextText.length > 0,
        };
      } catch (error) {
        await notifyOwner({
          title: "TTS对话失败",
          content: `用户 ${ctx.user.name || ctx.user.openId} 的TTS对话(Session:${input.sessionId})失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "对话处理失败，请重试",
        });
      }
    }),
});

// ========== Model Service Router ==========
const modelServiceRouter = router({
  /** 检查 Python 模型服务健康状态 */
  health: protectedProcedure.query(async () => {
    return checkModelServiceHealth();
  }),

  /** 获取模型服务信息 */
  info: protectedProcedure.query(async () => {
    try {
      return await getModelInfo();
    } catch {
      return {
        model_dir: "unknown",
        available_genders: [],
        joint_count: 22,
        joint_names: [],
        blendshape_names: [],
      };
    }
  }),

  /** SAM JSON → SMPL-X 拟合 → GLB 导出 */
  fitMesh: protectedProcedure
    .input(z.object({
      meshJsonBase64: z.string(),
      gender: z.enum(["male", "female", "neutral"]).optional(),
      targetHeight: z.number().optional(),
      iterations: z.number().optional(),
      avatarId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const meshBuffer = Buffer.from(input.meshJsonBase64, "base64");

      try {
        const result = await fitMeshToGlb({
          meshJsonBuffer: meshBuffer,
          gender: input.gender,
          targetHeight: input.targetHeight,
          iterations: input.iterations,
          exportGlb: true,
          includeSkeleton: true,
          includeBlendshapes: true,
        });

        if (!result.glbBuffer) {
          throw new Error("GLB 生成失败");
        }

        // Upload GLB to S3
        const glbKey = `models/${ctx.user.id}/avatar-${input.avatarId || nanoid()}.glb`;
        const { url: glbUrl } = await storagePut(glbKey, result.glbBuffer, "model/gltf-binary");

        // Update avatar record if avatarId provided
        if (input.avatarId) {
          await db.updateAvatar(input.avatarId, {
            modelFileUrl: glbUrl,
            status: "customizing",
          });
        }

        return {
          success: result.success,
          glbUrl,
          fitInfo: result.fitInfo,
        };
      } catch (error) {
        await notifyOwner({
          title: "模型拟合失败",
          content: `用户 ${ctx.user.name || ctx.user.openId} 的模型拟合失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `模型拟合失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
      }
    }),

  /** 从参数生成 GLB（带 S3 缓存） */
  generateGlb: protectedProcedure
    .input(z.object({
      betas: z.array(z.number()).optional(),
      bodyPose: z.array(z.number()).optional(),
      globalOrient: z.array(z.number()).optional(),
      translation: z.array(z.number()).optional(),
      scale: z.number().optional(),
      gender: z.enum(["male", "female", "neutral"]).optional(),
      skinColor: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      avatarId: z.number().optional(),
      skipCache: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Build cache key from params
        const cacheParams = {
          betas: input.betas,
          bodyPose: input.bodyPose,
          globalOrient: input.globalOrient,
          translation: input.translation,
          scale: input.scale,
          gender: input.gender,
          skinColor: input.skinColor,
        };
        const cacheKey = buildCacheKey("smplx_fit", ctx.user.id, cacheParams);

        // Check cache first (unless skipCache)
        if (!input.skipCache) {
          const cached = await getCachedModel(cacheKey);
          if (cached.hit && cached.modelUrl) {
            // Update avatar record if needed
            if (input.avatarId) {
              await db.updateAvatar(input.avatarId, { modelFileUrl: cached.modelUrl });
            }
            return { glbUrl: cached.modelUrl, fromCache: true };
          }
        }

        // Cache miss - generate new GLB
        const glbBuffer = await generateGlbFromParams({
          betas: input.betas,
          bodyPose: input.bodyPose,
          globalOrient: input.globalOrient,
          translation: input.translation,
          scale: input.scale,
          gender: input.gender,
          skinColor: input.skinColor,
        });

        // Store in cache (uploads to S3 automatically)
        const { modelUrl: glbUrl } = await cacheModel({
          cacheKey,
          userId: ctx.user.id,
          avatarId: input.avatarId,
          cacheType: "smplx_fit",
          modelData: glbBuffer,
          params: cacheParams,
        });

        if (input.avatarId) {
          await db.updateAvatar(input.avatarId, { modelFileUrl: glbUrl });
        }

        return { glbUrl, fromCache: false };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `GLB 生成失败: ${error instanceof Error ? error.message : "未知错误"}`,
        });
      }
    }),
});

// ========== Memory Router ==========
const memoryRouter = router({
  /** 获取指定数字人的所有记忆 */
  list: protectedProcedure
    .input(z.object({ avatarId: z.number() }))
    .query(async ({ ctx, input }) => {
      const memories = await getAllMemories(ctx.user.id, input.avatarId);
      return memories.map(m => ({
        id: m.id,
        type: m.type,
        content: m.content,
        importance: m.importance,
        accessCount: m.accessCount,
        createdAt: m.createdAt,
        lastAccessedAt: m.lastAccessedAt,
      }));
    }),

  /** 搜索相关记忆 */
  search: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      query: z.string(),
      topK: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const results = await searchMemories(ctx.user.id, input.avatarId, input.query, {
        topK: input.topK || 5,
      });
      return results.map(r => ({
        id: r.entry.id,
        type: r.entry.type,
        content: r.entry.content,
        importance: r.entry.importance,
        similarity: r.similarity,
      }));
    }),

  /** 手动添加记忆 */
  add: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      type: z.enum(["user_preference", "key_fact", "emotional_pattern", "personality_trait", "conversation_summary"]),
      content: z.string(),
      importance: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await addManualMemory(
        ctx.user.id,
        input.avatarId,
        input.type,
        input.content,
        input.importance,
      );
      return { id, success: true };
    }),

  /** 删除单条记忆 */
  delete: protectedProcedure
    .input(z.object({ memoryId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const success = await deleteMemory(input.memoryId, ctx.user.id);
      return { success };
    }),

  /** 清除指定数字人的所有记忆 */
  clear: protectedProcedure
    .input(z.object({ avatarId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const success = await clearMemories(ctx.user.id, input.avatarId);
      return { success };
    }),

  /** 获取记忆统计信息 */
  stats: protectedProcedure
    .input(z.object({ avatarId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getMemoryStats(ctx.user.id, input.avatarId);
    }),
});

// ========== Cache Router ==========
const cacheRouter = router({
  /** 获取缓存统计信息 */
  stats: protectedProcedure.query(async ({ ctx }) => {
    return getCacheStats(ctx.user.id);
  }),

  /** 失效指定数字人的缓存 */
  invalidate: protectedProcedure
    .input(z.object({
      avatarId: z.number(),
      cacheType: z.enum(["smplx_fit", "clothing_render", "final_render"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await invalidateCache(ctx.user.id, input.avatarId, input.cacheType);
      return { deleted };
    }),

  /** 清除用户所有缓存 */
  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    const deleted = await clearUserCache(ctx.user.id);
    return { deleted };
  }),
});

// ========== Main Router ==========
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  avatar: avatarRouter,
  clothing: clothingRouter,
  chat: chatRouter,
  file: fileRouter,
  voice: voiceRouter,
  emotion: emotionRouter,
  tts: ttsRouter,
  modelService: modelServiceRouter,
  memory: memoryRouter,
  cache: cacheRouter,
});

export type AppRouter = typeof appRouter;

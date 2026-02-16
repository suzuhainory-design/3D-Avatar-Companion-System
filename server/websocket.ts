import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

let io: Server | null = null;

// Track active sessions: socketId -> { avatarId, sessionId, isSpeaking }
const activeSessions = new Map<string, {
  avatarId: number;
  sessionId: number;
  isSpeaking: boolean;
  abortController?: AbortController;
}>();

export function initWebSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    path: "/api/ws",
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Join avatar chat room
    socket.on("join_chat", (data: { avatarId: number; sessionId: number }) => {
      const room = `chat_${data.avatarId}_${data.sessionId}`;
      socket.join(room);
      activeSessions.set(socket.id, {
        avatarId: data.avatarId,
        sessionId: data.sessionId,
        isSpeaking: false,
      });
      socket.emit("joined", { room, status: "connected" });
      console.log(`[WebSocket] ${socket.id} joined room ${room}`);
    });

    // Handle interrupt signal
    socket.on("interrupt", () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        session.isSpeaking = false;
        // Abort any ongoing LLM/TTS processing
        if (session.abortController) {
          session.abortController.abort();
          session.abortController = undefined;
        }
        const room = `chat_${session.avatarId}_${session.sessionId}`;
        io?.to(room).emit("interrupted", {
          timestamp: Date.now(),
          message: "对话已被打断",
        });
        console.log(`[WebSocket] Chat interrupted in room ${room}`);
      }
    });

    // Handle typing indicator
    socket.on("typing", (data: { isTyping: boolean }) => {
      const session = activeSessions.get(socket.id);
      if (session) {
        const room = `chat_${session.avatarId}_${session.sessionId}`;
        socket.to(room).emit("user_typing", { isTyping: data.isTyping });
      }
    });

    // Handle voice stream start
    socket.on("voice_start", () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        // If avatar is speaking, interrupt
        if (session.isSpeaking) {
          session.isSpeaking = false;
          if (session.abortController) {
            session.abortController.abort();
            session.abortController = undefined;
          }
          const room = `chat_${session.avatarId}_${session.sessionId}`;
          io?.to(room).emit("interrupted", {
            timestamp: Date.now(),
            message: "语音输入打断",
          });
        }
      }
    });

    // Cleanup on disconnect
    socket.on("disconnect", () => {
      activeSessions.delete(socket.id);
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

// Emit avatar speaking state to a specific room
export function emitAvatarSpeaking(avatarId: number, sessionId: number, data: {
  isSpeaking: boolean;
  emotion?: { emotion: string; intensity: number };
  visemeData?: any;
  animationState?: string;
  content?: string;
}) {
  if (!io) return;
  const room = `chat_${avatarId}_${sessionId}`;
  io.to(room).emit("avatar_speaking", data);
}

// Emit emotion update
export function emitEmotionUpdate(avatarId: number, sessionId: number, emotion: {
  emotion: string;
  intensity: number;
  description: string;
}) {
  if (!io) return;
  const room = `chat_${avatarId}_${sessionId}`;
  io.to(room).emit("emotion_update", emotion);
}

// Emit TTS audio chunk for lip sync
export function emitTTSChunk(avatarId: number, sessionId: number, data: {
  audioChunk?: ArrayBuffer;
  visemeTimestamps?: Array<{ time: number; viseme: string }>;
  text: string;
  isFinal: boolean;
}) {
  if (!io) return;
  const room = `chat_${avatarId}_${sessionId}`;
  io.to(room).emit("tts_chunk", data);
}

// Emit animation command
export function emitAnimationCommand(avatarId: number, sessionId: number, command: {
  type: "gesture" | "expression" | "pose" | "idle";
  name: string;
  intensity: number;
  duration?: number;
}) {
  if (!io) return;
  const room = `chat_${avatarId}_${sessionId}`;
  io.to(room).emit("animation_command", command);
}

// Set abort controller for a socket session
export function setSessionAbortController(socketId: string, controller: AbortController) {
  const session = activeSessions.get(socketId);
  if (session) {
    session.abortController = controller;
  }
}

// Check if a session is still active (not interrupted)
export function isSessionActive(socketId: string): boolean {
  const session = activeSessions.get(socketId);
  return session ? !session.abortController?.signal.aborted : false;
}

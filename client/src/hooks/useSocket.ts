import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

type EmotionData = {
  emotion: string;
  intensity: number;
  description?: string;
};

type AvatarSpeakingData = {
  isSpeaking: boolean;
  emotion?: EmotionData;
  visemeData?: any;
  animationState?: string;
  content?: string;
};

type TTSChunkData = {
  audioChunk?: ArrayBuffer;
  visemeTimestamps?: Array<{ time: number; viseme: string }>;
  text: string;
  isFinal: boolean;
};

type AnimationCommand = {
  type: "gesture" | "expression" | "pose" | "idle";
  name: string;
  intensity: number;
  duration?: number;
};

export function useSocket(avatarId: number | null, sessionId: number | null) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionData>({ emotion: "neutral", intensity: 0.5 });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [animationCommand, setAnimationCommand] = useState<AnimationCommand | null>(null);

  useEffect(() => {
    if (!avatarId || !sessionId) return;

    const socket = io(window.location.origin, {
      path: "/api/ws",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("join_chat", { avatarId, sessionId });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("joined", (data) => {
      console.log("[Socket] Joined room:", data.room);
    });

    socket.on("avatar_speaking", (data: AvatarSpeakingData) => {
      setIsSpeaking(data.isSpeaking);
      if (data.emotion) setCurrentEmotion(data.emotion);
    });

    socket.on("emotion_update", (data: EmotionData) => {
      setCurrentEmotion(data);
    });

    socket.on("tts_chunk", (_data: TTSChunkData) => {
      // Handle TTS audio chunks for lip sync
      // In production, this would feed into Wav2Lip or Babylon.js morph targets
    });

    socket.on("animation_command", (command: AnimationCommand) => {
      setAnimationCommand(command);
    });

    socket.on("interrupted", (data) => {
      setIsSpeaking(false);
      setCurrentEmotion({ emotion: "neutral", intensity: 0.5 });
      console.log("[Socket] Interrupted:", data.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [avatarId, sessionId]);

  const sendInterrupt = useCallback(() => {
    socketRef.current?.emit("interrupt");
  }, []);

  const sendTyping = useCallback((isTyping: boolean) => {
    socketRef.current?.emit("typing", { isTyping });
  }, []);

  const sendVoiceStart = useCallback(() => {
    socketRef.current?.emit("voice_start");
  }, []);

  return {
    isConnected,
    currentEmotion,
    isSpeaking,
    animationCommand,
    sendInterrupt,
    sendTyping,
    sendVoiceStart,
  };
}

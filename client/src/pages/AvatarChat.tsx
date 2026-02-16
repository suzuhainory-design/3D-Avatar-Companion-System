import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AvatarPreview3D, type AvatarPreview3DHandle } from "@/components/AvatarPreview3D";
import { TTSControls } from "@/components/TTSControls";
import { useLipSync, type VisemeTimestamp } from "@/hooks/useLipSync";
import { useLocation, useParams } from "wouter";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ArrowLeft, Send, Mic, MicOff, Paperclip, Loader2, StopCircle,
  Volume2, VolumeX, Settings, MessageSquare, X, FileText, Image as ImageIcon,
  Music, Video, File as FileIcon, Radio,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  emotionAnalysis?: { emotion: string; intensity: number; description: string };
  attachments?: { url: string; name: string; mimeType: string }[];
  audioUrl?: string | null;
  visemeTimeline?: VisemeTimestamp[];
  wasInterrupted?: boolean;
  createdAt: string;
};

const EMOTION_ICONS: Record<string, string> = {
  happy: "😊", sad: "😢", surprised: "😮", angry: "😠",
  neutral: "😐", thinking: "🤔", excited: "🎉",
};

const EMOTION_COLORS: Record<string, string> = {
  happy: "text-yellow-400", sad: "text-blue-400", surprised: "text-purple-400",
  angry: "text-red-400", neutral: "text-gray-400", thinking: "text-cyan-400",
  excited: "text-pink-400",
};

const ACCEPTED_FILE_TYPES = [
  ".txt", ".md", ".json", ".csv", ".xml", ".html",
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xlsx", ".xls",
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".mp3", ".wav", ".m4a", ".aac", ".flac",
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".wmv",
].join(",");

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
  if (mimeType.startsWith("audio/")) return <Music className="w-4 h-4" />;
  if (mimeType.startsWith("video/")) return <Video className="w-4 h-4" />;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text"))
    return <FileText className="w-4 h-4" />;
  return <FileIcon className="w-4 h-4" />;
}

export default function AvatarChat() {
  useAuth({ redirectOnUnauthenticated: true });
  const [, navigate] = useLocation();
  const params = useParams<{ id: string; sessionId?: string }>();
  const avatarId = parseInt(params.id);

  const avatarQuery = trpc.avatar.get.useQuery({ id: avatarId });
  const sessionsQuery = trpc.chat.listSessions.useQuery();
  const createSessionMutation = trpc.chat.createSession.useMutation();
  const chatWithVoiceMutation = trpc.tts.chatWithVoice.useMutation();
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();
  const uploadMutation = trpc.file.upload.useMutation();
  const voiceTranscribeMutation = trpc.voice.transcribe.useMutation();

  const [sessionId, setSessionId] = useState<number | null>(params.sessionId ? parseInt(params.sessionId) : null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<{ emotion: string; intensity: number }>({ emotion: "neutral", intensity: 0.5 });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [ttsEnabled, setTtsEnabled] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const avatarPreviewRef = useRef<AvatarPreview3DHandle>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentSpeakingMsgRef = useRef<number | null>(null);

  // ─── Lip Sync Hook ────────────────────────────────────────────────

  const lipSync = useLipSync({
    avatarRef: avatarPreviewRef,
    onComplete: () => {
      setIsSpeaking(false);
      currentSpeakingMsgRef.current = null;
    },
    onInterrupt: () => {
      setIsSpeaking(false);
      currentSpeakingMsgRef.current = null;
    },
    onVisemeChange: (_visemeIndex, _phoneme) => {
      // Could log or visualize viseme changes
    },
    enableEmotionExpression: true,
  });

  // ─── Data Queries ─────────────────────────────────────────────────

  const messagesQuery = trpc.chat.getMessages.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId, refetchOnWindowFocus: false }
  );

  useEffect(() => {
    if (messagesQuery.data) {
      setMessages(messagesQuery.data.map(m => ({
        ...m,
        wasInterrupted: m.wasInterrupted === 1 ? true : m.wasInterrupted === 0 ? false : undefined,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
      })) as ChatMessage[]);
    }
  }, [messagesQuery.data]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-create session if none exists
  useEffect(() => {
    if (!sessionId && avatarQuery.data) {
      createSessionMutation.mutateAsync({
        avatarId,
        title: `与 ${avatarQuery.data.name} 的对话`,
      }).then((result) => {
        setSessionId(result.id);
      });
    }
  }, [avatarId, avatarQuery.data, sessionId]);

  // ─── Send Message with TTS ────────────────────────────────────────

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() && pendingFiles.length === 0) return;
    if (!sessionId) return;

    const content = inputText.trim();
    setInputText("");

    // If avatar is speaking, this is an interrupt
    if (isSpeaking) {
      lipSync.stop();
      setIsSpeaking(false);
      setCurrentEmotion({ emotion: "neutral", intensity: 0.5 });
      toast.info("已打断数字人发言");

      // Mark the current speaking message as interrupted
      if (currentSpeakingMsgRef.current) {
        // Fire and forget - mark as interrupted in DB
        trpc.useUtils().client.chat.interruptMessage.mutate({
          messageId: currentSpeakingMsgRef.current,
          interruptedAtContent: content,
        }).catch(() => {});
      }
    }

    // Upload pending files
    let attachments: { url: string; name: string; mimeType: string }[] = [];
    if (pendingFiles.length > 0) {
      try {
        for (const file of pendingFiles) {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onload = (e) => resolve((e.target?.result as string).split(",")[1]);
            reader.readAsDataURL(file);
          });
          const result = await uploadMutation.mutateAsync({
            fileName: file.name,
            mimeType: file.type,
            base64Data: base64,
            purpose: "chat_attachment",
          });
          attachments.push({ url: result.url, name: file.name, mimeType: file.type });
        }
      } catch {
        toast.error("文件上传失败");
      }
      setPendingFiles([]);
    }

    // Add user message optimistically
    const userMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: content || "(文件)",
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // Use chatWithVoice if TTS is enabled, otherwise use regular sendMessage
      if (ttsEnabled) {
        const result = await chatWithVoiceMutation.mutateAsync({
          sessionId,
          content: content || "请查看我发送的文件",
          voiceId: selectedVoiceId || undefined,
          language: "zh",
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        // Add assistant message with audio data
        const assistantMsg: ChatMessage = {
          id: result.id,
          role: "assistant",
          content: result.content,
          emotionAnalysis: result.emotionAnalysis,
          audioUrl: result.audioUrl,
          visemeTimeline: result.visemeTimeline,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Update emotion state
        if (result.emotionAnalysis) {
          setCurrentEmotion({
            emotion: result.emotionAnalysis.emotion,
            intensity: result.emotionAnalysis.intensity,
          });
        }

        // Play audio with lip sync
        if (result.audioUrl && result.visemeTimeline && result.visemeTimeline.length > 0) {
          setIsSpeaking(true);
          currentSpeakingMsgRef.current = result.id;
          try {
            await lipSync.play(
              result.audioUrl,
              result.visemeTimeline,
              {
                emotion: result.emotionAnalysis,
                duration: result.audioDuration,
              }
            );
          } catch (err) {
            console.error("[Chat] Lip sync playback failed:", err);
            setIsSpeaking(false);
          }
        } else if (result.audioUrl) {
          // Audio exists but no viseme timeline - use estimated visemes
          setIsSpeaking(true);
          currentSpeakingMsgRef.current = result.id;
          try {
            await lipSync.playWithEstimatedVisemes(
              result.audioUrl,
              result.content,
              { emotion: result.emotionAnalysis }
            );
          } catch (err) {
            console.error("[Chat] Estimated lip sync failed:", err);
            setIsSpeaking(false);
          }
        } else {
          // No audio - simulate speaking with timer
          setIsSpeaking(true);
          const speakDuration = Math.max(2000, result.content.length * 80);
          setTimeout(() => setIsSpeaking(false), speakDuration);
        }
      } else {
        // Text-only mode (no TTS)
        const result = await sendMessageMutation.mutateAsync({
          sessionId,
          content: content || "请查看我发送的文件",
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        const assistantMsg: ChatMessage = {
          id: result.id,
          role: "assistant",
          content: result.content,
          emotionAnalysis: result.emotionAnalysis,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        if (result.emotionAnalysis) {
          setCurrentEmotion({
            emotion: result.emotionAnalysis.emotion,
            intensity: result.emotionAnalysis.intensity,
          });
        }

        // Simulate speaking animation without audio
        setIsSpeaking(true);
        const speakDuration = Math.max(2000, result.content.length * 80);
        setTimeout(() => setIsSpeaking(false), speakDuration);
      }
    } catch {
      toast.error("发送失败，请重试");
    }
  }, [inputText, sessionId, pendingFiles, isSpeaking, ttsEnabled, selectedVoiceId, lipSync, chatWithVoiceMutation, sendMessageMutation, uploadMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ─── Voice Recording ──────────────────────────────────────────────

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          stream.getTracks().forEach((t) => t.stop());

          try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve) => {
              reader.onload = (e) => resolve((e.target?.result as string).split(",")[1]);
              reader.readAsDataURL(audioBlob);
            });
            const uploadResult = await uploadMutation.mutateAsync({
              fileName: "voice-recording.webm",
              mimeType: "audio/webm",
              base64Data: base64,
              purpose: "chat_attachment",
            });
            const transcription = await voiceTranscribeMutation.mutateAsync({
              audioUrl: uploadResult.url,
              language: "zh",
            });
            if (transcription.text) {
              setInputText(transcription.text);
              toast.success("语音已转录");
            }
          } catch {
            toast.error("语音转录失败");
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
        toast.info("正在录音...");
      } catch {
        toast.error("无法访问麦克风");
      }
    }
  };

  // ─── Interrupt ────────────────────────────────────────────────────

  const handleInterrupt = useCallback(() => {
    if (isSpeaking) {
      lipSync.stop();
      setIsSpeaking(false);
      setCurrentEmotion({ emotion: "neutral", intensity: 0.5 });
      toast.info("已打断数字人");
    }
  }, [isSpeaking, lipSync]);

  // ─── Replay Message Audio ─────────────────────────────────────────

  const handleReplayAudio = useCallback(async (msg: ChatMessage) => {
    if (!msg.audioUrl) return;

    // Stop current playback if any
    if (isSpeaking) {
      lipSync.stop();
    }

    setIsSpeaking(true);
    currentSpeakingMsgRef.current = msg.id;

    if (msg.emotionAnalysis) {
      setCurrentEmotion({
        emotion: msg.emotionAnalysis.emotion,
        intensity: msg.emotionAnalysis.intensity,
      });
    }

    try {
      if (msg.visemeTimeline && msg.visemeTimeline.length > 0) {
        await lipSync.play(msg.audioUrl, msg.visemeTimeline, {
          emotion: msg.emotionAnalysis,
        });
      } else {
        await lipSync.playWithEstimatedVisemes(msg.audioUrl, msg.content, {
          emotion: msg.emotionAnalysis,
        });
      }
    } catch {
      setIsSpeaking(false);
    }
  }, [isSpeaking, lipSync]);

  const avatar = avatarQuery.data;
  const isLoading = chatWithVoiceMutation.isPending || sendMessageMutation.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50 shrink-0">
        <div className="container flex items-center h-14 gap-4">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-sm">{EMOTION_ICONS[currentEmotion.emotion] || "😐"}</span>
            </div>
            <div>
              <h1 className="font-bold text-sm">{avatar?.name || "数字人"}</h1>
              <p className="text-xs text-muted-foreground">
                {isSpeaking ? (
                  <span className="flex items-center gap-1">
                    <Radio className="w-3 h-3 text-primary animate-pulse" />
                    正在说话...
                  </span>
                ) : currentEmotion.emotion !== "neutral" ? (
                  `${EMOTION_ICONS[currentEmotion.emotion]} 感到${currentEmotion.emotion}`
                ) : "在线"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* TTS Toggle */}
            <Button
              variant="outline"
              size="icon"
              className={`w-8 h-8 ${ttsEnabled ? "text-primary border-primary/50" : "text-muted-foreground"}`}
              onClick={() => setTtsEnabled(!ttsEnabled)}
              title={ttsEnabled ? "关闭语音" : "开启语音"}
            >
              {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>

            {/* Lip Sync Controls (compact) */}
            {isSpeaking && (
              <TTSControls
                isPlaying={lipSync.state.isPlaying}
                isPaused={lipSync.state.isPaused}
                progress={lipSync.state.progress}
                currentViseme={lipSync.state.currentViseme}
                onPause={lipSync.pause}
                onResume={lipSync.resume}
                onStop={handleInterrupt}
                onVolumeChange={lipSync.setVolume}
                compact={true}
              />
            )}

            {isSpeaking && !lipSync.state.isPlaying && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={handleInterrupt}>
                <StopCircle className="w-3.5 h-3.5" />
                打断
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              className="w-8 h-8"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat area */}
        <div className="flex-1 flex flex-col">
          {/* Avatar 3D preview (compact) */}
          <div className="border-b border-border bg-card/30 p-4">
            <div className="max-w-xs mx-auto">
              <div className="relative">
                <AvatarPreview3D
                  ref={avatarPreviewRef}
                  skeletonParams={avatar?.skeletonParams as any}
                  skinColor={avatar?.skinParams as any}
                  gender={avatar?.gender || "female"}
                  hairParams={avatar?.hairParams as any}
                  animationState={{
                    emotion: currentEmotion.emotion,
                    emotionIntensity: currentEmotion.intensity * 100,
                    isSpeaking,
                  }}
                  showControls={false}
                  compact={true}
                  className="max-h-[250px]"
                />
                {/* Speaking overlay with lip sync info */}
                {isSpeaking && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-primary/30">
                    {lipSync.state.isPlaying ? (
                      <>
                        <Radio className="w-3.5 h-3.5 text-primary animate-pulse" />
                        <span className="text-xs text-primary font-medium">语音播放中</span>
                        {/* Mini progress bar */}
                        <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-100"
                            style={{ width: `${lipSync.state.progress * 100}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 text-primary animate-pulse" />
                        <span className="text-xs text-primary font-medium">说话中</span>
                      </>
                    )}
                    <span className="text-sm">{EMOTION_ICONS[currentEmotion.emotion]}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">开始与你的3D数字人对话吧</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {ttsEnabled ? "语音模式已开启 - 数字人将用语音回复并同步口型" : "支持文字、语音、文件等多种输入方式"}
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-card border border-border rounded-bl-md"
                    }`}
                  >
                    {/* Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.attachments.map((att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${
                              msg.role === "user"
                                ? "bg-primary-foreground/10 text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {getFileIcon(att.mimeType)}
                            <span className="truncate max-w-[120px]">{att.name}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Content */}
                    <div className="text-sm leading-relaxed">
                      {msg.role === "assistant" ? (
                        <Streamdown>{msg.content}</Streamdown>
                      ) : (
                        msg.content
                      )}
                    </div>

                    {/* Emotion badge */}
                    {msg.emotionAnalysis && (
                      <div className={`flex items-center gap-1 mt-2 text-xs ${EMOTION_COLORS[msg.emotionAnalysis.emotion] || "text-muted-foreground"}`}>
                        <span>{EMOTION_ICONS[msg.emotionAnalysis.emotion]}</span>
                        <span>{msg.emotionAnalysis.description}</span>
                        <span className="opacity-60">({Math.round(msg.emotionAnalysis.intensity * 100)}%)</span>
                      </div>
                    )}

                    {/* Audio replay button */}
                    {msg.role === "assistant" && msg.audioUrl && (
                      <button
                        onClick={() => handleReplayAudio(msg)}
                        className="flex items-center gap-1.5 mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
                        disabled={isSpeaking && currentSpeakingMsgRef.current === msg.id}
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>
                          {isSpeaking && currentSpeakingMsgRef.current === msg.id
                            ? "播放中..."
                            : "重播语音"}
                        </span>
                      </button>
                    )}

                    {msg.wasInterrupted && (
                      <div className="text-xs text-destructive mt-1 flex items-center gap-1">
                        <StopCircle className="w-3 h-3" />
                        <span>已被打断</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">
                        {ttsEnabled ? "思考并生成语音中..." : "思考中..."}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Pending files */}
          {pendingFiles.length > 0 && (
            <div className="border-t border-border px-4 py-2 bg-card/50">
              <div className="flex flex-wrap gap-2 max-w-2xl mx-auto">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-muted px-2 py-1 rounded-lg text-xs">
                    {getFileIcon(file.type)}
                    <span className="truncate max-w-[100px]">{file.name}</span>
                    <button
                      onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-border bg-card/50 backdrop-blur-sm p-4 shrink-0">
            <div className="max-w-2xl mx-auto flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setPendingFiles((prev) => [...prev, ...files]);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="icon"
                className="w-9 h-9 shrink-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={`w-9 h-9 shrink-0 ${isRecording ? "bg-destructive text-destructive-foreground border-destructive" : ""}`}
                onClick={toggleRecording}
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isSpeaking ? "输入消息打断数字人..." : ttsEnabled ? "输入消息（语音模式）..." : "输入消息..."}
                className="bg-input flex-1"
                disabled={isLoading}
              />
              <Button
                size="icon"
                className="w-9 h-9 shrink-0"
                onClick={handleSendMessage}
                disabled={isLoading && !isSpeaking}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div className="w-72 border-l border-border bg-card/50 p-4 shrink-0 hidden lg:block overflow-y-auto">
            <h3 className="font-semibold text-sm mb-4">对话列表</h3>
            <div className="space-y-2">
              {sessionsQuery.data?.filter((s) => s.avatarId === avatarId).map((session) => (
                <button
                  key={session.id}
                  className={`w-full text-left p-3 rounded-lg text-sm transition-all ${
                    sessionId === session.id
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-muted/50 hover:bg-muted"
                  }`}
                  onClick={() => {
                    setSessionId(session.id);
                    setMessages([]);
                  }}
                >
                  <p className="font-medium truncate">{session.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(session.updatedAt).toLocaleDateString("zh-CN")}
                  </p>
                </button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={async () => {
                  const result = await createSessionMutation.mutateAsync({
                    avatarId,
                    title: `新对话 ${new Date().toLocaleTimeString("zh-CN")}`,
                  });
                  setSessionId(result.id);
                  setMessages([]);
                  sessionsQuery.refetch();
                }}
              >
                新建对话
              </Button>
            </div>

            {/* TTS Controls (full) */}
            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="font-semibold text-sm mb-3">语音设置</h3>
              <TTSControls
                isPlaying={lipSync.state.isPlaying}
                isPaused={lipSync.state.isPaused}
                progress={lipSync.state.progress}
                currentViseme={lipSync.state.currentViseme}
                onVoiceChange={setSelectedVoiceId}
                onVolumeChange={lipSync.setVolume}
                onPause={lipSync.pause}
                onResume={lipSync.resume}
                onStop={handleInterrupt}
                selectedVoiceId={selectedVoiceId}
              />
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="font-semibold text-sm mb-3">当前情绪</h3>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{EMOTION_ICONS[currentEmotion.emotion]}</span>
                <div>
                  <p className="text-sm font-medium capitalize">{currentEmotion.emotion}</p>
                  <div className="w-24 h-1.5 bg-muted rounded-full mt-1">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${currentEmotion.intensity * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="font-semibold text-sm mb-3">支持的文件类型</h3>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>文本: .txt, .md, .json, .csv, .xml, .html</p>
                <p>文档: .pdf, .doc, .docx, .ppt, .pptx, .xlsx</p>
                <p>图片: .jpg, .png, .webp, .gif</p>
                <p>音频: .mp3, .wav, .m4a, .aac, .flac</p>
                <p>视频: .mp4, .mov, .mkv, .webm, .avi</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

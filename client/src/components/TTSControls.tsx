/**
 * TTSControls - TTS Voice Settings & Playback Controls
 * 
 * Provides UI for:
 * - Voice selection (from ElevenLabs available voices)
 * - Volume control
 * - Playback state indicator
 * - Lip sync visualization
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Volume2, VolumeX, Volume1, Mic, Settings2, Loader2,
  Play, Pause, Square, Radio,
} from "lucide-react";

type TTSControlsProps = {
  isPlaying: boolean;
  isPaused: boolean;
  progress: number;
  currentViseme: number;
  onVoiceChange?: (voiceId: string) => void;
  onVolumeChange?: (volume: number) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  selectedVoiceId?: string;
  compact?: boolean;
  className?: string;
};

// Viseme mouth shape descriptions for visualization
const VISEME_LABELS: Record<number, string> = {
  0: "—",    // Silence
  1: "B/P/M", // Bilabial
  2: "F/V",   // Labiodental
  3: "TH",    // Dental
  4: "T/D/S", // Alveolar
  5: "SH/CH", // Postalveolar
  6: "K/G",   // Velar
  7: "H",     // Glottal
  8: "R",     // Approximant
  9: "W",     // Rounded
  10: "Y",    // Palatal
  11: "AH",   // Open vowel
  12: "EH",   // Mid vowel
  13: "EE",   // Close front
  14: "OH",   // Close back rounded
  15: "OO",   // Close back
  16: "UH",   // Schwa
  17: "OW",   // Diphthong
  18: "OY",   // Diphthong
};

// Mouth openness for visualization (0-1)
const VISEME_OPENNESS: Record<number, number> = {
  0: 0, 1: 0.3, 2: 0.2, 3: 0.3, 4: 0.2, 5: 0.3,
  6: 0.4, 7: 0.5, 8: 0.3, 9: 0.4, 10: 0.2,
  11: 1.0, 12: 0.7, 13: 0.3, 14: 0.8, 15: 0.5,
  16: 0.4, 17: 0.9, 18: 0.8,
};

export function TTSControls({
  isPlaying,
  isPaused,
  progress,
  currentViseme,
  onVoiceChange,
  onVolumeChange,
  onPause,
  onResume,
  onStop,
  selectedVoiceId,
  compact = false,
  className = "",
}: TTSControlsProps) {
  const [volume, setVolume] = useState(0.8);
  const [showSettings, setShowSettings] = useState(false);

  const voicesQuery = trpc.tts.listVoices.useQuery(undefined, {
    enabled: showSettings,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    onVolumeChange?.(newVolume);
  };

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const openness = VISEME_OPENNESS[currentViseme] ?? 0;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {/* Playback controls */}
        {isPlaying && (
          <>
            <Button
              variant="outline"
              size="icon"
              className="w-7 h-7"
              onClick={isPaused ? onResume : onPause}
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-7 h-7 text-destructive"
              onClick={onStop}
            >
              <Square className="w-3 h-3" />
            </Button>
          </>
        )}

        {/* Mini progress */}
        {isPlaying && (
          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* Lip sync indicator */}
        {isPlaying && !isPaused && (
          <div className="flex items-center gap-1">
            <Radio className="w-3 h-3 text-primary animate-pulse" />
            <span className="text-[10px] text-muted-foreground font-mono">
              {VISEME_LABELS[currentViseme] || "—"}
            </span>
          </div>
        )}

        {/* Volume */}
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7"
          onClick={() => {
            const newVol = volume === 0 ? 0.8 : 0;
            setVolume(newVol);
            onVolumeChange?.(newVol);
          }}
        >
          <VolumeIcon className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Playback status & controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPlaying ? (
            <>
              <div className="flex items-center gap-1.5">
                {!isPaused && <Radio className="w-3.5 h-3.5 text-primary animate-pulse" />}
                <span className="text-sm font-medium">
                  {isPaused ? "已暂停" : "正在说话"}
                </span>
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">语音就绪</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isPlaying && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="w-8 h-8"
                onClick={isPaused ? onResume : onPause}
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8 h-8 text-destructive hover:text-destructive"
                onClick={onStop}
              >
                <Square className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      {isPlaying && (
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Lip sync visualization */}
      {isPlaying && !isPaused && (
        <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
          {/* Mouth shape indicator */}
          <div className="relative w-10 h-10 flex items-center justify-center">
            <svg viewBox="0 0 40 40" className="w-full h-full">
              {/* Lips outline */}
              <ellipse
                cx="20"
                cy="20"
                rx={8 + openness * 4}
                ry={2 + openness * 8}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-primary"
              />
              {/* Inner mouth */}
              {openness > 0.1 && (
                <ellipse
                  cx="20"
                  cy="20"
                  rx={5 + openness * 3}
                  ry={1 + openness * 5}
                  fill="currentColor"
                  className="text-primary/20"
                />
              )}
            </svg>
          </div>

          <div className="flex-1">
            <div className="text-xs font-mono text-muted-foreground">
              Viseme: {VISEME_LABELS[currentViseme] || "—"} ({currentViseme})
            </div>
            <div className="flex gap-0.5 mt-1">
              {/* Mini viseme bar chart */}
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary/30 rounded-full transition-all duration-75"
                  style={{
                    height: `${4 + (i === currentViseme % 8 ? openness * 12 : Math.random() * openness * 8)}px`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Volume control */}
      <div className="flex items-center gap-3">
        <VolumeIcon className="w-4 h-4 text-muted-foreground shrink-0" />
        <Slider
          value={[volume]}
          onValueChange={handleVolumeChange}
          max={1}
          step={0.05}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground w-8 text-right">
          {Math.round(volume * 100)}%
        </span>
      </div>

      {/* Voice settings panel */}
      {showSettings && (
        <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            语音设置
          </h4>

          {/* Voice selection */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">语音角色</label>
            {voicesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                加载语音列表...
              </div>
            ) : (
              <Select
                value={selectedVoiceId || "default"}
                onValueChange={(value) => onVoiceChange?.(value === "default" ? "" : value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择语音" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认语音 (Rachel)</SelectItem>
                  {voicesQuery.data?.map((voice) => (
                    <SelectItem key={voice.voiceId} value={voice.voiceId}>
                      {voice.name} ({voice.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* API status */}
          <div className="flex items-center gap-2 text-xs">
            <Mic className="w-3 h-3" />
            <span className="text-muted-foreground">ElevenLabs TTS</span>
            <span className="ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              已连接
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

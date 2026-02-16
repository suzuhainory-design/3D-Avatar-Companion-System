import { useRef, useState, useEffect } from "react";
import { RotateCcw, ZoomIn, ZoomOut, Move } from "lucide-react";
import { Button } from "@/components/ui/button";

type AvatarPreview3DProps = {
  /** 骨架参数 */
  skeletonParams?: {
    height?: number;
    shoulderWidth?: number;
    hipWidth?: number;
    armLength?: number;
    legLength?: number;
    torsoLength?: number;
    neckLength?: number;
  };
  /** 肤色 */
  skinColor?: { r: number; g: number; b: number };
  /** 性别 */
  gender?: "male" | "female";
  /** 发型参数 */
  hairParams?: {
    length?: number;
    color?: string;
    style?: string;
  };
  /** 服装颜色 */
  clothingColor?: { r: number; g: number; b: number };
  /** 是否显示控制按钮 */
  showControls?: boolean;
  /** 容器类名 */
  className?: string;
};

export function AvatarPreview3D({
  skeletonParams,
  skinColor = { r: 235, g: 200, b: 178 },
  gender = "female",
  hairParams,
  clothingColor,
  showControls = true,
  className = "",
}: AvatarPreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const height = skeletonParams?.height || 170;
  const shoulderWidth = skeletonParams?.shoulderWidth || 40;
  const hipWidth = skeletonParams?.hipWidth || 35;
  const torsoLength = skeletonParams?.torsoLength || 50;
  const legLength = skeletonParams?.legLength || 80;
  const neckLength = skeletonParams?.neckLength || 10;

  const skinRgb = `rgb(${skinColor.r}, ${skinColor.g}, ${skinColor.b})`;
  const skinDarker = `rgb(${Math.max(0, skinColor.r - 30)}, ${Math.max(0, skinColor.g - 30)}, ${Math.max(0, skinColor.b - 30)})`;
  const clothingRgb = clothingColor
    ? `rgb(${clothingColor.r}, ${clothingColor.g}, ${clothingColor.b})`
    : "rgb(60, 80, 120)";

  const hairColor = hairParams?.color || "#2a1a0a";
  const hairLength = hairParams?.length || 20;

  // Scale factor to fit in viewport
  const scale = (200 / height) * zoom;

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setRotation((prev) => ({
      x: prev.x + dy * 0.5,
      y: prev.y + dx * 0.5,
    }));
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <div className={`relative select-none ${className}`}>
      {/* 3D Viewport */}
      <div
        ref={containerRef}
        className="w-full aspect-[3/4] bg-surface-1 rounded-xl border border-border overflow-hidden relative"
        style={{ perspective: "800px" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Grid floor */}
        <div className="absolute inset-0 bg-grid opacity-20" />

        {/* Avatar figure */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale(${scale / 200})`,
            transformStyle: "preserve-3d",
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        >
          <svg
            viewBox="0 0 200 400"
            className="w-full h-full max-w-[200px]"
            style={{ filter: "drop-shadow(0 0 20px rgba(0,200,255,0.15))" }}
          >
            {/* Hair */}
            <ellipse
              cx="100"
              cy={60 - hairLength * 0.1}
              rx={28 + hairLength * 0.1}
              ry={25 + hairLength * 0.3}
              fill={hairColor}
              opacity="0.9"
            />

            {/* Head */}
            <ellipse cx="100" cy="65" rx="22" ry="26" fill={skinRgb} />
            {/* Eyes */}
            <ellipse cx="90" cy="60" rx="4" ry="2.5" fill="#1a1a2e" />
            <ellipse cx="110" cy="60" rx="4" ry="2.5" fill="#1a1a2e" />
            <circle cx="91" cy="59.5" r="1" fill="white" />
            <circle cx="111" cy="59.5" r="1" fill="white" />
            {/* Nose */}
            <path d="M98 66 L100 72 L102 66" fill="none" stroke={skinDarker} strokeWidth="1" />
            {/* Mouth */}
            <path d="M93 78 Q100 83 107 78" fill="none" stroke="#c47070" strokeWidth="1.5" />

            {/* Neck */}
            <rect
              x="93"
              y="90"
              width="14"
              height={neckLength * 0.3 + 8}
              rx="4"
              fill={skinRgb}
            />

            {/* Torso / Clothing */}
            <path
              d={`M${100 - shoulderWidth * 0.7} ${100 + neckLength * 0.3}
                  L${100 + shoulderWidth * 0.7} ${100 + neckLength * 0.3}
                  L${100 + hipWidth * 0.6} ${100 + neckLength * 0.3 + torsoLength * 1.2}
                  L${100 - hipWidth * 0.6} ${100 + neckLength * 0.3 + torsoLength * 1.2} Z`}
              fill={clothingRgb}
              stroke={clothingRgb}
              strokeWidth="1"
              rx="5"
            />

            {/* Arms */}
            <line
              x1={100 - shoulderWidth * 0.7}
              y1={105 + neckLength * 0.3}
              x2={100 - shoulderWidth * 0.7 - 15}
              y2={105 + neckLength * 0.3 + legLength * 0.6}
              stroke={skinRgb}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <line
              x1={100 + shoulderWidth * 0.7}
              y1={105 + neckLength * 0.3}
              x2={100 + shoulderWidth * 0.7 + 15}
              y2={105 + neckLength * 0.3 + legLength * 0.6}
              stroke={skinRgb}
              strokeWidth="10"
              strokeLinecap="round"
            />

            {/* Legs */}
            <line
              x1={100 - hipWidth * 0.3}
              y1={100 + neckLength * 0.3 + torsoLength * 1.2}
              x2={100 - hipWidth * 0.3 - 3}
              y2={100 + neckLength * 0.3 + torsoLength * 1.2 + legLength * 1.2}
              stroke="#2a3555"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <line
              x1={100 + hipWidth * 0.3}
              y1={100 + neckLength * 0.3 + torsoLength * 1.2}
              x2={100 + hipWidth * 0.3 + 3}
              y2={100 + neckLength * 0.3 + torsoLength * 1.2 + legLength * 1.2}
              stroke="#2a3555"
              strokeWidth="12"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Height indicator */}
        <div className="absolute bottom-3 left-3 text-xs text-muted-foreground font-mono">
          {height}cm
        </div>
      </div>

      {/* Controls */}
      {showControls && (
        <div className="absolute top-3 right-3 flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8 bg-background/80 backdrop-blur-sm"
            onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8 bg-background/80 backdrop-blur-sm"
            onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8 bg-background/80 backdrop-blur-sm"
            onClick={() => {
              setRotation({ x: 0, y: 0 });
              setZoom(1);
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

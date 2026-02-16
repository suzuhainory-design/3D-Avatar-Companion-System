/**
 * AvatarPreview3D - Babylon.js powered 3D avatar preview component
 * 
 * Replaces the old CSS/SVG simulation with a real 3D rendering engine.
 * Uses the SMPL-X parametric model system for body shape, facial features,
 * hair, clothing, and animation.
 */
import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { RotateCcw, ZoomIn, ZoomOut, Camera, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BabylonScene, type BabylonSceneRef } from "./BabylonScene";
import {
  createSMPLXAvatar,
  createSpeakingAnimation,
  createGestureAnimation,
  type SMPLXAvatarHandle,
  type SMPLXAvatarConfig,
  type SkeletonParams,
  type SkinParams,
  type FacialParams,
  type GenderFeatureParams,
  type HairParams,
  type ClothingParams,
  type AvatarAnimationState,
} from "./SMPLXAvatar";

// Re-export types for convenience
export type {
  SkeletonParams,
  SkinParams,
  FacialParams,
  GenderFeatureParams,
  HairParams,
  ClothingParams,
  AvatarAnimationState,
};

type AvatarPreview3DProps = {
  /** Skeleton parameters */
  skeletonParams?: Partial<SkeletonParams>;
  /** Skin color */
  skinColor?: Partial<SkinParams>;
  /** Gender */
  gender?: "male" | "female";
  /** Facial parameters */
  facialParams?: Partial<FacialParams>;
  /** Gender-specific features */
  genderFeatureParams?: Partial<GenderFeatureParams>;
  /** Hair parameters */
  hairParams?: Partial<HairParams>;
  /** Clothing parameters */
  clothingParams?: Partial<ClothingParams>;
  /** Animation state */
  animationState?: AvatarAnimationState;
  /** Whether to show control buttons */
  showControls?: boolean;
  /** Container class name */
  className?: string;
  /** Compact mode for smaller viewports */
  compact?: boolean;
};

export type AvatarPreview3DHandle = {
  setViseme: (index: number) => void;
  setEmotion: (emotion: string, intensity: number) => void;
  playGesture: (gesture: string) => void;
  resetCamera: () => void;
};

export const AvatarPreview3D = forwardRef<AvatarPreview3DHandle, AvatarPreview3DProps>(
  function AvatarPreview3D(
    {
      skeletonParams,
      skinColor,
      gender = "female",
      facialParams,
      genderFeatureParams,
      hairParams,
      clothingParams,
      animationState,
      showControls = true,
      className = "",
      compact = false,
    },
    ref
  ) {
    const sceneRefHolder = useRef<BabylonSceneRef | null>(null);
    const avatarRef = useRef<SMPLXAvatarHandle | null>(null);
    const [isAnimating, setIsAnimating] = useState(true);

    // Build config from props
    const configRef = useRef<SMPLXAvatarConfig>({});
    configRef.current = {
      skeleton: skeletonParams,
      skin: skinColor,
      gender,
      facial: facialParams,
      genderFeatures: genderFeatureParams,
      hair: hairParams,
      clothing: clothingParams,
      animation: animationState,
    };

    // Expose handle methods
    useImperativeHandle(ref, () => ({
      setViseme: (index: number) => avatarRef.current?.setViseme(index),
      setEmotion: (emotion: string, intensity: number) =>
        avatarRef.current?.setEmotion(emotion, intensity),
      playGesture: (gesture: string) => {
        if (!sceneRefHolder.current || !avatarRef.current?.rootNode) return;
        const gestureAnim = createGestureAnimation(
          sceneRefHolder.current.scene,
          avatarRef.current.rootNode,
          gesture
        );
        gestureAnim.play(false);
        gestureAnim.onAnimationGroupEndObservable.addOnce(() => gestureAnim.dispose());
      },
      resetCamera: () => {
        if (sceneRefHolder.current) {
          const cam = sceneRefHolder.current.camera;
          cam.alpha = Math.PI / 2;
          cam.beta = Math.PI / 2.5;
          cam.radius = 3;
        }
      },
    }));

    // Rebuild avatar when config changes
    useEffect(() => {
      if (!sceneRefHolder.current) return;
      const { scene, shadowGenerator } = sceneRefHolder.current;

      // Dispose old avatar
      if (avatarRef.current) {
        avatarRef.current.dispose();
        avatarRef.current = null;
      }

      // Create new avatar
      const handle = createSMPLXAvatar(scene, configRef.current, shadowGenerator);
      avatarRef.current = handle;

      return () => {
        if (avatarRef.current) {
          avatarRef.current.dispose();
          avatarRef.current = null;
        }
      };
    }, [
      // Stringify params to detect deep changes
      JSON.stringify(skeletonParams),
      JSON.stringify(skinColor),
      gender,
      JSON.stringify(facialParams),
      JSON.stringify(genderFeatureParams),
      JSON.stringify(hairParams),
      JSON.stringify(clothingParams),
    ]);

    // Handle animation state changes
    useEffect(() => {
      if (!avatarRef.current || !animationState) return;

      if (animationState.emotion && animationState.emotionIntensity != null) {
        avatarRef.current.setEmotion(animationState.emotion, animationState.emotionIntensity);
      }
      if (animationState.visemeIndex != null) {
        avatarRef.current.setViseme(animationState.visemeIndex);
      }
    }, [animationState?.emotion, animationState?.emotionIntensity, animationState?.visemeIndex]);

    const handleSceneReady = useCallback((sceneRef: BabylonSceneRef) => {
      sceneRefHolder.current = sceneRef;

      // Create initial avatar
      const handle = createSMPLXAvatar(
        sceneRef.scene,
        configRef.current,
        sceneRef.shadowGenerator
      );
      avatarRef.current = handle;
    }, []);

    const handleResetCamera = useCallback(() => {
      if (sceneRefHolder.current) {
        const cam = sceneRefHolder.current.camera;
        cam.alpha = Math.PI / 2;
        cam.beta = Math.PI / 2.5;
        cam.radius = 3;
      }
    }, []);

    const handleZoomIn = useCallback(() => {
      if (sceneRefHolder.current) {
        const cam = sceneRefHolder.current.camera;
        cam.radius = Math.max(cam.lowerRadiusLimit || 1.5, cam.radius - 0.5);
      }
    }, []);

    const handleZoomOut = useCallback(() => {
      if (sceneRefHolder.current) {
        const cam = sceneRefHolder.current.camera;
        cam.radius = Math.min(cam.upperRadiusLimit || 8, cam.radius + 0.5);
      }
    }, []);

    const height = skeletonParams?.height || 170;

    return (
      <div className={`relative select-none ${className}`}>
        {/* 3D Viewport */}
        <div
          className={`w-full rounded-xl border border-border overflow-hidden relative bg-surface-1 ${
            compact ? "aspect-square" : "aspect-[3/4]"
          }`}
        >
          <BabylonScene
            onSceneReady={handleSceneReady}
            showGrid={true}
            enableGlow={true}
            cameraSettings={{
              alpha: Math.PI / 2,
              beta: Math.PI / 2.5,
              radius: 3,
              target: { x: 0, y: 0.9, z: 0 },
            }}
          />

          {/* Height indicator */}
          <div className="absolute bottom-3 left-3 text-xs text-muted-foreground font-mono bg-background/60 px-2 py-1 rounded-md backdrop-blur-sm">
            {height}cm
          </div>

          {/* 3D Engine badge */}
          <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/50 font-mono">
            Babylon.js • SMPL-X
          </div>
        </div>

        {/* Controls */}
        {showControls && (
          <div className="absolute top-3 right-3 flex flex-col gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="w-8 h-8 bg-background/80 backdrop-blur-sm"
              onClick={handleZoomIn}
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-8 h-8 bg-background/80 backdrop-blur-sm"
              onClick={handleZoomOut}
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-8 h-8 bg-background/80 backdrop-blur-sm"
              onClick={handleResetCamera}
              title="重置视角"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  }
);

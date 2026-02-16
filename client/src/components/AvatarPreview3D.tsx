/**
 * AvatarPreview3D - Babylon.js powered 3D avatar preview component
 * 
 * Supports two modes:
 * 1. GLB Model Mode: Loads a real SMPL-X .glb model file with skeleton, blendshapes, and PBR materials
 * 2. Procedural Mode: Falls back to the parametric procedural avatar when no GLB is available
 */
import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { RotateCcw, ZoomIn, ZoomOut, Download, Loader2, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BabylonScene, type BabylonSceneRef } from "./BabylonScene";
import {
  createSMPLXAvatar,
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
  /** URL to a .glb model file (real SMPL-X model) */
  glbUrl?: string | null;
  /** Skeleton parameters (procedural mode) */
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
  /** Callback when GLB model is loaded */
  onModelLoaded?: (info: { vertexCount: number; hasSkeleton: boolean; hasBlendShapes: boolean }) => void;
  /** Callback when model loading fails */
  onModelError?: (error: string) => void;
};

export type AvatarPreview3DHandle = {
  setViseme: (index: number) => void;
  setEmotion: (emotion: string, intensity: number) => void;
  playGesture: (gesture: string) => void;
  resetCamera: () => void;
  exportGlb: () => Promise<Blob | null>;
  setBlendShapeWeight: (name: string, weight: number) => void;
};

// MPEG-4 Viseme to BlendShape mapping for loaded GLB models
const VISEME_BLENDSHAPE_MAP: Record<number, string[]> = {
  0: [],                          // silence
  1: ["viseme_PP", "jawOpen"],    // p, b, m
  2: ["viseme_FF"],               // f, v
  3: ["viseme_TH"],               // th, dh
  4: ["viseme_DD", "jawOpen"],    // t, d
  5: ["viseme_kk"],               // k, g
  6: ["viseme_CH"],               // tS, dZ, S
  7: ["viseme_SS"],               // s, z
  8: ["viseme_nn"],               // n, l
  9: ["viseme_RR"],               // r
  10: ["viseme_aa", "jawOpen"],   // A:
  11: ["viseme_E"],               // e
  12: ["viseme_I"],               // i
  13: ["viseme_O"],               // o
  14: ["viseme_U"],               // u
};

// Emotion to BlendShape mapping
const EMOTION_BLENDSHAPE_MAP: Record<string, Record<string, number>> = {
  happy: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.4, cheekSquintRight: 0.4 },
  sad: { mouthFrownLeft: 0.7, mouthFrownRight: 0.7, browInnerUp: 0.5 },
  angry: { browDownLeft: 0.8, browDownRight: 0.8, jawForward: 0.3, mouthShrugLower: 0.4 },
  surprised: { browInnerUp: 0.9, eyeWideLeft: 0.7, eyeWideRight: 0.7, jawOpen: 0.5 },
  fearful: { browInnerUp: 0.7, eyeWideLeft: 0.6, eyeWideRight: 0.6, mouthOpen: 0.3 },
  disgusted: { noseSneerLeft: 0.7, noseSneerRight: 0.7, mouthShrugUpper: 0.4 },
  neutral: {},
};

export const AvatarPreview3D = forwardRef<AvatarPreview3DHandle, AvatarPreview3DProps>(
  function AvatarPreview3D(
    {
      glbUrl,
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
      onModelLoaded,
      onModelError,
    },
    ref
  ) {
    const sceneRefHolder = useRef<BabylonSceneRef | null>(null);
    const avatarRef = useRef<SMPLXAvatarHandle | null>(null);
    const glbMeshesRef = useRef<any[]>([]);
    const glbSkeletonRef = useRef<any>(null);
    const glbMorphTargetsRef = useRef<Map<string, { mesh: any; index: number }>>(new Map());
    const [isLoading, setIsLoading] = useState(false);
    const [modelMode, setModelMode] = useState<"glb" | "procedural">("procedural");
    const [loadError, setLoadError] = useState<string | null>(null);

    // Build config from props for procedural mode
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

    // GLB BlendShape weight setter
    const setGlbBlendShapeWeight = useCallback((name: string, weight: number) => {
      const entry = glbMorphTargetsRef.current.get(name);
      if (entry) {
        const morphManager = entry.mesh.morphTargetManager;
        if (morphManager) {
          const target = morphManager.getTarget(entry.index);
          if (target) {
            target.influence = Math.max(0, Math.min(1, weight));
          }
        }
      }
    }, []);

    // Reset all BlendShapes to 0
    const resetAllBlendShapes = useCallback(() => {
      glbMorphTargetsRef.current.forEach((entry) => {
        const morphManager = entry.mesh.morphTargetManager;
        if (morphManager) {
          const target = morphManager.getTarget(entry.index);
          if (target) target.influence = 0;
        }
      });
    }, []);

    // Set viseme on GLB model
    const setGlbViseme = useCallback((index: number) => {
      // Reset mouth-related blendshapes first
      const mouthShapes = ["jawOpen", "mouthOpen", "mouthClose"];
      for (const [, shapes] of Object.entries(VISEME_BLENDSHAPE_MAP)) {
        shapes.forEach(s => {
          const entry = glbMorphTargetsRef.current.get(s);
          if (entry) {
            const morphManager = entry.mesh.morphTargetManager;
            if (morphManager) {
              const target = morphManager.getTarget(entry.index);
              if (target) target.influence = 0;
            }
          }
        });
      }
      mouthShapes.forEach(s => {
        const entry = glbMorphTargetsRef.current.get(s);
        if (entry) {
          const morphManager = entry.mesh.morphTargetManager;
          if (morphManager) {
            const target = morphManager.getTarget(entry.index);
            if (target) target.influence = 0;
          }
        }
      });

      // Apply new viseme
      const shapes = VISEME_BLENDSHAPE_MAP[index] || [];
      shapes.forEach(shapeName => {
        setGlbBlendShapeWeight(shapeName, 0.7);
      });
    }, [setGlbBlendShapeWeight]);

    // Set emotion on GLB model
    const setGlbEmotion = useCallback((emotion: string, intensity: number) => {
      // Reset emotion blendshapes
      Object.values(EMOTION_BLENDSHAPE_MAP).forEach(shapes => {
        Object.keys(shapes).forEach(name => {
          const entry = glbMorphTargetsRef.current.get(name);
          if (entry) {
            const morphManager = entry.mesh.morphTargetManager;
            if (morphManager) {
              const target = morphManager.getTarget(entry.index);
              if (target) target.influence = 0;
            }
          }
        });
      });

      // Apply new emotion
      const shapes = EMOTION_BLENDSHAPE_MAP[emotion] || {};
      Object.entries(shapes).forEach(([name, baseWeight]) => {
        setGlbBlendShapeWeight(name, baseWeight * intensity);
      });
    }, [setGlbBlendShapeWeight]);

    // Expose handle methods
    useImperativeHandle(ref, () => ({
      setViseme: (index: number) => {
        if (modelMode === "glb") {
          setGlbViseme(index);
        } else {
          avatarRef.current?.setViseme(index);
        }
      },
      setEmotion: (emotion: string, intensity: number) => {
        if (modelMode === "glb") {
          setGlbEmotion(emotion, intensity);
        } else {
          avatarRef.current?.setEmotion(emotion, intensity);
        }
      },
      playGesture: (gesture: string) => {
        if (modelMode === "glb") {
          // For GLB models, play skeleton animation if available
          if (glbSkeletonRef.current && sceneRefHolder.current) {
            const scene = sceneRefHolder.current.scene;
            const animGroups = scene.animationGroups;
            const targetAnim = animGroups.find(g => g.name.toLowerCase().includes(gesture.toLowerCase()));
            if (targetAnim) {
              targetAnim.play(false);
            }
          }
        } else if (sceneRefHolder.current && avatarRef.current?.rootNode) {
          const gestureAnim = createGestureAnimation(
            sceneRefHolder.current.scene,
            avatarRef.current.rootNode,
            gesture
          );
          gestureAnim.play(false);
          gestureAnim.onAnimationGroupEndObservable.addOnce(() => gestureAnim.dispose());
        }
      },
      resetCamera: () => {
        if (sceneRefHolder.current) {
          const cam = sceneRefHolder.current.camera;
          cam.alpha = Math.PI / 2;
          cam.beta = Math.PI / 2.5;
          cam.radius = 3;
        }
      },
      exportGlb: async () => {
        if (!sceneRefHolder.current) return null;
        try {
          const { GLTF2Export } = await import("@babylonjs/serializers/glTF");
          const result = await GLTF2Export.GLBAsync(sceneRefHolder.current.scene, "avatar");
          const files = result.glTFFiles;
          const glbFile = files["avatar.glb"];
          if (glbFile instanceof Blob) return glbFile;
          return null;
        } catch {
          return null;
        }
      },
      setBlendShapeWeight: (name: string, weight: number) => {
        if (modelMode === "glb") {
          setGlbBlendShapeWeight(name, weight);
        }
      },
    }));

    // Load GLB model
    useEffect(() => {
      if (!glbUrl || !sceneRefHolder.current) return;

      const scene = sceneRefHolder.current.scene;
      const shadowGen = sceneRefHolder.current.shadowGenerator;

      setIsLoading(true);
      setLoadError(null);

      // Dynamically import SceneLoader
      import("@babylonjs/loaders/glTF").then(({ GLTFFileLoader }) => {
        import("@babylonjs/core/Loading/sceneLoader").then(({ SceneLoader }) => {
          // Dispose old GLB meshes
          glbMeshesRef.current.forEach(m => m.dispose());
          glbMeshesRef.current = [];
          glbMorphTargetsRef.current.clear();

          // Dispose procedural avatar if switching to GLB
          if (avatarRef.current) {
            avatarRef.current.dispose();
            avatarRef.current = null;
          }

          SceneLoader.ImportMesh(
            "",
            "",
            glbUrl,
            scene,
            (meshes, _particleSystems, skeletons, animationGroups) => {
              setIsLoading(false);
              setModelMode("glb");

              glbMeshesRef.current = meshes;
              if (skeletons.length > 0) {
                glbSkeletonRef.current = skeletons[0];
              }

              let totalVertices = 0;
              let hasBlendShapes = false;

              // Process loaded meshes
              meshes.forEach(mesh => {
                // Add to shadow generator
                if (shadowGen && mesh.getTotalVertices() > 0) {
                  shadowGen.addShadowCaster(mesh);
                }

                totalVertices += mesh.getTotalVertices();

                // Catalog morph targets (BlendShapes)
                const morphManager = mesh.morphTargetManager;
                if (morphManager) {
                  hasBlendShapes = true;
                  for (let i = 0; i < morphManager.numTargets; i++) {
                    const target = morphManager.getTarget(i);
                    if (target.name) {
                      glbMorphTargetsRef.current.set(target.name, { mesh, index: i });
                    }
                  }
                }
              });

              // Play idle animation if available
              const idleAnim = animationGroups.find(g =>
                g.name.toLowerCase().includes("idle") || g.name.toLowerCase().includes("breathing")
              );
              if (idleAnim) {
                idleAnim.play(true);
              }

              onModelLoaded?.({
                vertexCount: totalVertices,
                hasSkeleton: skeletons.length > 0,
                hasBlendShapes,
              });
            },
            undefined,
            (_scene, message) => {
              setIsLoading(false);
              setLoadError(message || "模型加载失败");
              setModelMode("procedural");
              onModelError?.(message || "模型加载失败");

              // Fall back to procedural avatar
              if (sceneRefHolder.current) {
                const handle = createSMPLXAvatar(
                  sceneRefHolder.current.scene,
                  configRef.current,
                  sceneRefHolder.current.shadowGenerator
                );
                avatarRef.current = handle;
              }
            }
          );
        });
      });
    }, [glbUrl]);

    // Procedural mode: rebuild avatar when config changes (only when no GLB)
    useEffect(() => {
      if (modelMode === "glb" || !sceneRefHolder.current) return;

      const { scene, shadowGenerator } = sceneRefHolder.current;

      // Dispose old avatar
      if (avatarRef.current) {
        avatarRef.current.dispose();
        avatarRef.current = null;
      }

      // Create new procedural avatar
      const handle = createSMPLXAvatar(scene, configRef.current, shadowGenerator);
      avatarRef.current = handle;

      return () => {
        // modelMode is captured in closure; safe to dispose procedural avatar
        if (avatarRef.current) {
          avatarRef.current.dispose();
          avatarRef.current = null;
        }
      };
    }, [
      modelMode,
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
      if (!animationState) return;

      if (animationState.emotion && animationState.emotionIntensity != null) {
        if (modelMode === "glb") {
          setGlbEmotion(animationState.emotion, animationState.emotionIntensity);
        } else {
          avatarRef.current?.setEmotion(animationState.emotion, animationState.emotionIntensity);
        }
      }
      if (animationState.visemeIndex != null) {
        if (modelMode === "glb") {
          setGlbViseme(animationState.visemeIndex);
        } else {
          avatarRef.current?.setViseme(animationState.visemeIndex);
        }
      }
    }, [modelMode, animationState?.emotion, animationState?.emotionIntensity, animationState?.visemeIndex, setGlbEmotion, setGlbViseme]);

    const handleSceneReady = useCallback((sceneRef: BabylonSceneRef) => {
      sceneRefHolder.current = sceneRef;

      // If we have a GLB URL, it will be loaded by the glbUrl effect
      // Otherwise, create procedural avatar
      if (!glbUrl) {
        const handle = createSMPLXAvatar(
          sceneRef.scene,
          configRef.current,
          sceneRef.shadowGenerator
        );
        avatarRef.current = handle;
      }
    }, [glbUrl]);

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

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">加载 SMPL-X 模型中...</span>
              </div>
            </div>
          )}

          {/* Error overlay */}
          {loadError && (
            <div className="absolute top-3 left-3 right-3 z-10">
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs text-destructive">
                模型加载失败: {loadError}（已切换到预览模式）
              </div>
            </div>
          )}

          {/* Model mode indicator */}
          <div className="absolute top-3 left-3 z-10">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono backdrop-blur-sm ${
              modelMode === "glb"
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
            }`}>
              <Box className="w-3 h-3" />
              {modelMode === "glb" ? "SMPL-X 真实模型" : "参数化预览"}
            </div>
          </div>

          {/* Height indicator */}
          <div className="absolute bottom-3 left-3 text-xs text-muted-foreground font-mono bg-background/60 px-2 py-1 rounded-md backdrop-blur-sm">
            {height}cm
          </div>

          {/* Engine badge */}
          <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/50 font-mono">
            Babylon.js • {modelMode === "glb" ? "GLB" : "SMPL-X"}
          </div>
        </div>

        {/* Controls */}
        {showControls && (
          <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
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

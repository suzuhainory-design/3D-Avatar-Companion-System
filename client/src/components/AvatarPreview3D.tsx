/**
 * AvatarPreview3D - Babylon.js powered 3D avatar preview component
 * 
 * Supports two modes:
 * 1. GLB Model Mode: Loads a real SMPL-X .glb model file with skeleton, blendshapes, and PBR materials
 * 2. Procedural Mode: Falls back to the parametric procedural avatar when no GLB is available
 * 
 * Features:
 * - Real-time skin color modification on GLB models
 * - Procedural hair overlay on GLB models
 * - Skeleton visualization toggle
 * - Loading progress bar
 * - Optimized camera framing
 */
import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { RotateCcw, ZoomIn, ZoomOut, Loader2, Box, Bone as BoneIcon } from "lucide-react";
import {
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";
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
import { createProceduralHair, type ProceduralHairHandle, type HairConfig } from "./ProceduralHair";

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
  0: [],
  1: ["viseme_PP", "jawOpen"],
  2: ["viseme_FF"],
  3: ["viseme_TH"],
  4: ["viseme_DD", "jawOpen"],
  5: ["viseme_kk"],
  6: ["viseme_CH"],
  7: ["viseme_SS"],
  8: ["viseme_nn"],
  9: ["viseme_RR"],
  10: ["viseme_aa", "jawOpen"],
  11: ["viseme_E"],
  12: ["viseme_I"],
  13: ["viseme_O"],
  14: ["viseme_U"],
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
    const hairHandleRef = useRef<ProceduralHairHandle | null>(null);
    const skeletonVisualsRef = useRef<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadProgress, setLoadProgress] = useState(0);
    const [modelMode, setModelMode] = useState<"glb" | "procedural">("procedural");
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showSkeleton, setShowSkeleton] = useState(false);

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

    // ── GLB BlendShape helpers ──
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

    const setGlbViseme = useCallback((index: number) => {
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
      const shapes = VISEME_BLENDSHAPE_MAP[index] || [];
      shapes.forEach(shapeName => {
        setGlbBlendShapeWeight(shapeName, 0.7);
      });
    }, [setGlbBlendShapeWeight]);

    const setGlbEmotion = useCallback((emotion: string, intensity: number) => {
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
      const shapes = EMOTION_BLENDSHAPE_MAP[emotion] || {};
      Object.entries(shapes).forEach(([name, baseWeight]) => {
        setGlbBlendShapeWeight(name, baseWeight * intensity);
      });
    }, [setGlbBlendShapeWeight]);

    // ── Apply skin color to GLB model materials ──
    const applyGlbSkinColor = useCallback((color?: Partial<SkinParams>) => {
      if (!color) return;
      if (!sceneRefHolder.current) return;

      const r = (color.r ?? 235) / 255;
      const g = (color.g ?? 200) / 255;
      const b = (color.b ?? 178) / 255;

      // Apply brightness and saturation adjustments
      let finalR = r, finalG = g, finalB = b;
      if (color.brightness !== undefined) {
        const brightFactor = (color.brightness - 50) / 100; // -0.5 to 0.5
        finalR = Math.max(0, Math.min(1, finalR + brightFactor * 0.3));
        finalG = Math.max(0, Math.min(1, finalG + brightFactor * 0.3));
        finalB = Math.max(0, Math.min(1, finalB + brightFactor * 0.3));
      }

      const newColor = new Color3(finalR, finalG, finalB);
      const scene = sceneRefHolder.current.scene;

      // Iterate ALL scene meshes (not just cached refs) to catch sub-meshes
      const applyToMaterial = (mat: any) => {
        if (!mat) return;
        const className = mat.getClassName?.() || '';

        // Handle MultiMaterial
        if (className === 'MultiMaterial' && mat.subMaterials) {
          mat.subMaterials.forEach((sub: any) => applyToMaterial(sub));
          return;
        }

        // Clear textures that override albedoColor
        if ('albedoTexture' in mat && mat.albedoTexture) {
          mat.albedoTexture = null;
        }
        if ('baseColorTexture' in mat && mat.baseColorTexture) {
          mat.baseColorTexture = null;
        }

        // Disable vertex colors that multiply with albedoColor
        if ('useVertexColors' in mat) {
          mat.useVertexColors = false;
        }

        // PBRMaterial (standard Babylon PBR)
        if ('albedoColor' in mat) {
          mat.albedoColor = newColor.clone();
        }
        // PBRMetallicRoughnessMaterial (glTF default)
        if ('baseColor' in mat) {
          mat.baseColor = newColor.clone();
        }
        // StandardMaterial fallback
        if ('diffuseColor' in mat) {
          mat.diffuseColor = newColor.clone();
        }

        // Force material update
        if (mat.markDirty) mat.markDirty();
      };

      // Apply only to GLB model meshes (not ground, hair, skeleton visuals, etc.)
      const targetMeshes = glbMeshesRef.current.length > 0
        ? glbMeshesRef.current
        : scene.meshes.filter((m: any) => {
            const name = (m.name || '').toLowerCase();
            // Exclude ground, hair, skeleton visuals, and other helper meshes
            if (name.includes('ground') || name.includes('hair') || name.includes('bone_') || name.includes('joint_')) return false;
            return m.getTotalVertices && m.getTotalVertices() > 0;
          });

      targetMeshes.forEach((mesh: any) => {
        applyToMaterial(mesh.material);
        // Also disable vertex colors on the mesh itself
        if ('hasVertexAlpha' in mesh) {
          mesh.hasVertexAlpha = false;
        }
      });
    }, []);

    // ── Skeleton visualization ──
    const buildSkeletonVisuals = useCallback(() => {
      // Clear old visuals
      skeletonVisualsRef.current.forEach(m => m.dispose());
      skeletonVisualsRef.current = [];

      if (!showSkeleton || !sceneRefHolder.current) return;

      const scene = sceneRefHolder.current.scene;
      
      // Use already imported Babylon.js types

      // Visualize skeleton from GLB
      if (glbSkeletonRef.current) {
        const skeleton = glbSkeletonRef.current;
        const bones = skeleton.bones;
        
        const boneMat = new StandardMaterial("boneMat", scene);
        boneMat.diffuseColor = new Color3(0, 0.8, 0.8);
        boneMat.emissiveColor = new Color3(0, 0.3, 0.3);
        boneMat.alpha = 0.6;
        boneMat.wireframe = true;

        const jointMat = new StandardMaterial("jointMat", scene);
        jointMat.diffuseColor = new Color3(0, 1, 1);
        jointMat.emissiveColor = new Color3(0, 0.5, 0.5);

        bones.forEach((bone: any, i: number) => {
          // Joint sphere
          const joint = MeshBuilder.CreateSphere(`joint_${i}`, { diameter: 0.02, segments: 6 }, scene);
          const pos = bone.getAbsolutePosition();
          joint.position = pos.clone();
          joint.material = jointMat;
          skeletonVisualsRef.current.push(joint);

          // Bone line to parent
          if (bone.getParent()) {
            const parentPos = bone.getParent().getAbsolutePosition();
            const points = [pos.clone(), parentPos.clone()];
            const line = MeshBuilder.CreateLines(`bone_${i}`, { points }, scene);
            line.color = new Color3(0, 0.8, 0.8);
            skeletonVisualsRef.current.push(line);
          }
        });
      }
    }, [showSkeleton]);

    // ── Update hair on GLB model ──
    const updateGlbHair = useCallback((hairCfg?: Partial<HairParams>) => {
      if (modelMode !== "glb" || !sceneRefHolder.current) return;

      const scene = sceneRefHolder.current.scene;

      // Find head position from GLB skeleton
      let headPos = new Vector3(0, 1.6, 0); // Default head position
      let headRadius = 0.11;

      if (glbSkeletonRef.current) {
        const skeleton = glbSkeletonRef.current;
        const headBone = skeleton.bones.find((b: any) => b.name === "head");
        if (headBone) {
          headPos = headBone.getAbsolutePosition().clone();
          // Adjust slightly upward for hair placement
          headPos.y += headRadius * 0.3;
        }
      } else {
        // Estimate head position from mesh bounding box
        let maxY = 0;
        glbMeshesRef.current.forEach(mesh => {
          if (mesh.getBoundingInfo) {
            const bb = mesh.getBoundingInfo().boundingBox;
            if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y;
          }
        });
        if (maxY > 0) {
          headPos = new Vector3(0, maxY - headRadius, 0);
        }
      }

      // Dispose old hair
      if (hairHandleRef.current) {
        hairHandleRef.current.dispose();
        hairHandleRef.current = null;
      }

      if (!hairCfg || hairCfg.isBald) return;

      // Create new hair
      const hairConfig: HairConfig = {
        isBald: hairCfg.isBald,
        length: hairCfg.length,
        volume: hairCfg.volume,
        curliness: hairCfg.curliness,
        baseColor: hairCfg.baseColor,
        tipColor: hairCfg.tipColor,
        midColor: hairCfg.midColor,
        useGradient: hairCfg.useGradient,
        bangsLength: hairCfg.bangsLength,
        rootVolume: hairCfg.rootVolume,
        tipLength: hairCfg.tipLength,
      };

      hairHandleRef.current = createProceduralHair(scene, headPos, headRadius, hairConfig);
    }, [modelMode]);

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
          frameCameraToModel(sceneRefHolder.current.camera);
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

    // ── Camera framing helper ──
    const frameCameraToModel = useCallback((camera: any) => {
      if (!camera) return;

      // Calculate bounding box of all GLB meshes
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      const meshesToCheck = modelMode === "glb" ? glbMeshesRef.current : [];
      
      meshesToCheck.forEach(mesh => {
        if (mesh.getBoundingInfo && mesh.getTotalVertices() > 0) {
          const bb = mesh.getBoundingInfo().boundingBox;
          minY = Math.min(minY, bb.minimumWorld.y);
          maxY = Math.max(maxY, bb.maximumWorld.y);
          minX = Math.min(minX, bb.minimumWorld.x);
          maxX = Math.max(maxX, bb.maximumWorld.x);
          minZ = Math.min(minZ, bb.minimumWorld.z);
          maxZ = Math.max(maxZ, bb.maximumWorld.z);
        }
      });

      if (minY === Infinity) {
        // Fallback for procedural mode
        camera.target.y = 0.85;
        camera.radius = 2.8;
        camera.beta = Math.PI / 2.3;
        return;
      }

      const centerY = (minY + maxY) / 2;
      const height = maxY - minY;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const maxDim = Math.max(height, width, depth);

      // Set camera target to center of model
      camera.target.x = (minX + maxX) / 2;
      camera.target.y = centerY;
      camera.target.z = (minZ + maxZ) / 2;

      // Set radius based on model height for full-body view
      // Need enough distance to see the full model in the viewport
      camera.radius = height * 2.0;
      camera.alpha = Math.PI / 2;
      camera.beta = Math.PI / 2; // Horizontal view angle (eye level)
    }, [modelMode]);

    // ── Load GLB model ──
    useEffect(() => {
      if (!glbUrl || !sceneRefHolder.current) return;

      const scene = sceneRefHolder.current.scene;
      const shadowGen = sceneRefHolder.current.shadowGenerator;

      setIsLoading(true);
      setLoadError(null);
      setLoadProgress(0);

      // Simulate progress
      const progressInterval = setInterval(() => {
        setLoadProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 15;
        });
      }, 200);

      import("@babylonjs/loaders/glTF").then(({ GLTFFileLoader }) => {
        import("@babylonjs/core/Loading/sceneLoader").then(({ SceneLoader }) => {
          // Dispose old GLB meshes
          glbMeshesRef.current.forEach(m => m.dispose());
          glbMeshesRef.current = [];
          glbMorphTargetsRef.current.clear();

          // Dispose procedural avatar
          if (avatarRef.current) {
            avatarRef.current.dispose();
            avatarRef.current = null;
          }

          // Dispose old hair
          if (hairHandleRef.current) {
            hairHandleRef.current.dispose();
            hairHandleRef.current = null;
          }

          SceneLoader.ImportMesh(
            "",
            "",
            glbUrl,
            scene,
            (meshes, _particleSystems, skeletons, animationGroups) => {
              clearInterval(progressInterval);
              setLoadProgress(100);
              setTimeout(() => {
                setIsLoading(false);
                setLoadProgress(0);
              }, 300);
              setModelMode("glb");

              glbMeshesRef.current = meshes;
              if (skeletons.length > 0) {
                glbSkeletonRef.current = skeletons[0];
              }

              let totalVertices = 0;
              let hasBlendShapes = false;

              meshes.forEach(mesh => {
                if (shadowGen && mesh.getTotalVertices() > 0) {
                  shadowGen.addShadowCaster(mesh);
                }
                totalVertices += mesh.getTotalVertices();

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

              // Frame camera to model
              if (sceneRefHolder.current) {
                frameCameraToModel(sceneRefHolder.current.camera);
              }

              // Apply initial skin color
              applyGlbSkinColor(skinColor);

              // Apply initial hair
              if (hairParams) {
                // Small delay to ensure model is fully loaded
                setTimeout(() => updateGlbHair(hairParams), 100);
              }

              onModelLoaded?.({
                vertexCount: totalVertices,
                hasSkeleton: skeletons.length > 0,
                hasBlendShapes,
              });
            },
            undefined,
            (_scene, message) => {
              clearInterval(progressInterval);
              setIsLoading(false);
              setLoadProgress(0);
              setLoadError(message || "模型加载失败");
              setModelMode("procedural");
              onModelError?.(message || "模型加载失败");

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

      return () => {
        clearInterval(progressInterval);
      };
    }, [glbUrl]);

    // ── Apply skin color changes to GLB model in real-time ──
    useEffect(() => {
      if (modelMode === "glb") {
        applyGlbSkinColor(skinColor);
      }
    }, [modelMode, skinColor?.r, skinColor?.g, skinColor?.b, skinColor?.brightness, skinColor?.saturation, applyGlbSkinColor]);

    // ── Apply facial params to GLB model BlendShapes ──
    // Maps facial UI parameters (0-100) to SMPL-X shape BlendShapes
    // shape_0: overall body size (maps to faceDepth/jawWidth)
    // shape_1: height/slimness (maps to chinLength/cheekboneHeight)
    // shape_2: width (maps to noseWidth/mouthWidth)
    // shape_3: upper body (maps to eyeSize/eyeHeight)
    // shape_4: lower body (maps to noseBridge/lipThickness)
    useEffect(() => {
      if (modelMode !== "glb" || !facialParams) return;

      const fp = facialParams;
      // Map facial params to shape blendshapes with subtle influence
      // Each shape param deviation from 50 (neutral) maps to blendshape weight
      const mapToWeight = (val: number | undefined, scale = 0.5) => {
        const v = val ?? 50;
        return ((v - 50) / 50) * scale; // -scale to +scale
      };

      // shape_0: face depth / jaw width influence
      const s0 = mapToWeight(fp.faceDepth, 0.3) + mapToWeight(fp.jawWidth, 0.2);
      setGlbBlendShapeWeight("shape_0", Math.max(0, Math.min(1, 0.5 + s0)));

      // shape_1: chin length / cheekbone height
      const s1 = mapToWeight(fp.chinLength, 0.3) + mapToWeight(fp.cheekboneHeight, 0.2);
      setGlbBlendShapeWeight("shape_1", Math.max(0, Math.min(1, 0.5 + s1)));

      // shape_2: nose width / mouth width
      const s2 = mapToWeight(fp.noseWidth, 0.3) + mapToWeight(fp.mouthWidth, 0.2);
      setGlbBlendShapeWeight("shape_2", Math.max(0, Math.min(1, 0.5 + s2)));

      // shape_3: eye size / eye height
      const s3 = mapToWeight(fp.eyeSize, 0.3) + mapToWeight(fp.eyeHeight, 0.2);
      setGlbBlendShapeWeight("shape_3", Math.max(0, Math.min(1, 0.5 + s3)));

      // shape_4: nose bridge / lip thickness
      const s4 = mapToWeight(fp.noseBridge, 0.3) + mapToWeight(fp.lipThickness, 0.2);
      setGlbBlendShapeWeight("shape_4", Math.max(0, Math.min(1, 0.5 + s4)));
    }, [
      modelMode,
      facialParams?.eyeSize,
      facialParams?.eyeDistance,
      facialParams?.eyeHeight,
      facialParams?.noseHeight,
      facialParams?.noseWidth,
      facialParams?.noseBridge,
      facialParams?.mouthWidth,
      facialParams?.lipThickness,
      facialParams?.jawWidth,
      facialParams?.chinLength,
      facialParams?.cheekboneHeight,
      facialParams?.faceDepth,
      setGlbBlendShapeWeight,
    ]);

    // ── Update hair on GLB model when hair params change ──
    useEffect(() => {
      if (modelMode === "glb") {
        updateGlbHair(hairParams);
      }
    }, [
      modelMode,
      hairParams?.isBald,
      hairParams?.length,
      hairParams?.volume,
      hairParams?.curliness,
      hairParams?.baseColor,
      hairParams?.tipColor,
      hairParams?.useGradient,
      hairParams?.bangsLength,
      hairParams?.rootVolume,
      updateGlbHair,
    ]);

    // ── Skeleton visualization toggle ──
    useEffect(() => {
      buildSkeletonVisuals();
    }, [showSkeleton, buildSkeletonVisuals]);

    // Procedural mode: rebuild avatar when config changes (only when no GLB)
    useEffect(() => {
      if (modelMode === "glb" || !sceneRefHolder.current) return;

      const { scene, shadowGenerator } = sceneRefHolder.current;

      if (avatarRef.current) {
        avatarRef.current.dispose();
        avatarRef.current = null;
      }

      const handle = createSMPLXAvatar(scene, configRef.current, shadowGenerator);
      avatarRef.current = handle;

      return () => {
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
        frameCameraToModel(sceneRefHolder.current.camera);
      }
    }, [frameCameraToModel]);

    const handleZoomIn = useCallback(() => {
      if (sceneRefHolder.current) {
        const cam = sceneRefHolder.current.camera;
        cam.radius = Math.max(cam.lowerRadiusLimit || 0.5, cam.radius - 0.3);
      }
    }, []);

    const handleZoomOut = useCallback(() => {
      if (sceneRefHolder.current) {
        const cam = sceneRefHolder.current.camera;
        cam.radius = Math.min(cam.upperRadiusLimit || 8, cam.radius + 0.3);
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
              beta: Math.PI / 2.3,
              radius: 2.8,
              target: { x: 0, y: 0.85, z: 0 },
              lowerRadiusLimit: 0.5,
              upperRadiusLimit: 6,
            }}
          />

          {/* Loading overlay with progress bar */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3 w-48">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">加载 SMPL-X 模型中...</span>
                {/* Progress bar */}
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, loadProgress)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {Math.round(loadProgress)}%
                </span>
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
            {/* Skeleton visualization toggle */}
            {modelMode === "glb" && glbSkeletonRef.current && (
              <Button
                variant="outline"
                size="icon"
                className={`w-8 h-8 backdrop-blur-sm ${
                  showSkeleton
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "bg-background/80"
                }`}
                onClick={() => setShowSkeleton(prev => !prev)}
                title={showSkeleton ? "隐藏骨骼" : "显示骨骼"}
              >
                <BoneIcon className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }
);

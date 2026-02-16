/**
 * useSmplxModel - 自动生成真实 SMPL-X GLB 模型的 Hook
 * 
 * 当 Python 微服务在线时，自动调用 modelService.generateGlb 生成真实模型。
 * 当服务离线或生成失败时，回退到占位模型（glbUrl 为 null）。
 * 
 * 支持骨架参数变化时防抖重新生成模型。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";

type SmplxModelParams = {
  /** 数字人 ID（用于缓存关联） */
  avatarId?: number;
  /** 性别 */
  gender?: "male" | "female" | "neutral";
  /** 已有的 GLB URL（如果已经通过 SAM 拟合生成过） */
  existingGlbUrl?: string | null;
  /** 骨架参数（用于将 UI 参数转换为 SMPL-X betas） */
  skeletonParams?: {
    height?: number;
    shoulderWidth?: number;
    hipHeight?: number;
    hipWidth?: number;
    armLength?: number;
    legLength?: number;
    torsoLength?: number;
    neckLength?: number;
  };
  /** 肤色 RGBA */
  skinColor?: [number, number, number, number];
  /** 是否启用自动生成（默认 true） */
  enabled?: boolean;
  /** 防抖延迟（毫秒，默认 800） */
  debounceMs?: number;
};

type SmplxModelResult = {
  /** 最终的 GLB URL（真实模型或 null） */
  glbUrl: string | null;
  /** 是否正在生成模型 */
  isGenerating: boolean;
  /** 模型服务是否在线 */
  serviceOnline: boolean;
  /** 是否使用真实模型 */
  isRealModel: boolean;
  /** 错误信息 */
  error: string | null;
  /** 手动触发重新生成 */
  regenerate: () => void;
};

/**
 * 将 UI 骨架参数映射为 SMPL-X betas 参数（10维）
 * 
 * SMPL-X 的前几个 beta 参数大致对应：
 * beta[0]: 整体体型大小（身高相关）
 * beta[1]: 体重/胖瘦
 * beta[2]: 肩宽
 * beta[3]: 腰臀比
 * beta[4]: 腿长比例
 * beta[5-9]: 其他细节变形
 */
function skeletonToBetas(params?: SmplxModelParams["skeletonParams"]): number[] {
  if (!params) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const height = params.height ?? 170;
  const shoulderWidth = params.shoulderWidth ?? 40;
  const hipWidth = params.hipWidth ?? 35;
  const legLength = params.legLength ?? 80;
  const torsoLength = params.torsoLength ?? 50;
  const armLength = params.armLength ?? 60;

  // 归一化到 [-3, 3] 范围（SMPL-X betas 的典型范围）
  const heightBeta = ((height - 170) / 20) * 2;        // 170cm = 0, 190cm = 2, 150cm = -2
  const weightBeta = 0;                                  // 默认中等体重
  const shoulderBeta = ((shoulderWidth - 40) / 10) * 2; // 40cm = 0
  const hipBeta = ((hipWidth - 35) / 10) * 2;           // 35cm = 0
  const legBeta = ((legLength - 80) / 15) * 2;          // 80cm = 0
  const torsoBeta = ((torsoLength - 50) / 10) * 1.5;    // 50cm = 0
  const armBeta = ((armLength - 60) / 15) * 1.5;        // 60cm = 0

  return [
    Math.max(-3, Math.min(3, heightBeta)),
    Math.max(-3, Math.min(3, weightBeta)),
    Math.max(-3, Math.min(3, shoulderBeta)),
    Math.max(-3, Math.min(3, hipBeta)),
    Math.max(-3, Math.min(3, legBeta)),
    Math.max(-3, Math.min(3, torsoBeta)),
    Math.max(-3, Math.min(3, armBeta)),
    0, 0, 0,
  ];
}

function skinParamsToColor(skinParams?: any): [number, number, number, number] | undefined {
  if (!skinParams) return undefined;
  const r = (skinParams.r ?? 217) / 255;
  const g = (skinParams.g ?? 192) / 255;
  const b = (skinParams.b ?? 166) / 255;
  return [r, g, b, 1.0];
}

export function useSmplxModel(params: SmplxModelParams): SmplxModelResult {
  const {
    avatarId,
    gender = "female",
    existingGlbUrl,
    skeletonParams,
    skinColor,
    enabled = true,
    debounceMs = 800,
  } = params;

  const [generatedGlbUrl, setGeneratedGlbUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParamsHashRef = useRef<string>("");

  // Check model service health
  const healthQuery = trpc.modelService.health.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30000, // 30s 内不重新检查
  });

  const serviceOnline = !!(healthQuery.data?.available && healthQuery.data?.smplxAvailable);

  // Generate GLB mutation
  const generateGlbMutation = trpc.modelService.generateGlb.useMutation();

  // Compute betas from skeleton params
  const betas = useMemo(() => skeletonToBetas(skeletonParams), [
    skeletonParams?.height,
    skeletonParams?.shoulderWidth,
    skeletonParams?.hipHeight,
    skeletonParams?.hipWidth,
    skeletonParams?.armLength,
    skeletonParams?.legLength,
    skeletonParams?.torsoLength,
    skeletonParams?.neckLength,
  ]);

  // Compute skin color
  const computedSkinColor = useMemo(() => skinColor, [
    skinColor?.[0], skinColor?.[1], skinColor?.[2], skinColor?.[3],
  ]);

  // Create a hash of current params to detect changes
  const paramsHash = useMemo(() => {
    return JSON.stringify({ betas, gender, skinColor: computedSkinColor });
  }, [betas, gender, computedSkinColor]);

  // Generate model function
  const doGenerate = useCallback(async () => {
    if (!serviceOnline || !enabled) return;

    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateGlbMutation.mutateAsync({
        betas,
        gender: gender === "male" ? "male" : gender === "female" ? "female" : "neutral",
        skinColor: computedSkinColor,
        avatarId,
        scale: (skeletonParams?.height ?? 170) / 170,
      });

      if (result.glbUrl) {
        setGeneratedGlbUrl(result.glbUrl);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "模型生成失败";
      setError(msg);
      console.warn("[useSmplxModel] Generation failed:", msg);
    } finally {
      setIsGenerating(false);
    }
  }, [serviceOnline, enabled, betas, gender, computedSkinColor, avatarId, skeletonParams?.height]);

  // Manual regenerate
  const regenerate = useCallback(() => {
    lastParamsHashRef.current = ""; // Force regeneration
    doGenerate();
  }, [doGenerate]);

  // Auto-generate when service comes online or params change (debounced)
  useEffect(() => {
    // If already have an existing GLB from SAM fitting, use that
    if (existingGlbUrl) return;

    // If service is not online or not enabled, skip
    if (!serviceOnline || !enabled) return;

    // If params haven't changed, skip
    if (paramsHash === lastParamsHashRef.current) return;

    // Debounce the generation
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      lastParamsHashRef.current = paramsHash;
      doGenerate();
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [serviceOnline, enabled, paramsHash, existingGlbUrl, debounceMs, doGenerate]);

  // Determine final GLB URL
  const glbUrl = existingGlbUrl || generatedGlbUrl;
  const isRealModel = !!glbUrl;

  return {
    glbUrl,
    isGenerating,
    serviceOnline,
    isRealModel,
    error,
    regenerate,
  };
}

export { skinParamsToColor };

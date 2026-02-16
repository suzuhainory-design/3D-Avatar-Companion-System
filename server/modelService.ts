/**
 * Model Service Client
 * 
 * Node.js 后端与 Python 微服务（avatar-model-service）的通信层。
 * 通过 HTTP 调用 FastAPI 端点，处理 SAM+SMPL-X 拟合和 GLB 导出。
 */
import { ENV } from "./_core/env";

const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || "http://localhost:8100";

interface FitMeshOptions {
  meshJsonBuffer: Buffer;
  gender?: string;
  targetHeight?: number;
  iterations?: number;
  exportGlb?: boolean;
  includeSkeleton?: boolean;
  includeBlendshapes?: boolean;
}

interface FitMeshResult {
  success: boolean;
  glbBuffer?: Buffer;
  fitInfo?: {
    vertexCount: number;
    jointCount: number;
    fitLoss: number;
  };
  jsonResult?: {
    success: boolean;
    iterations: number;
    loss: Record<string, number>;
    betas: number[];
    body_pose: number[];
    global_orient: number[];
    translation: number[];
    scale: number;
    vertex_count: number;
    joint_count: number;
  };
}

interface GenerateGlbOptions {
  betas?: number[];
  bodyPose?: number[];
  globalOrient?: number[];
  translation?: number[];
  scale?: number;
  gender?: string;
  includeSkeleton?: boolean;
  includeBlendshapes?: boolean;
  skinColor?: [number, number, number, number];
}

interface ModelInfo {
  model_dir: string;
  available_genders: string[];
  joint_count: number;
  joint_names: string[];
  blendshape_names: string[];
}

/**
 * 检查 Python 模型服务是否可用。
 */
export async function checkModelServiceHealth(): Promise<{
  available: boolean;
  smplxAvailable: boolean;
  device: string;
}> {
  try {
    const response = await fetch(`${MODEL_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { available: false, smplxAvailable: false, device: "unknown" };
    }
    const data = await response.json() as any;
    return {
      available: true,
      smplxAvailable: data.smplx_available ?? false,
      device: data.device ?? "unknown",
    };
  } catch {
    return { available: false, smplxAvailable: false, device: "unknown" };
  }
}

/**
 * 完整流水线：SAM JSON → SMPL-X 拟合 → GLB 导出。
 */
export async function fitMeshToGlb(options: FitMeshOptions): Promise<FitMeshResult> {
  const formData = new FormData();

  const meshBlob = new Blob([new Uint8Array(options.meshJsonBuffer)], { type: "application/json" });
  formData.append("mesh_json", meshBlob, "mesh.json");
  formData.append("gender", options.gender || "neutral");
  formData.append("target_height", String(options.targetHeight || 1.7));
  formData.append("iterations", String(options.iterations || 200));
  formData.append("export_glb", String(options.exportGlb !== false));
  formData.append("include_skeleton", String(options.includeSkeleton !== false));
  formData.append("include_blendshapes", String(options.includeBlendshapes !== false));

  const response = await fetch(`${MODEL_SERVICE_URL}/api/fit-mesh`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(120000), // 2 分钟超时（拟合可能较慢）
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model service fit-mesh failed (${response.status}): ${errorText}`);
  }

  if (options.exportGlb === false) {
    const jsonResult = await response.json() as any;
    return { success: jsonResult.success, jsonResult };
  }

  const glbBuffer = Buffer.from(await response.arrayBuffer());
  return {
    success: response.headers.get("X-Fit-Success") === "True",
    glbBuffer,
    fitInfo: {
      vertexCount: parseInt(response.headers.get("X-Vertex-Count") || "0"),
      jointCount: parseInt(response.headers.get("X-Joint-Count") || "0"),
      fitLoss: parseFloat(response.headers.get("X-Fit-Loss") || "0"),
    },
  };
}

/**
 * 从 SMPL-X 参数直接生成 GLB 文件。
 */
export async function generateGlbFromParams(options: GenerateGlbOptions): Promise<Buffer> {
  const formData = new FormData();

  formData.append("betas", JSON.stringify(options.betas || []));
  formData.append("body_pose", JSON.stringify(options.bodyPose || []));
  formData.append("global_orient", JSON.stringify(options.globalOrient || [0, 0, 0]));
  formData.append("translation", JSON.stringify(options.translation || [0, 0, 0]));
  formData.append("scale", String(options.scale || 1.0));
  formData.append("gender", options.gender || "neutral");
  formData.append("include_skeleton", String(options.includeSkeleton !== false));
  formData.append("include_blendshapes", String(options.includeBlendshapes !== false));
  formData.append("skin_color", JSON.stringify(options.skinColor || [0.85, 0.75, 0.65, 1.0]));

  const response = await fetch(`${MODEL_SERVICE_URL}/api/generate-glb`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model service generate-glb failed (${response.status}): ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * 从 .npz 文件导出 GLB。
 */
export async function exportGlbFromNpz(
  npzBuffer: Buffer,
  options?: {
    gender?: string;
    includeSkeleton?: boolean;
    includeBlendshapes?: boolean;
    skinColor?: [number, number, number, number];
  }
): Promise<Buffer> {
  const formData = new FormData();

  const npzBlob = new Blob([new Uint8Array(npzBuffer)], { type: "application/octet-stream" });
  formData.append("npz_file", npzBlob, "result.npz");
  formData.append("gender", options?.gender || "neutral");
  formData.append("include_skeleton", String(options?.includeSkeleton !== false));
  formData.append("include_blendshapes", String(options?.includeBlendshapes !== false));
  formData.append("skin_color", JSON.stringify(options?.skinColor || [0.85, 0.75, 0.65, 1.0]));

  const response = await fetch(`${MODEL_SERVICE_URL}/api/export-glb-from-npz`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model service export-glb-from-npz failed (${response.status}): ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * 获取模型服务信息。
 */
export async function getModelInfo(): Promise<ModelInfo> {
  const response = await fetch(`${MODEL_SERVICE_URL}/api/model-info`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Model service model-info failed (${response.status})`);
  }

  return response.json() as Promise<ModelInfo>;
}

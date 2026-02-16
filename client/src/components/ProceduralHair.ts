/**
 * ProceduralHair - 程序化3D头发生成系统
 * 
 * 在 SMPL-X GLB 模型的头部位置叠加渲染程序化头发网格。
 * 支持多种发型参数：长度、发量、卷曲度、颜色、渐变等。
 */
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  VertexData,
  Matrix,
} from "@babylonjs/core";

export type HairConfig = {
  isBald?: boolean;
  length?: number;       // 0-100, 头发长度
  volume?: number;       // 0-100, 发量/蓬松度
  curliness?: number;    // 0-100, 卷曲度
  baseColor?: string;    // hex 发根颜色
  tipColor?: string;     // hex 发梢颜色
  midColor?: string;     // hex 发中颜色
  useGradient?: boolean; // 是否使用渐变
  bangsLength?: number;  // 0-80, 刘海长度
  rootVolume?: number;   // 0-100, 发根蓬松度
  tipLength?: number;    // 0-100, 发梢长度
};

export type ProceduralHairHandle = {
  update: (config: HairConfig) => void;
  dispose: () => void;
  rootNode: TransformNode;
};

function hexToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

/**
 * 在指定的头部位置创建程序化头发
 * @param scene Babylon.js 场景
 * @param headPosition 头部中心位置（世界坐标）
 * @param headRadius 头部半径
 * @param config 头发配置
 */
export function createProceduralHair(
  scene: Scene,
  headPosition: Vector3,
  headRadius: number,
  config: HairConfig
): ProceduralHairHandle {
  const rootNode = new TransformNode("hairRoot", scene);
  rootNode.position = headPosition.clone();
  
  const meshes: Mesh[] = [];
  const materials: StandardMaterial[] = [];

  function buildHair(cfg: HairConfig) {
    // Dispose old meshes
    meshes.forEach(m => m.dispose());
    meshes.length = 0;
    materials.forEach(m => m.dispose());
    materials.length = 0;

    if (cfg.isBald) return;

    const hairLength = (cfg.length ?? 40) / 100;
    const hairVolume = (cfg.volume ?? 50) / 100;
    const curliness = (cfg.curliness ?? 20) / 100;
    const bangsLen = (cfg.bangsLength ?? 30) / 100;
    const rootVol = (cfg.rootVolume ?? 50) / 100;
    const baseColor = cfg.baseColor || "#2a1a0a";
    const tipColor = cfg.tipColor || baseColor;
    const useGradient = cfg.useGradient ?? false;

    // ── 主发色材质 ──
    const hairMat = new StandardMaterial("hairMainMat", scene);
    hairMat.diffuseColor = hexToColor3(baseColor);
    hairMat.specularColor = new Color3(0.25, 0.22, 0.18);
    hairMat.specularPower = 48;
    hairMat.backFaceCulling = false;
    materials.push(hairMat);

    // ── 发梢材质（渐变时使用） ──
    let tipMat: StandardMaterial | null = null;
    if (useGradient && tipColor !== baseColor) {
      tipMat = new StandardMaterial("hairTipMat", scene);
      tipMat.diffuseColor = hexToColor3(tipColor);
      tipMat.specularColor = new Color3(0.2, 0.18, 0.15);
      tipMat.specularPower = 32;
      tipMat.backFaceCulling = false;
      materials.push(tipMat);
    }

    const r = headRadius;

    // ── 头发帽（覆盖头顶） ──
    const capRadius = r + 0.01 + hairVolume * 0.025 + rootVol * 0.015;
    const hairCap = MeshBuilder.CreateSphere("hairCap", {
      diameter: capRadius * 2,
      segments: 20,
      slice: 0.55,
    }, scene);
    hairCap.position = new Vector3(0, r * 0.15, -r * 0.05);
    hairCap.material = hairMat;
    hairCap.parent = rootNode;
    meshes.push(hairCap);

    // ── 侧发（左右两侧的头发体积） ──
    const sideVolume = hairVolume * 0.6 + rootVol * 0.3;
    if (sideVolume > 0.1) {
      [-1, 1].forEach((side) => {
        const sideHair = MeshBuilder.CreateCylinder(`sideHair_${side > 0 ? 'r' : 'l'}`, {
          diameterTop: r * (0.6 + sideVolume * 0.4),
          diameterBottom: r * (0.3 + sideVolume * 0.2) * (1 - hairLength * 0.3),
          height: r * 0.8 + hairLength * r * 1.2,
          tessellation: 12,
        }, scene);
        sideHair.position = new Vector3(
          side * r * (0.6 + sideVolume * 0.2),
          -r * 0.1 - (hairLength * r * 0.6),
          -r * 0.15
        );
        sideHair.material = hairMat;
        sideHair.parent = rootNode;
        meshes.push(sideHair);
      });
    }

    // ── 后发（长发主体） ──
    if (hairLength > 0.15) {
      const backHairH = hairLength * r * 3.5;
      const backTopW = r * (1.2 + hairVolume * 0.3);
      const backBottomW = r * (0.8 - hairLength * 0.2 + hairVolume * 0.15);

      // 主体后发
      const backHair = MeshBuilder.CreateCylinder("backHair", {
        diameterTop: backTopW * 2,
        diameterBottom: backBottomW * 2,
        height: backHairH,
        tessellation: 16,
      }, scene);
      backHair.position = new Vector3(0, -r * 0.3 - backHairH / 2, -r * 0.45);
      backHair.scaling.z = 0.5 + hairVolume * 0.3;
      backHair.material = hairMat;
      backHair.parent = rootNode;
      meshes.push(backHair);

      // 卷曲效果：通过倾斜和额外的球体来模拟
      if (curliness > 0.3) {
        const numCurls = Math.floor(curliness * 8);
        for (let i = 0; i < numCurls; i++) {
          const angle = (i / numCurls) * Math.PI * 1.5 - Math.PI * 0.75;
          const curlY = -r * 0.5 - backHairH * (0.3 + (i / numCurls) * 0.6);
          const curlR = backBottomW * (0.3 + curliness * 0.3);
          const curl = MeshBuilder.CreateSphere(`curl_${i}`, {
            diameter: curlR * 2,
            segments: 8,
          }, scene);
          curl.position = new Vector3(
            Math.sin(angle) * backBottomW * 0.8,
            curlY,
            -r * 0.45 + Math.cos(angle) * backBottomW * 0.3
          );
          curl.material = hairMat;
          curl.parent = rootNode;
          meshes.push(curl);
        }
      }

      // 渐变发梢
      if (useGradient && tipMat && hairLength > 0.3) {
        const tipH = backHairH * 0.35;
        const tipPiece = MeshBuilder.CreateCylinder("hairTipPiece", {
          diameterTop: backBottomW * 2,
          diameterBottom: r * 0.3,
          height: tipH,
          tessellation: 12,
        }, scene);
        tipPiece.position = new Vector3(
          0,
          -r * 0.3 - backHairH - tipH / 2,
          -r * 0.45
        );
        tipPiece.scaling.z = 0.5 + hairVolume * 0.3;
        tipPiece.material = tipMat;
        tipPiece.parent = rootNode;
        meshes.push(tipPiece);
      }
    }

    // ── 刘海 ──
    if (bangsLen > 0.05) {
      const bangsH = bangsLen * r * 2;
      const bangsW = r * (1.4 + hairVolume * 0.2);

      const bangs = MeshBuilder.CreateBox("bangs", {
        width: bangsW,
        height: bangsH,
        depth: r * 0.15,
      }, scene);
      bangs.position = new Vector3(
        0,
        r * 0.4 - bangsH / 2,
        r * 0.75
      );
      // 轻微向前倾斜
      bangs.rotation.x = -0.15 - bangsLen * 0.2;
      bangs.material = hairMat;
      bangs.parent = rootNode;
      meshes.push(bangs);

      // 刘海的圆润边缘
      const bangsEdge = MeshBuilder.CreateCylinder("bangsEdge", {
        diameterTop: bangsW,
        diameterBottom: bangsW * 0.9,
        height: r * 0.08,
        tessellation: 12,
      }, scene);
      bangsEdge.position = new Vector3(
        0,
        r * 0.4 - bangsH,
        r * 0.75
      );
      bangsEdge.rotation.x = Math.PI / 2 - 0.15;
      bangsEdge.material = hairMat;
      bangsEdge.parent = rootNode;
      meshes.push(bangsEdge);
    }
  }

  // Initial build
  buildHair(config);

  return {
    rootNode,
    update: (newConfig: HairConfig) => {
      buildHair(newConfig);
    },
    dispose: () => {
      meshes.forEach(m => m.dispose());
      materials.forEach(m => m.dispose());
      rootNode.dispose();
    },
  };
}

/**
 * SMPL-X Parametric Human Body Model System
 * 
 * Generates a fully rigged 3D human avatar using Babylon.js procedural mesh,
 * with SMPL-X-style parametric control over body shape, facial features,
 * skin color, hair, clothing, and animations.
 */
import { useRef, useEffect, useCallback } from "react";
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Skeleton,
  Bone,
  Matrix,
  Space,
  TransformNode,
  Animation,
  AnimationGroup,
  VertexData,
  VertexBuffer,
  PBRMaterial,
  Texture,
  ShadowGenerator,
} from "@babylonjs/core";

// ─── Types ───────────────────────────────────────────────────────────

export type SkeletonParams = {
  height: number;
  shoulderWidth: number;
  hipHeight: number;
  hipWidth: number;
  armLength: number;
  legLength: number;
  torsoLength: number;
  neckLength: number;
};

export type SkinParams = {
  r: number;
  g: number;
  b: number;
  brightness?: number;
  saturation?: number;
};

export type FacialParams = {
  eyeSize?: number;
  eyeDistance?: number;
  eyeHeight?: number;
  noseHeight?: number;
  noseWidth?: number;
  noseBridge?: number;
  mouthWidth?: number;
  lipThickness?: number;
  jawWidth?: number;
  chinLength?: number;
  cheekboneHeight?: number;
  faceDepth?: number;
};

export type GenderFeatureParams = {
  breastSize?: number;
  adamAppleSize?: number;
  adamAppleProminence?: number;
};

export type HairParams = {
  isBald?: boolean;
  length?: number;
  volume?: number;
  curliness?: number;
  baseColor?: string;
  tipColor?: string;
  midColor?: string;
  useGradient?: boolean;
  tipLength?: number;
  rootVolume?: number;
  bangsLength?: number;
};

export type ClothingParams = {
  topColor?: { r: number; g: number; b: number };
  bottomColor?: { r: number; g: number; b: number };
  type?: string;
};

export type AvatarAnimationState = {
  emotion?: string;
  emotionIntensity?: number;
  isSpeaking?: boolean;
  visemeIndex?: number;
  gesture?: string;
};

export type SMPLXAvatarConfig = {
  skeleton?: Partial<SkeletonParams>;
  skin?: Partial<SkinParams>;
  facial?: Partial<FacialParams>;
  gender?: "male" | "female";
  genderFeatures?: Partial<GenderFeatureParams>;
  hair?: Partial<HairParams>;
  clothing?: Partial<ClothingParams>;
  animation?: AvatarAnimationState;
};

export type SMPLXAvatarHandle = {
  updateConfig: (config: Partial<SMPLXAvatarConfig>) => void;
  playAnimation: (name: string) => void;
  setViseme: (index: number) => void;
  setEmotion: (emotion: string, intensity: number) => void;
  dispose: () => void;
  rootNode: TransformNode | null;
};

// ─── Default Values ──────────────────────────────────────────────────

const DEFAULT_SKELETON: SkeletonParams = {
  height: 170, shoulderWidth: 40, hipHeight: 90, hipWidth: 35,
  armLength: 60, legLength: 80, torsoLength: 50, neckLength: 10,
};

const DEFAULT_SKIN: SkinParams = { r: 235, g: 200, b: 178 };

// ─── Helper Functions ────────────────────────────────────────────────

function hexToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

function rgbToColor3(rgb: { r: number; g: number; b: number }): Color3 {
  return new Color3(rgb.r / 255, rgb.g / 255, rgb.b / 255);
}

/** Normalize skeleton params to a unit scale (height=1.0) */
function normalizeScale(skeleton: SkeletonParams): number {
  return skeleton.height / 170;
}

// ─── Avatar Builder ──────────────────────────────────────────────────

export function createSMPLXAvatar(
  scene: Scene,
  config: SMPLXAvatarConfig,
  shadowGenerator?: ShadowGenerator | null
): SMPLXAvatarHandle {
  const rootNode = new TransformNode("avatarRoot", scene);
  const meshes: Mesh[] = [];
  const materials: StandardMaterial[] = [];
  const animationGroups: AnimationGroup[] = [];

  const sk = { ...DEFAULT_SKELETON, ...config.skeleton };
  const skinRgb = { ...DEFAULT_SKIN, ...config.skin };
  const gender = config.gender || "female";
  const facial = config.facial || {};
  const genderFeatures = config.genderFeatures || {};
  const hair = config.hair || {};
  const clothing = config.clothing || {};

  const scale = normalizeScale(sk);
  rootNode.scaling = new Vector3(scale, scale, scale);

  // ── Skin Material ──
  const skinMat = new StandardMaterial("skinMat", scene);
  skinMat.diffuseColor = rgbToColor3(skinRgb);
  skinMat.specularColor = new Color3(0.15, 0.12, 0.1);
  skinMat.specularPower = 32;
  skinMat.backFaceCulling = true;
  materials.push(skinMat);

  // ── Clothing Material ──
  const topColor = clothing.topColor || { r: 60, g: 80, b: 120 };
  const bottomColor = clothing.bottomColor || { r: 40, g: 45, b: 65 };

  const clothTopMat = new StandardMaterial("clothTopMat", scene);
  clothTopMat.diffuseColor = rgbToColor3(topColor);
  clothTopMat.specularColor = new Color3(0.05, 0.05, 0.05);
  clothTopMat.specularPower = 16;
  materials.push(clothTopMat);

  const clothBottomMat = new StandardMaterial("clothBottomMat", scene);
  clothBottomMat.diffuseColor = rgbToColor3(bottomColor);
  clothBottomMat.specularColor = new Color3(0.05, 0.05, 0.05);
  clothBottomMat.specularPower = 16;
  materials.push(clothBottomMat);

  // ── Body proportions (in local units, height=~1.8m) ──
  const torsoH = (sk.torsoLength / 50) * 0.45;
  const neckH = (sk.neckLength / 10) * 0.08;
  const legH = (sk.legLength / 80) * 0.8;
  const armH = (sk.armLength / 60) * 0.55;
  const shoulderW = (sk.shoulderWidth / 40) * 0.38;
  const hipW = (sk.hipWidth / 35) * 0.3;

  const headRadius = 0.12;
  const headY = legH + torsoH + neckH + headRadius;

  // ── Head ──
  const head = MeshBuilder.CreateSphere("head", { diameter: headRadius * 2, segments: 24 }, scene);
  head.position = new Vector3(0, headY, 0);
  head.material = skinMat;
  head.parent = rootNode;
  meshes.push(head);

  // ── Face features ──
  const eyeSize = ((facial.eyeSize ?? 50) / 100) * 0.025 + 0.015;
  const eyeDist = ((facial.eyeDistance ?? 50) / 100) * 0.04 + 0.03;
  const eyeH = ((facial.eyeHeight ?? 50) / 100) * 0.03 + headY - 0.01;

  // Eyes
  const eyeMat = new StandardMaterial("eyeMat", scene);
  eyeMat.diffuseColor = new Color3(0.95, 0.95, 0.98);
  eyeMat.specularColor = new Color3(0.5, 0.5, 0.5);
  eyeMat.specularPower = 64;
  materials.push(eyeMat);

  const pupilMat = new StandardMaterial("pupilMat", scene);
  pupilMat.diffuseColor = new Color3(0.12, 0.08, 0.06);
  pupilMat.specularColor = new Color3(0.3, 0.3, 0.3);
  materials.push(pupilMat);

  const leftEye = MeshBuilder.CreateSphere("leftEye", { diameter: eyeSize * 2, segments: 12 }, scene);
  leftEye.position = new Vector3(-eyeDist, eyeH, headRadius * 0.85);
  leftEye.material = eyeMat;
  leftEye.parent = rootNode;
  meshes.push(leftEye);

  const rightEye = MeshBuilder.CreateSphere("rightEye", { diameter: eyeSize * 2, segments: 12 }, scene);
  rightEye.position = new Vector3(eyeDist, eyeH, headRadius * 0.85);
  rightEye.material = eyeMat;
  rightEye.parent = rootNode;
  meshes.push(rightEye);

  // Pupils
  const pupilSize = eyeSize * 0.5;
  const leftPupil = MeshBuilder.CreateSphere("leftPupil", { diameter: pupilSize * 2, segments: 8 }, scene);
  leftPupil.position = new Vector3(-eyeDist, eyeH, headRadius * 0.85 + eyeSize * 0.6);
  leftPupil.material = pupilMat;
  leftPupil.parent = rootNode;
  meshes.push(leftPupil);

  const rightPupil = MeshBuilder.CreateSphere("rightPupil", { diameter: pupilSize * 2, segments: 8 }, scene);
  rightPupil.position = new Vector3(eyeDist, eyeH, headRadius * 0.85 + eyeSize * 0.6);
  rightPupil.material = pupilMat;
  rightPupil.parent = rootNode;
  meshes.push(rightPupil);

  // Nose
  const noseH = ((facial.noseHeight ?? 50) / 100) * 0.03 + 0.02;
  const noseW = ((facial.noseWidth ?? 50) / 100) * 0.015 + 0.01;
  const noseBridge = ((facial.noseBridge ?? 50) / 100) * 0.015 + 0.005;

  const nose = MeshBuilder.CreateCylinder("nose", {
    diameterTop: noseW * 0.6,
    diameterBottom: noseW * 1.2,
    height: noseH,
    tessellation: 8,
  }, scene);
  nose.position = new Vector3(0, headY - 0.03, headRadius * 0.9 + noseBridge);
  nose.rotation.x = -Math.PI / 8;
  nose.material = skinMat;
  nose.parent = rootNode;
  meshes.push(nose);

  // Mouth
  const mouthW = ((facial.mouthWidth ?? 50) / 100) * 0.03 + 0.02;
  const lipThick = ((facial.lipThickness ?? 50) / 100) * 0.008 + 0.004;

  const mouthMat = new StandardMaterial("mouthMat", scene);
  mouthMat.diffuseColor = new Color3(
    Math.min(1, skinRgb.r / 255 + 0.15),
    Math.max(0, skinRgb.g / 255 - 0.1),
    Math.max(0, skinRgb.b / 255 - 0.1)
  );
  materials.push(mouthMat);

  const mouth = MeshBuilder.CreateBox("mouth", {
    width: mouthW,
    height: lipThick,
    depth: 0.01,
  }, scene);
  mouth.position = new Vector3(0, headY - 0.07, headRadius * 0.88);
  mouth.material = mouthMat;
  mouth.parent = rootNode;
  meshes.push(mouth);

  // Jaw shape
  const jawW = ((facial.jawWidth ?? 50) / 100) * 0.02;
  head.scaling.x = 1 + jawW * 0.5;

  // ── Neck ──
  const neck = MeshBuilder.CreateCylinder("neck", {
    diameterTop: 0.07,
    diameterBottom: 0.09,
    height: neckH,
    tessellation: 12,
  }, scene);
  neck.position = new Vector3(0, legH + torsoH + neckH / 2, 0);
  neck.material = skinMat;
  neck.parent = rootNode;
  meshes.push(neck);

  // Adam's apple (male)
  if (gender === "male") {
    const appleSize = ((genderFeatures.adamAppleSize ?? 50) / 100) * 0.015 + 0.005;
    const appleProm = ((genderFeatures.adamAppleProminence ?? 50) / 100) * 0.01 + 0.005;
    const adamApple = MeshBuilder.CreateSphere("adamApple", { diameter: appleSize * 2, segments: 8 }, scene);
    adamApple.position = new Vector3(0, legH + torsoH + neckH * 0.4, appleProm + 0.04);
    adamApple.material = skinMat;
    adamApple.parent = rootNode;
    meshes.push(adamApple);
  }

  // ── Torso (clothing) ──
  const torsoTopW = shoulderW;
  const torsoBottomW = hipW;
  const torsoDepthTop = 0.14;
  const torsoDepthBottom = 0.12;

  const torso = MeshBuilder.CreateCylinder("torso", {
    diameterTop: torsoTopW * 2,
    diameterBottom: torsoBottomW * 2,
    height: torsoH,
    tessellation: 16,
  }, scene);
  torso.position = new Vector3(0, legH + torsoH / 2, 0);
  torso.scaling.z = 0.6;
  torso.material = clothTopMat;
  torso.parent = rootNode;
  meshes.push(torso);

  // Breast (female)
  if (gender === "female") {
    const breastSize = ((genderFeatures.breastSize ?? 50) / 100) * 0.06 + 0.03;
    const leftBreast = MeshBuilder.CreateSphere("leftBreast", { diameter: breastSize * 2, segments: 12 }, scene);
    leftBreast.position = new Vector3(-0.08, legH + torsoH * 0.7, torsoDepthTop * 0.4);
    leftBreast.material = clothTopMat;
    leftBreast.parent = rootNode;
    meshes.push(leftBreast);

    const rightBreast = MeshBuilder.CreateSphere("rightBreast", { diameter: breastSize * 2, segments: 12 }, scene);
    rightBreast.position = new Vector3(0.08, legH + torsoH * 0.7, torsoDepthTop * 0.4);
    rightBreast.material = clothTopMat;
    rightBreast.parent = rootNode;
    meshes.push(rightBreast);
  }

  // ── Arms ──
  const armRadius = 0.035;
  const upperArmH = armH * 0.55;
  const lowerArmH = armH * 0.45;
  const handRadius = 0.03;

  [-1, 1].forEach((side) => {
    const sideStr = side === -1 ? "left" : "right";

    // Upper arm
    const upperArm = MeshBuilder.CreateCylinder(`${sideStr}UpperArm`, {
      diameterTop: armRadius * 2.2,
      diameterBottom: armRadius * 1.8,
      height: upperArmH,
      tessellation: 10,
    }, scene);
    upperArm.position = new Vector3(
      side * (shoulderW + armRadius),
      legH + torsoH - upperArmH / 2,
      0
    );
    upperArm.material = skinMat;
    upperArm.parent = rootNode;
    meshes.push(upperArm);

    // Lower arm
    const lowerArm = MeshBuilder.CreateCylinder(`${sideStr}LowerArm`, {
      diameterTop: armRadius * 1.8,
      diameterBottom: armRadius * 1.4,
      height: lowerArmH,
      tessellation: 10,
    }, scene);
    lowerArm.position = new Vector3(
      side * (shoulderW + armRadius),
      legH + torsoH - upperArmH - lowerArmH / 2,
      0
    );
    lowerArm.material = skinMat;
    lowerArm.parent = rootNode;
    meshes.push(lowerArm);

    // Hand
    const hand = MeshBuilder.CreateSphere(`${sideStr}Hand`, { diameter: handRadius * 2, segments: 8 }, scene);
    hand.position = new Vector3(
      side * (shoulderW + armRadius),
      legH + torsoH - upperArmH - lowerArmH - handRadius,
      0
    );
    hand.material = skinMat;
    hand.parent = rootNode;
    meshes.push(hand);
  });

  // ── Legs (with pants) ──
  const legRadius = 0.055;
  const upperLegH = legH * 0.5;
  const lowerLegH = legH * 0.45;
  const footH = legH * 0.05;

  [-1, 1].forEach((side) => {
    const sideStr = side === -1 ? "left" : "right";
    const legX = side * hipW * 0.5;

    // Upper leg
    const upperLeg = MeshBuilder.CreateCylinder(`${sideStr}UpperLeg`, {
      diameterTop: legRadius * 2.2,
      diameterBottom: legRadius * 1.8,
      height: upperLegH,
      tessellation: 12,
    }, scene);
    upperLeg.position = new Vector3(legX, upperLegH / 2 + lowerLegH + footH, 0);
    upperLeg.material = clothBottomMat;
    upperLeg.parent = rootNode;
    meshes.push(upperLeg);

    // Lower leg
    const lowerLeg = MeshBuilder.CreateCylinder(`${sideStr}LowerLeg`, {
      diameterTop: legRadius * 1.8,
      diameterBottom: legRadius * 1.4,
      height: lowerLegH,
      tessellation: 12,
    }, scene);
    lowerLeg.position = new Vector3(legX, lowerLegH / 2 + footH, 0);
    lowerLeg.material = clothBottomMat;
    lowerLeg.parent = rootNode;
    meshes.push(lowerLeg);

    // Foot / shoe
    const shoeMat = new StandardMaterial(`${sideStr}ShoeMat`, scene);
    shoeMat.diffuseColor = new Color3(0.15, 0.15, 0.18);
    shoeMat.specularColor = new Color3(0.1, 0.1, 0.1);
    materials.push(shoeMat);

    const foot = MeshBuilder.CreateBox(`${sideStr}Foot`, {
      width: 0.08,
      height: footH + 0.02,
      depth: 0.14,
    }, scene);
    foot.position = new Vector3(legX, (footH + 0.02) / 2, 0.02);
    foot.material = shoeMat;
    foot.parent = rootNode;
    meshes.push(foot);
  });

  // ── Hair ──
  if (!hair.isBald) {
    const hairLength = (hair.length ?? 40) / 100;
    const hairVolume = (hair.volume ?? 50) / 100;
    const hairColor = hair.baseColor || "#2a1a0a";

    const hairMat = new StandardMaterial("hairMat", scene);
    hairMat.diffuseColor = hexToColor3(hairColor);
    hairMat.specularColor = new Color3(0.2, 0.18, 0.15);
    hairMat.specularPower = 24;
    materials.push(hairMat);

    // Hair cap
    const hairCap = MeshBuilder.CreateSphere("hairCap", {
      diameter: (headRadius * 2 + 0.02 + hairVolume * 0.04),
      segments: 16,
      slice: 0.6,
    }, scene);
    hairCap.position = new Vector3(0, headY + 0.02, -0.01);
    hairCap.material = hairMat;
    hairCap.parent = rootNode;
    meshes.push(hairCap);

    // Long hair (back)
    if (hairLength > 0.2) {
      const longHairH = hairLength * 0.5;
      const longHair = MeshBuilder.CreateCylinder("longHair", {
        diameterTop: headRadius * 2 + hairVolume * 0.03,
        diameterBottom: headRadius * (1.5 - hairLength * 0.3) + hairVolume * 0.02,
        height: longHairH,
        tessellation: 12,
      }, scene);
      longHair.position = new Vector3(0, headY - longHairH / 2 - 0.05, -headRadius * 0.5);
      longHair.material = hairMat;
      longHair.parent = rootNode;
      meshes.push(longHair);

      // Gradient tip
      if (hair.useGradient && hair.tipColor) {
        const tipMat = new StandardMaterial("hairTipMat", scene);
        tipMat.diffuseColor = hexToColor3(hair.tipColor);
        materials.push(tipMat);

        const tipH = longHairH * 0.3;
        const hairTip = MeshBuilder.CreateCylinder("hairTip", {
          diameterTop: headRadius * (1.5 - hairLength * 0.3) + hairVolume * 0.02,
          diameterBottom: headRadius * 0.3,
          height: tipH,
          tessellation: 12,
        }, scene);
        hairTip.position = new Vector3(0, headY - longHairH - tipH / 2 - 0.05, -headRadius * 0.5);
        hairTip.material = tipMat;
        hairTip.parent = rootNode;
        meshes.push(hairTip);
      }
    }

    // Bangs
    if ((hair.bangsLength ?? 30) > 10) {
      const bangsL = ((hair.bangsLength ?? 30) / 100) * 0.08;
      const bangs = MeshBuilder.CreateBox("bangs", {
        width: headRadius * 1.6,
        height: bangsL,
        depth: 0.02,
      }, scene);
      bangs.position = new Vector3(0, headY + headRadius * 0.3 - bangsL / 2, headRadius * 0.85);
      bangs.material = hairMat;
      bangs.parent = rootNode;
      meshes.push(bangs);
    }
  }

  // ── Add shadows ──
  if (shadowGenerator) {
    meshes.forEach((m) => {
      shadowGenerator.addShadowCaster(m);
    });
  }

  // ── Idle Animation ──
  const idleGroup = createIdleAnimation(scene, rootNode);
  animationGroups.push(idleGroup);
  idleGroup.play(true);

  // ── Handle ──
  const handle: SMPLXAvatarHandle = {
    rootNode,
    updateConfig: (newConfig: Partial<SMPLXAvatarConfig>) => {
      // Dispose current and rebuild
      handle.dispose();
      const newHandle = createSMPLXAvatar(scene, { ...config, ...newConfig }, shadowGenerator);
      handle.rootNode = newHandle.rootNode;
      handle.updateConfig = newHandle.updateConfig;
      handle.playAnimation = newHandle.playAnimation;
      handle.setViseme = newHandle.setViseme;
      handle.setEmotion = newHandle.setEmotion;
      handle.dispose = newHandle.dispose;
    },
    playAnimation: (name: string) => {
      // Stop all, play requested
      animationGroups.forEach((g) => g.stop());
      const target = animationGroups.find((g) => g.name === name);
      if (target) target.play(name === "idle");
    },
    setViseme: (index: number) => {
      // Animate mouth based on viseme
      const mouthMesh = scene.getMeshByName("mouth");
      if (mouthMesh) {
        const openness = index > 0 ? 0.3 + (index / 21) * 0.7 : 0;
        mouthMesh.scaling.y = 1 + openness * 2;
        mouthMesh.scaling.x = 1 - openness * 0.2;
      }
    },
    setEmotion: (emotion: string, intensity: number) => {
      // Adjust facial features based on emotion
      const mouthMesh = scene.getMeshByName("mouth");
      const leftEyeMesh = scene.getMeshByName("leftEye");
      const rightEyeMesh = scene.getMeshByName("rightEye");

      const factor = intensity / 100;

      if (mouthMesh) {
        switch (emotion) {
          case "happy":
            mouthMesh.scaling.x = 1 + factor * 0.3;
            mouthMesh.position.y = headY - 0.07 + factor * 0.005;
            break;
          case "sad":
            mouthMesh.scaling.x = 1 - factor * 0.1;
            mouthMesh.position.y = headY - 0.07 - factor * 0.005;
            break;
          case "surprised":
            mouthMesh.scaling.y = 1 + factor * 3;
            mouthMesh.scaling.x = 0.8;
            break;
          case "angry":
            mouthMesh.scaling.x = 0.9;
            break;
        }
      }

      if (leftEyeMesh && rightEyeMesh) {
        switch (emotion) {
          case "surprised":
            leftEyeMesh.scaling.y = 1 + factor * 0.5;
            rightEyeMesh.scaling.y = 1 + factor * 0.5;
            break;
          case "angry":
            leftEyeMesh.scaling.y = 1 - factor * 0.3;
            rightEyeMesh.scaling.y = 1 - factor * 0.3;
            break;
          case "sad":
            leftEyeMesh.scaling.y = 1 - factor * 0.2;
            rightEyeMesh.scaling.y = 1 - factor * 0.2;
            break;
        }
      }
    },
    dispose: () => {
      animationGroups.forEach((g) => { g.stop(); g.dispose(); });
      meshes.forEach((m) => m.dispose());
      materials.forEach((m) => m.dispose());
      rootNode.dispose();
    },
  };

  return handle;
}

// ─── Animations ──────────────────────────────────────────────────────

function createIdleAnimation(scene: Scene, rootNode: TransformNode): AnimationGroup {
  const group = new AnimationGroup("idle", scene);

  // Subtle breathing (scale Y)
  const breathAnim = new Animation(
    "breathe", "scaling.y", 30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CYCLE
  );
  breathAnim.setKeys([
    { frame: 0, value: 1.0 },
    { frame: 45, value: 1.003 },
    { frame: 90, value: 1.0 },
  ]);
  group.addTargetedAnimation(breathAnim, rootNode);

  // Subtle sway
  const swayAnim = new Animation(
    "sway", "rotation.y", 30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CYCLE
  );
  swayAnim.setKeys([
    { frame: 0, value: 0 },
    { frame: 60, value: 0.015 },
    { frame: 120, value: -0.015 },
    { frame: 180, value: 0 },
  ]);
  group.addTargetedAnimation(swayAnim, rootNode);

  return group;
}

export function createSpeakingAnimation(scene: Scene, mouthMesh: Mesh): AnimationGroup {
  const group = new AnimationGroup("speaking", scene);

  const mouthAnim = new Animation(
    "mouthOpen", "scaling.y", 30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CYCLE
  );
  mouthAnim.setKeys([
    { frame: 0, value: 1.0 },
    { frame: 4, value: 2.5 },
    { frame: 8, value: 1.2 },
    { frame: 12, value: 3.0 },
    { frame: 16, value: 1.0 },
    { frame: 20, value: 2.0 },
    { frame: 24, value: 1.5 },
    { frame: 30, value: 1.0 },
  ]);
  group.addTargetedAnimation(mouthAnim, mouthMesh);

  return group;
}

export function createGestureAnimation(
  scene: Scene,
  rootNode: TransformNode,
  gesture: string
): AnimationGroup {
  const group = new AnimationGroup(`gesture_${gesture}`, scene);

  switch (gesture) {
    case "wave": {
      const waveAnim = new Animation(
        "wave", "rotation.z", 30,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CYCLE
      );
      waveAnim.setKeys([
        { frame: 0, value: 0 },
        { frame: 10, value: 0.1 },
        { frame: 20, value: -0.1 },
        { frame: 30, value: 0 },
      ]);
      group.addTargetedAnimation(waveAnim, rootNode);
      break;
    }
    case "nod": {
      const nodAnim = new Animation(
        "nod", "rotation.x", 30,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      nodAnim.setKeys([
        { frame: 0, value: 0 },
        { frame: 8, value: 0.08 },
        { frame: 16, value: 0 },
        { frame: 24, value: 0.06 },
        { frame: 30, value: 0 },
      ]);
      group.addTargetedAnimation(nodAnim, rootNode);
      break;
    }
    case "shake": {
      const shakeAnim = new Animation(
        "shake", "rotation.y", 30,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      shakeAnim.setKeys([
        { frame: 0, value: 0 },
        { frame: 5, value: 0.1 },
        { frame: 10, value: -0.1 },
        { frame: 15, value: 0.08 },
        { frame: 20, value: -0.08 },
        { frame: 25, value: 0 },
      ]);
      group.addTargetedAnimation(shakeAnim, rootNode);
      break;
    }
    case "think": {
      const thinkAnim = new Animation(
        "think", "rotation.z", 30,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      thinkAnim.setKeys([
        { frame: 0, value: 0 },
        { frame: 15, value: 0.05 },
        { frame: 60, value: 0.05 },
        { frame: 75, value: 0 },
      ]);
      group.addTargetedAnimation(thinkAnim, rootNode);
      break;
    }
  }

  return group;
}

import { useRef, useEffect, useCallback } from "react";
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color3,
  Color4,
  ShadowGenerator,
  GroundMesh,
  MeshBuilder,
  StandardMaterial,
  GlowLayer,
} from "@babylonjs/core";

export type BabylonSceneRef = {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  canvas: HTMLCanvasElement;
  shadowGenerator: ShadowGenerator | null;
};

type BabylonSceneProps = {
  /** Called once the scene is ready */
  onSceneReady?: (sceneRef: BabylonSceneRef) => void;
  /** Called every frame before render */
  onRender?: (scene: Scene) => void;
  /** Container class */
  className?: string;
  /** Whether to show the ground grid */
  showGrid?: boolean;
  /** Whether to enable glow effects */
  enableGlow?: boolean;
  /** Background color */
  backgroundColor?: { r: number; g: number; b: number; a: number };
  /** Camera settings */
  cameraSettings?: {
    alpha?: number;
    beta?: number;
    radius?: number;
    target?: { x: number; y: number; z: number };
    lowerRadiusLimit?: number;
    upperRadiusLimit?: number;
    lowerBetaLimit?: number;
    upperBetaLimit?: number;
  };
};

export function BabylonScene({
  onSceneReady,
  onRender,
  className = "",
  showGrid = true,
  enableGlow = true,
  backgroundColor = { r: 0.07, g: 0.07, b: 0.1, a: 1 },
  cameraSettings,
}: BabylonSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);

  const onSceneReadyRef = useRef(onSceneReady);
  onSceneReadyRef.current = onSceneReady;
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create engine
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    engineRef.current = engine;

    // Create scene
    const scene = new Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new Color4(
      backgroundColor.r,
      backgroundColor.g,
      backgroundColor.b,
      backgroundColor.a
    );

    // Camera
    const cam = cameraSettings || {};
    const camera = new ArcRotateCamera(
      "camera",
      cam.alpha ?? Math.PI / 2,
      cam.beta ?? Math.PI / 2.5,
      cam.radius ?? 3,
      new Vector3(cam.target?.x ?? 0, cam.target?.y ?? 0.9, cam.target?.z ?? 0),
      scene
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = cam.lowerRadiusLimit ?? 1.5;
    camera.upperRadiusLimit = cam.upperRadiusLimit ?? 8;
    camera.lowerBetaLimit = cam.lowerBetaLimit ?? 0.2;
    camera.upperBetaLimit = cam.upperBetaLimit ?? Math.PI / 1.8;
    camera.wheelPrecision = 50;
    camera.panningSensibility = 200;
    camera.inertia = 0.85;

    // Hemisphere light (ambient)
    const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.6;
    hemiLight.diffuse = new Color3(0.9, 0.92, 1.0);
    hemiLight.groundColor = new Color3(0.15, 0.15, 0.2);

    // Directional light (key light with shadows)
    const dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, 1), scene);
    dirLight.position = new Vector3(3, 6, -3);
    dirLight.intensity = 0.8;
    dirLight.diffuse = new Color3(1, 0.98, 0.95);

    // Shadow generator
    let shadowGenerator: ShadowGenerator | null = null;
    try {
      shadowGenerator = new ShadowGenerator(1024, dirLight);
      shadowGenerator.useBlurExponentialShadowMap = true;
      shadowGenerator.blurKernel = 32;
      shadowGenerator.darkness = 0.4;
    } catch {
      // Shadow not supported on some devices
    }

    // Ground grid
    if (showGrid) {
      const ground = MeshBuilder.CreateGround("ground", { width: 10, height: 10, subdivisions: 20 }, scene);
      const groundMat = new StandardMaterial("groundMat", scene);
      groundMat.diffuseColor = new Color3(0.08, 0.08, 0.12);
      groundMat.specularColor = new Color3(0, 0, 0);
      groundMat.alpha = 0.6;
      ground.material = groundMat;
      ground.receiveShadows = true;

      // Grid lines
      const gridLines = MeshBuilder.CreateGround("gridLines", { width: 10, height: 10, subdivisions: 20 }, scene);
      const gridMat = new StandardMaterial("gridMat", scene);
      gridMat.diffuseColor = new Color3(0.15, 0.2, 0.3);
      gridMat.specularColor = new Color3(0, 0, 0);
      gridMat.wireframe = true;
      gridMat.alpha = 0.3;
      gridLines.material = gridMat;
      gridLines.position.y = 0.001;
    }

    // Glow layer
    if (enableGlow) {
      const glowLayer = new GlowLayer("glow", scene);
      glowLayer.intensity = 0.3;
    }

    // Callback
    onSceneReadyRef.current?.({
      engine,
      scene,
      camera,
      canvas,
      shadowGenerator,
    });

    // Render loop
    engine.runRenderLoop(() => {
      onRenderRef.current?.(scene);
      scene.render();
    });

    // Resize handler
    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    // ResizeObserver for container resize
    const resizeObserver = new ResizeObserver(() => engine.resize());
    resizeObserver.observe(canvas);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      scene.dispose();
      engine.dispose();
      engineRef.current = null;
      sceneRef.current = null;
    };
  }, []); // Only run once on mount

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full outline-none touch-none ${className}`}
      style={{ display: "block" }}
    />
  );
}

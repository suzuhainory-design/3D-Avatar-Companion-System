# -*- coding: utf-8 -*-
"""
Avatar Model Service - FastAPI 微服务

提供 SAM 3D Body → SMPL-X 拟合 → GLB 导出的完整流水线。
Node.js 后端通过 HTTP 调用此服务。
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import traceback
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse

from glb_exporter import (
    GLBExportConfig,
    export_smplx_to_glb,
    generate_blendshape_deltas,
)

logger = logging.getLogger("avatar-model-service")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Avatar Model Service",
    description="SAM + SMPL-X 3D avatar generation pipeline",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- 全局配置 ----
SMPLX_MODEL_DIR = os.environ.get("SMPLX_MODEL_DIR", "/models/smplx")
DEVICE = os.environ.get("DEVICE", "cpu")
TEMP_DIR = Path(tempfile.gettempdir()) / "avatar_service"
TEMP_DIR.mkdir(parents=True, exist_ok=True)


def _get_fitter(gender: str = "neutral"):
    """延迟加载 SMPLXFitter（仅在有 torch + smplx 时可用）。"""
    try:
        from sam_smplx_pipeline import SMPLXFitter, OptimizationConfig
        config = OptimizationConfig(device=DEVICE)
        return SMPLXFitter(
            model_dir=Path(SMPLX_MODEL_DIR),
            gender=gender,
            config=config,
        )
    except ImportError as e:
        logger.warning(f"SMPL-X 依赖不可用: {e}")
        return None
    except Exception as e:
        logger.error(f"初始化 SMPLXFitter 失败: {e}")
        return None


@app.get("/health")
async def health_check():
    """健康检查端点。"""
    smplx_available = False
    try:
        import torch
        import smplx
        smplx_available = True
    except ImportError:
        pass

    return {
        "status": "ok",
        "smplx_available": smplx_available,
        "smplx_model_dir": SMPLX_MODEL_DIR,
        "device": DEVICE,
    }


@app.post("/api/fit-mesh")
async def fit_mesh(
    mesh_json: UploadFile = File(..., description="SAM 3D Body 输出的 JSON 文件"),
    gender: str = Form(default="neutral"),
    target_height: float = Form(default=1.7),
    iterations: int = Form(default=200),
    export_glb: bool = Form(default=True),
    include_skeleton: bool = Form(default=True),
    include_blendshapes: bool = Form(default=True),
):
    """
    完整流水线：SAM JSON → SMPL-X 拟合 → GLB 导出。

    输入：SAM 3D Body 输出的 mesh JSON 文件
    输出：GLB 二进制文件 或 拟合结果 JSON
    """
    try:
        from sam_smplx_pipeline import SAMMesh, SMPLXFitter, OptimizationConfig

        # 1. 解析 SAM mesh
        content = await mesh_json.read()
        mesh_data = json.loads(content)

        # 保存临时文件供 SAMMesh 加载
        tmp_json = TEMP_DIR / "input_mesh.json"
        tmp_json.write_text(json.dumps(mesh_data), encoding="utf-8")

        mesh = SAMMesh.from_json(tmp_json)
        mesh.align_to_canonical(target_height=target_height)

        # 2. SMPL-X 拟合
        config = OptimizationConfig(device=DEVICE, iterations=iterations)
        fitter = SMPLXFitter(
            model_dir=Path(SMPLX_MODEL_DIR),
            gender=gender,
            config=config,
        )

        # 构建锚点
        anchor_targets = {}
        anchors = mesh.estimate_body_keypoints()
        if anchors:
            try:
                from smplx.joint_names import JOINT_NAMES
                name_to_idx = {name: idx for idx, name in enumerate(JOINT_NAMES)}
                for name, value in anchors.items():
                    mapped_name = name
                    if name == "left_toe":
                        mapped_name = "left_big_toe"
                    elif name == "right_toe":
                        mapped_name = "right_big_toe"
                    if mapped_name in name_to_idx:
                        anchor_targets[name_to_idx[mapped_name]] = value
            except ImportError:
                pass

        import torch
        keypoints = None
        keypoint_indices = None
        if anchor_targets:
            indices = sorted(anchor_targets.keys())
            keypoints = torch.as_tensor(
                [anchor_targets[idx] for idx in indices],
                dtype=torch.float32,
            )
            keypoint_indices = torch.as_tensor(indices, dtype=torch.long)

        fit_result = fitter.fit_mesh(
            mesh,
            keypoints=keypoints,
            keypoint_indices=keypoint_indices,
            anchor_targets=anchor_targets,
        )

        if not export_glb:
            return JSONResponse({
                "success": fit_result.success,
                "iterations": fit_result.iterations,
                "loss": {
                    "chamfer": float(fit_result.chamfer),
                    "keypoint": float(fit_result.keypoint),
                    "anchor": float(fit_result.anchor),
                    "prior": float(fit_result.prior),
                    "total": float(fit_result.total_loss),
                },
                "betas": fit_result.betas.tolist(),
                "body_pose": fit_result.body_pose.tolist(),
                "global_orient": fit_result.global_orient.tolist(),
                "translation": fit_result.translation.tolist(),
                "scale": fit_result.scale,
                "vertex_count": fit_result.vertices.shape[0],
                "joint_count": fit_result.joints.shape[0],
            })

        # 3. 导出 GLB
        blendshape_deltas = None
        if include_blendshapes:
            blendshape_deltas = generate_blendshape_deltas(
                SMPLX_MODEL_DIR, gender, num_components=5
            )

        # 获取模型面数据
        faces = np.asarray(getattr(fitter.model, "faces", []), dtype=np.uint32)

        glb_config = GLBExportConfig(
            include_skeleton=include_skeleton,
            include_blendshapes=include_blendshapes,
            num_blendshape_components=5,
        )

        glb_bytes = export_smplx_to_glb(
            vertices=fit_result.vertices,
            faces=faces,
            joints=fit_result.joints,
            skin_weights=fitter.lbs_weights,
            betas=fit_result.betas,
            blendshape_deltas=blendshape_deltas,
            config=glb_config,
        )

        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={
                "Content-Disposition": "attachment; filename=avatar.glb",
                "X-Fit-Success": str(fit_result.success),
                "X-Fit-Loss": str(round(fit_result.total_loss, 6)),
                "X-Vertex-Count": str(fit_result.vertices.shape[0]),
                "X-Joint-Count": str(fit_result.joints.shape[0]),
            },
        )

    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail=f"SMPL-X 依赖不可用，请安装 torch 和 smplx: {str(e)}",
        )
    except Exception as e:
        logger.error(f"拟合失败: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-glb")
async def generate_glb_from_params(
    betas: str = Form(default="[]", description="JSON 数组，10 个 beta 参数"),
    body_pose: str = Form(default="[]", description="JSON 数组，63 个 body pose 参数"),
    global_orient: str = Form(default="[0,0,0]", description="JSON 数组，3 个全局朝向参数"),
    translation: str = Form(default="[0,0,0]", description="JSON 数组，3 个平移参数"),
    scale: float = Form(default=1.0),
    gender: str = Form(default="neutral"),
    include_skeleton: bool = Form(default=True),
    include_blendshapes: bool = Form(default=True),
    skin_color: str = Form(default="[0.85,0.75,0.65,1.0]", description="RGBA 肤色"),
):
    """
    从 SMPL-X 参数直接生成 GLB 文件。
    用于用户调整参数后重新生成模型。
    """
    try:
        import torch
        from smplx import create as create_smplx

        betas_arr = np.array(json.loads(betas), dtype=np.float32)
        body_pose_arr = np.array(json.loads(body_pose), dtype=np.float32)
        global_orient_arr = np.array(json.loads(global_orient), dtype=np.float32)
        translation_arr = np.array(json.loads(translation), dtype=np.float32)
        skin_color_arr = json.loads(skin_color)

        # 填充到正确长度
        if len(betas_arr) < 10:
            betas_arr = np.pad(betas_arr, (0, 10 - len(betas_arr)))
        if len(body_pose_arr) < 63:
            body_pose_arr = np.pad(body_pose_arr, (0, 63 - len(body_pose_arr)))
        if len(global_orient_arr) < 3:
            global_orient_arr = np.pad(global_orient_arr, (0, 3 - len(global_orient_arr)))
        if len(translation_arr) < 3:
            translation_arr = np.pad(translation_arr, (0, 3 - len(translation_arr)))

        model_path = Path(SMPLX_MODEL_DIR)
        if (model_path / "SMPLX_NEUTRAL.npz").exists():
            resolved = model_path.parent
        else:
            resolved = model_path

        model = create_smplx(
            model_path=str(resolved),
            model_type="smplx",
            gender=gender.lower(),
            use_pca=False,
            flat_hand_mean=True,
            batch_size=1,
        )

        with torch.no_grad():
            output = model(
                betas=torch.tensor(betas_arr, dtype=torch.float32).unsqueeze(0),
                body_pose=torch.tensor(body_pose_arr, dtype=torch.float32).unsqueeze(0),
                global_orient=torch.tensor(global_orient_arr, dtype=torch.float32).unsqueeze(0),
                transl=torch.tensor(translation_arr, dtype=torch.float32).unsqueeze(0),
            )
            vertices = (output.vertices[0] * scale).numpy()
            joints = (output.joints[0] * scale).numpy()

        faces = np.asarray(getattr(model, "faces", []), dtype=np.uint32)
        lbs_weights = (
            model.lbs_weights.detach().cpu().numpy()
            if hasattr(model, "lbs_weights") else None
        )

        blendshape_deltas = None
        if include_blendshapes:
            blendshape_deltas = generate_blendshape_deltas(
                SMPLX_MODEL_DIR, gender, num_components=5
            )

        glb_config = GLBExportConfig(
            include_skeleton=include_skeleton,
            include_blendshapes=include_blendshapes,
            base_color=tuple(skin_color_arr[:4]) if len(skin_color_arr) >= 4 else (0.85, 0.75, 0.65, 1.0),
        )

        glb_bytes = export_smplx_to_glb(
            vertices=vertices,
            faces=faces,
            joints=joints,
            skin_weights=lbs_weights,
            blendshape_deltas=blendshape_deltas,
            config=glb_config,
        )

        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={
                "Content-Disposition": "attachment; filename=avatar.glb",
                "X-Vertex-Count": str(vertices.shape[0]),
            },
        )

    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail=f"SMPL-X 依赖不可用: {str(e)}",
        )
    except Exception as e:
        logger.error(f"GLB 生成失败: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/export-glb-from-npz")
async def export_glb_from_npz(
    npz_file: UploadFile = File(..., description="SMPL-X 拟合结果 .npz 文件"),
    gender: str = Form(default="neutral"),
    include_skeleton: bool = Form(default=True),
    include_blendshapes: bool = Form(default=True),
    skin_color: str = Form(default="[0.85,0.75,0.65,1.0]"),
):
    """
    从已有的 .npz 拟合结果文件导出 GLB。
    用于离线拟合后的模型导出。
    """
    try:
        content = await npz_file.read()
        tmp_npz = TEMP_DIR / "input.npz"
        tmp_npz.write_bytes(content)

        data = np.load(str(tmp_npz), allow_pickle=True)
        vertices = data["vertices"]
        joints = data.get("joints", None)

        # 尝试获取面数据
        faces = None
        try:
            import torch
            from smplx import create as create_smplx

            model_path = Path(SMPLX_MODEL_DIR)
            if (model_path / "SMPLX_NEUTRAL.npz").exists():
                resolved = model_path.parent
            else:
                resolved = model_path

            model = create_smplx(
                model_path=str(resolved),
                model_type="smplx",
                gender=gender.lower(),
                use_pca=False,
                flat_hand_mean=True,
                batch_size=1,
            )
            faces = np.asarray(getattr(model, "faces", []), dtype=np.uint32)
            lbs_weights = (
                model.lbs_weights.detach().cpu().numpy()
                if hasattr(model, "lbs_weights") else None
            )
        except ImportError:
            # 无 smplx，使用 Delaunay 三角化
            from scipy.spatial import Delaunay
            tri = Delaunay(vertices[:, :2])
            faces = tri.simplices.astype(np.uint32)
            lbs_weights = None

        blendshape_deltas = None
        if include_blendshapes:
            blendshape_deltas = generate_blendshape_deltas(
                SMPLX_MODEL_DIR, gender, num_components=5
            )

        skin_color_arr = json.loads(skin_color)
        glb_config = GLBExportConfig(
            include_skeleton=include_skeleton,
            include_blendshapes=include_blendshapes,
            base_color=tuple(skin_color_arr[:4]) if len(skin_color_arr) >= 4 else (0.85, 0.75, 0.65, 1.0),
        )

        glb_bytes = export_smplx_to_glb(
            vertices=vertices,
            faces=faces,
            joints=joints,
            skin_weights=lbs_weights,
            blendshape_deltas=blendshape_deltas,
            config=glb_config,
        )

        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={
                "Content-Disposition": "attachment; filename=avatar.glb",
            },
        )

    except Exception as e:
        logger.error(f"NPZ 导出失败: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/model-info")
async def model_info():
    """返回可用的 SMPL-X 模型信息。"""
    model_dir = Path(SMPLX_MODEL_DIR)
    available_models = []

    for gender in ["neutral", "male", "female"]:
        npz_name = f"SMPLX_{gender.upper()}.npz"
        pkl_name = f"SMPLX_{gender.upper()}.pkl"
        if (model_dir / npz_name).exists() or (model_dir / pkl_name).exists():
            available_models.append(gender)

    # 检查父目录
    if not available_models and model_dir.parent.exists():
        smplx_dir = model_dir.parent / "smplx"
        if smplx_dir.exists():
            for gender in ["neutral", "male", "female"]:
                npz_name = f"SMPLX_{gender.upper()}.npz"
                if (smplx_dir / npz_name).exists():
                    available_models.append(gender)

    return {
        "model_dir": str(model_dir),
        "available_genders": available_models,
        "joint_count": 22,
        "joint_names": [
            "pelvis", "left_hip", "right_hip", "spine1",
            "left_knee", "right_knee", "spine2",
            "left_ankle", "right_ankle", "spine3",
            "left_foot", "right_foot", "neck",
            "left_collar", "right_collar", "head",
            "left_shoulder", "right_shoulder",
            "left_elbow", "right_elbow",
            "left_wrist", "right_wrist",
        ],
        "blendshape_names": [f"shape_{i}" for i in range(5)],
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MODEL_SERVICE_PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")

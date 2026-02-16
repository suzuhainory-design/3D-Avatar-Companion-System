# -*- coding: utf-8 -*-
"""
GLB Exporter: 将 SMPL-X 拟合结果导出为 Babylon.js 可加载的 .glb 文件。

支持功能：
- 网格几何体（顶点 + 面）
- 骨骼系统（SMPL-X 关节层级）
- 皮肤权重（LBS weights）
- BlendShapes（通过 betas 参数生成体型变体）
- 基础材质（PBR）
"""
from __future__ import annotations

import json
import struct
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np


# SMPL-X 骨骼层级定义（简化版，覆盖主要关节）
SMPLX_JOINT_HIERARCHY = {
    0: -1,   # pelvis (root)
    1: 0,    # left_hip
    2: 0,    # right_hip
    3: 0,    # spine1
    4: 1,    # left_knee
    5: 2,    # right_knee
    6: 3,    # spine2
    7: 4,    # left_ankle
    8: 5,    # right_ankle
    9: 6,    # spine3
    10: 7,   # left_foot
    11: 8,   # right_foot
    12: 9,   # neck
    13: 9,   # left_collar
    14: 9,   # right_collar
    15: 12,  # head
    16: 13,  # left_shoulder
    17: 14,  # right_shoulder
    18: 16,  # left_elbow
    19: 17,  # right_elbow
    20: 18,  # left_wrist
    21: 19,  # right_wrist
}

SMPLX_JOINT_NAMES = [
    "pelvis", "left_hip", "right_hip", "spine1",
    "left_knee", "right_knee", "spine2",
    "left_ankle", "right_ankle", "spine3",
    "left_foot", "right_foot", "neck",
    "left_collar", "right_collar", "head",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
]

NUM_JOINTS = len(SMPLX_JOINT_NAMES)


@dataclass
class GLBExportConfig:
    """GLB 导出配置。"""
    include_skeleton: bool = True
    include_blendshapes: bool = True
    num_blendshape_components: int = 5
    base_color: Tuple[float, float, float, float] = (0.85, 0.75, 0.65, 1.0)
    metallic_factor: float = 0.0
    roughness_factor: float = 0.7


def _pad_to_4(data: bytes) -> bytes:
    """将字节数据填充到 4 字节对齐。"""
    remainder = len(data) % 4
    if remainder > 0:
        data += b'\x00' * (4 - remainder)
    return data


def _compute_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """计算每个顶点的法线。"""
    normals = np.zeros_like(vertices)
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(face_normals, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    face_normals = face_normals / norms
    for i in range(3):
        np.add.at(normals, faces[:, i], face_normals)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    normals = normals / norms
    return normals.astype(np.float32)


def export_smplx_to_glb(
    vertices: np.ndarray,
    faces: np.ndarray,
    joints: Optional[np.ndarray] = None,
    skin_weights: Optional[np.ndarray] = None,
    betas: Optional[np.ndarray] = None,
    blendshape_deltas: Optional[List[np.ndarray]] = None,
    config: Optional[GLBExportConfig] = None,
    output_path: Optional[Path] = None,
) -> bytes:
    """
    将 SMPL-X 拟合结果导出为 GLB 二进制格式。

    参数:
        vertices: [N, 3] 顶点坐标
        faces: [F, 3] 三角形面索引
        joints: [J, 3] 关节点坐标（可选，用于骨骼）
        skin_weights: [N, J] 皮肤权重（可选）
        betas: [10] 体型参数（可选，用于生成 BlendShapes）
        blendshape_deltas: 每个 BlendShape 的顶点偏移列表（可选）
        config: 导出配置
        output_path: 输出文件路径（可选，不提供则返回 bytes）

    返回:
        GLB 文件的二进制数据
    """
    cfg = config or GLBExportConfig()
    vertices = np.asarray(vertices, dtype=np.float32)
    faces = np.asarray(faces, dtype=np.uint32)
    normals = _compute_normals(vertices, faces)

    # ---- 构建二进制缓冲区 ----
    buffer_data = io.BytesIO()
    accessors = []
    buffer_views = []

    def _add_accessor(
        data: np.ndarray,
        component_type: int,
        accessor_type: str,
        target: Optional[int] = None,
        normalized: bool = False,
    ) -> int:
        """添加一个 accessor 并返回其索引。"""
        raw = data.tobytes()
        offset = buffer_data.tell()
        # 确保 4 字节对齐
        pad = (4 - offset % 4) % 4
        if pad > 0:
            buffer_data.write(b'\x00' * pad)
            offset += pad

        buffer_data.write(raw)

        bv = {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(raw),
        }
        if target is not None:
            bv["target"] = target
        bv_idx = len(buffer_views)
        buffer_views.append(bv)

        acc = {
            "bufferView": bv_idx,
            "componentType": component_type,
            "count": data.shape[0],
            "type": accessor_type,
        }
        if normalized:
            acc["normalized"] = True

        # 计算 min/max
        if accessor_type == "VEC3":
            acc["min"] = data.min(axis=0).tolist()
            acc["max"] = data.max(axis=0).tolist()
        elif accessor_type == "VEC4":
            acc["min"] = data.min(axis=0).tolist()
            acc["max"] = data.max(axis=0).tolist()
        elif accessor_type == "SCALAR":
            acc["min"] = [float(data.min())]
            acc["max"] = [float(data.max())]

        acc_idx = len(accessors)
        accessors.append(acc)
        return acc_idx

    # 顶点位置
    pos_acc = _add_accessor(vertices, 5126, "VEC3", target=34962)
    # 顶点法线
    norm_acc = _add_accessor(normals, 5126, "VEC3", target=34962)
    # 面索引
    idx_acc = _add_accessor(faces.flatten(), 5125, "SCALAR", target=34963)

    # ---- 构建 glTF JSON ----
    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "avatar-model-service/sam-smplx-pipeline",
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [],
        "meshes": [],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorFactor": list(cfg.base_color),
                "metallicFactor": cfg.metallic_factor,
                "roughnessFactor": cfg.roughness_factor,
            },
            "doubleSided": True,
            "name": "skin_material",
        }],
        "accessors": [],
        "bufferViews": [],
        "buffers": [],
    }

    # 网格 primitive
    primitive = {
        "attributes": {
            "POSITION": pos_acc,
            "NORMAL": norm_acc,
        },
        "indices": idx_acc,
        "material": 0,
        "mode": 4,  # TRIANGLES
    }

    # ---- BlendShapes / Morph Targets ----
    morph_targets = []
    target_names = []

    if cfg.include_blendshapes and blendshape_deltas:
        for i, delta in enumerate(blendshape_deltas):
            delta = np.asarray(delta, dtype=np.float32)
            delta_normals = np.zeros_like(delta, dtype=np.float32)
            t_pos = _add_accessor(delta, 5126, "VEC3")
            t_norm = _add_accessor(delta_normals, 5126, "VEC3")
            morph_targets.append({"POSITION": t_pos, "NORMAL": t_norm})
            target_names.append(f"shape_{i}")

    if morph_targets:
        primitive["targets"] = morph_targets

    mesh_def = {
        "primitives": [primitive],
        "name": "smplx_body",
    }
    if target_names:
        mesh_def["extras"] = {"targetNames": target_names}
        mesh_def["weights"] = [0.0] * len(target_names)

    gltf["meshes"].append(mesh_def)

    # ---- 骨骼系统 ----
    skin_def = None
    if cfg.include_skeleton and joints is not None and joints.shape[0] >= NUM_JOINTS:
        joint_positions = joints[:NUM_JOINTS].astype(np.float32)

        # 创建关节节点
        joint_node_start = 1  # 节点 0 是网格根节点
        joint_nodes = []
        for j in range(NUM_JOINTS):
            parent = SMPLX_JOINT_HIERARCHY.get(j, -1)
            if parent == -1:
                # 根关节：使用世界坐标
                translation = joint_positions[j].tolist()
            else:
                # 子关节：使用相对于父关节的偏移
                translation = (joint_positions[j] - joint_positions[parent]).tolist()

            node = {
                "name": SMPLX_JOINT_NAMES[j],
                "translation": translation,
                "children": [],
            }
            joint_nodes.append(node)

        # 建立父子关系
        for j in range(NUM_JOINTS):
            parent = SMPLX_JOINT_HIERARCHY.get(j, -1)
            if parent >= 0:
                joint_nodes[parent]["children"].append(joint_node_start + j)

        # 清理空 children
        for node in joint_nodes:
            if not node["children"]:
                del node["children"]

        # 计算 inverse bind matrices
        ibm = np.zeros((NUM_JOINTS, 16), dtype=np.float32)
        for j in range(NUM_JOINTS):
            # 简化的 IBM：仅包含平移的逆
            pos = joint_positions[j]
            ibm[j] = [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                -pos[0], -pos[1], -pos[2], 1,
            ]

        ibm_acc = _add_accessor(
            ibm.reshape(-1, 16).astype(np.float32).reshape(-1, 4),
            5126, "MAT4"
        )
        # 修正：MAT4 accessor 的 count 应该是矩阵数量
        accessors[ibm_acc]["count"] = NUM_JOINTS
        accessors[ibm_acc]["type"] = "MAT4"
        if "min" in accessors[ibm_acc]:
            del accessors[ibm_acc]["min"]
        if "max" in accessors[ibm_acc]:
            del accessors[ibm_acc]["max"]

        # 皮肤权重
        if skin_weights is not None and skin_weights.shape[1] >= NUM_JOINTS:
            sw = skin_weights[:, :NUM_JOINTS].astype(np.float32)
            # 每个顶点取影响最大的 4 个关节
            top4_indices = np.argsort(-sw, axis=1)[:, :4].astype(np.uint16)
            top4_weights = np.zeros((len(sw), 4), dtype=np.float32)
            for i in range(4):
                top4_weights[:, i] = sw[np.arange(len(sw)), top4_indices[:, i]]
            # 归一化权重
            weight_sums = top4_weights.sum(axis=1, keepdims=True)
            weight_sums[weight_sums == 0] = 1.0
            top4_weights /= weight_sums

            joints_acc = _add_accessor(top4_indices, 5123, "VEC4", target=34962)
            weights_acc = _add_accessor(top4_weights, 5126, "VEC4", target=34962)

            primitive["attributes"]["JOINTS_0"] = joints_acc
            primitive["attributes"]["WEIGHTS_0"] = weights_acc

        # 添加关节节点到 gltf
        for node in joint_nodes:
            gltf["nodes"].append(node)

        skin_def = {
            "inverseBindMatrices": ibm_acc,
            "joints": list(range(joint_node_start, joint_node_start + NUM_JOINTS)),
            "skeleton": joint_node_start,
            "name": "smplx_skeleton",
        }
        gltf["skins"] = [skin_def]

        # 根节点
        root_node = {
            "mesh": 0,
            "name": "avatar_root",
            "children": [joint_node_start],  # pelvis 是根关节
        }
        if skin_def:
            root_node["skin"] = 0
        gltf["nodes"].insert(0, root_node)

        # 场景根节点也包含骨骼根
        gltf["scenes"][0]["nodes"] = [0]
    else:
        # 无骨骼：简单的网格节点
        gltf["nodes"].append({
            "mesh": 0,
            "name": "avatar_root",
        })

    # ---- 填充 accessors / bufferViews / buffers ----
    bin_data = buffer_data.getvalue()
    bin_data = _pad_to_4(bin_data)

    gltf["accessors"] = accessors
    gltf["bufferViews"] = buffer_views
    gltf["buffers"] = [{"byteLength": len(bin_data)}]

    # ---- 组装 GLB ----
    json_str = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False)
    json_bytes = json_str.encode('utf-8')
    # GLB spec requires JSON chunk to be padded with spaces (0x20), not null bytes
    remainder = len(json_bytes) % 4
    if remainder > 0:
        json_bytes += b' ' * (4 - remainder)

    # GLB header
    glb_length = 12 + 8 + len(json_bytes) + 8 + len(bin_data)
    header = struct.pack('<III', 0x46546C67, 2, glb_length)  # magic, version, length

    # JSON chunk
    json_chunk_header = struct.pack('<II', len(json_bytes), 0x4E4F534A)  # length, type=JSON

    # BIN chunk
    bin_chunk_header = struct.pack('<II', len(bin_data), 0x004E4942)  # length, type=BIN

    glb_bytes = header + json_chunk_header + json_bytes + bin_chunk_header + bin_data

    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(glb_bytes)

    return glb_bytes


def generate_blendshape_deltas(
    model_dir: str,
    gender: str = "neutral",
    num_components: int = 5,
    delta_scale: float = 2.0,
) -> Optional[List[np.ndarray]]:
    """
    使用 SMPL-X 模型生成 BlendShape 变体（基于 betas 参数）。
    每个 BlendShape 对应一个 beta 分量的正向偏移。

    如果 smplx/torch 不可用，返回 None。
    """
    try:
        import torch
        from smplx import create as create_smplx
    except ImportError:
        return None

    model_path = Path(model_dir)
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
        # 基础姿态
        base_output = model()
        base_verts = base_output.vertices[0].numpy()

        deltas = []
        for i in range(min(num_components, 10)):
            betas = torch.zeros(1, 10)
            betas[0, i] = delta_scale
            output = model(betas=betas)
            verts = output.vertices[0].numpy()
            delta = (verts - base_verts).astype(np.float32)
            deltas.append(delta)

    return deltas

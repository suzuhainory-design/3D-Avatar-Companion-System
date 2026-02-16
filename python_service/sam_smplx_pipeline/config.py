# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Tuple


def _infer_device(preferred: str = "cuda") -> str:
    """
    检测当前 PyTorch 是否可用 GPU，失败则回退 CPU。
    该函数在导入阶段执行，避免 torch 尚未安装时报错。
    """
    try:
        import torch  # type: ignore

        if preferred == "cuda" and torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


@dataclass
class OptimizationConfig:
    """SMPL-X 拟合阶段的超参。"""

    device: str = _infer_device()
    iterations: int = 200
    lr: float = 5e-3
    chamfer_weight: float = 1.0
    keypoint_weight: float = 20.0
    prior_weight: float = 0.1
    joint_weight: float = 5.0
    shape_reg: float = 5e-3
    pose_reg: float = 1e-3
    sample_vertices: int = 4000
    chunk_size: int = 2048
    target_height_m: float = 1.7
    axis_permutation: Tuple[int, int, int] = (0, 1, 2)
    axis_sign: Tuple[int, int, int] = (1, 1, 1)
    resume_from: Optional[Path] = None
    # Include pelvis/head/knees to stabilize pose when only geometry is available.
    anchor_joint_names: Tuple[str, ...] = (
        "pelvis",
        "head",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
        "left_foot",
        "right_foot",
        "left_big_toe",
        "right_big_toe",
    )
    anchor_weight: float = 20.0


@dataclass
class WeightTransferConfig:
    """SMPL-X 皮肤权重向 SAM 网格迁移的配置。"""

    neighbors: int = 4
    falloff: float = 0.08
    laplacian_iters: int = 2
    laplacian_lambda: float = 0.15
    save_npz: bool = True


@dataclass
class BindingConfig:
    """总控配置，包含资源路径与子模块配置。"""

    sam_mesh_path: Path
    smplx_model_dir: Path
    output_dir: Path
    gender: str = "NEUTRAL"
    keypoints_path: Optional[Path] = None
    optimization: OptimizationConfig = field(default_factory=OptimizationConfig)
    weight_transfer: WeightTransferConfig = field(default_factory=WeightTransferConfig)

    def resolved(self) -> "BindingConfig":
        """归一化路径，便于下游脚本使用。"""
        self.sam_mesh_path = self.sam_mesh_path.expanduser().resolve()
        self.smplx_model_dir = self.smplx_model_dir.expanduser().resolve()
        self.output_dir = self.output_dir.expanduser().resolve()
        if self.keypoints_path is not None:
            self.keypoints_path = self.keypoints_path.expanduser().resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.gender = self.gender.upper()
        return self

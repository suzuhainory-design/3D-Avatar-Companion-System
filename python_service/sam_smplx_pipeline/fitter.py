# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np
import torch
from smplx import create as create_smplx
from smplx.joint_names import JOINT_NAMES

from .config import OptimizationConfig
from .sam_mesh import SAMMesh

JOINT_NAME_TO_INDEX = {name: idx for idx, name in enumerate(JOINT_NAMES)}


@dataclass
class FittingResult:
    betas: np.ndarray
    body_pose: np.ndarray
    global_orient: np.ndarray
    translation: np.ndarray
    scale: float
    vertices: np.ndarray
    joints: np.ndarray
    chamfer: float
    keypoint: float
    anchor: float
    prior: float
    total_loss: float
    iterations: int
    success: bool


def _chunked_chamfer(
    a: torch.Tensor,
    b: torch.Tensor,
    chunk: int = 2048,
) -> torch.Tensor:
    """
    计算 a / b 两个点集的近似 Chamfer Distance，按 chunk 划分避免显存爆炸。
    """
    if a.ndim != 2 or b.ndim != 2:
        raise ValueError("Chamfer 输入需要为 [N,3] / [M,3]")
    total = torch.zeros(1, device=a.device)

    def _min_distance(src: torch.Tensor, dst: torch.Tensor) -> torch.Tensor:
        mins = []
        for start in range(0, len(src), chunk):
            chunk_src = src[start : start + chunk].unsqueeze(0)
            dists = torch.cdist(chunk_src, dst.unsqueeze(0))
            mins.append(dists.min(dim=-1).values)
        return torch.cat(mins, dim=1).mean()

    total += _min_distance(a, b)
    total += _min_distance(b, a)
    return total * 0.5


class SMPLXFitter:
    """将 SAM 点云拟合到 SMPL-X 的轻量实现。"""

    def __init__(
        self,
        model_dir: Path,
        gender: str,
        config: Optional[OptimizationConfig] = None,
    ) -> None:
        self.config = config or OptimizationConfig()
        self.device = torch.device(self.config.device)
        gender_key = gender.lower()
        if gender_key not in {"male", "female", "neutral"}:
            gender_key = "neutral"

        model_dir = Path(model_dir)
        # smplx 官方实现要求传入包含 {model_type}/{gender} 的根目录。
        if (model_dir / "SMPLX_NEUTRAL.npz").exists():
            resolved_model_path = model_dir.parent
        else:
            resolved_model_path = model_dir

        self.model = create_smplx(
            model_path=str(resolved_model_path),
            model_type="smplx",
            gender=gender_key,
            use_pca=False,
            flat_hand_mean=True,
            create_left_hand_pose=True,
            create_right_hand_pose=True,
            create_expression=True,
            create_jaw_pose=True,
            create_leye_pose=True,
            create_reye_pose=True,
            batch_size=1,
        ).to(self.device)

        self._lbs_weights = (
            self.model.lbs_weights.detach().cpu().numpy()
            if hasattr(self.model, "lbs_weights")
            else None
        )
        anchor_indices = [
            JOINT_NAME_TO_INDEX[name]
            for name in self.config.anchor_joint_names
            if name in JOINT_NAME_TO_INDEX
        ]
        self.anchor_indices = torch.as_tensor(
            anchor_indices, dtype=torch.long, device=self.device
        )

    @property
    def lbs_weights(self) -> Optional[np.ndarray]:
        return self._lbs_weights

    def fit_mesh(
        self,
        sam_mesh: SAMMesh,
        keypoints: Optional[torch.Tensor] = None,
        keypoint_indices: Optional[torch.Tensor] = None,
        anchor_targets: Optional[Dict[int, np.ndarray]] = None,
    ) -> FittingResult:
        cfg = self.config
        sam_points = sam_mesh.to_tensor(
            device=self.device,
            sample_vertices=cfg.sample_vertices,
            normalized=True,
        )

        betas = torch.zeros(10, device=self.device, requires_grad=True)
        body_pose = torch.zeros(63, device=self.device, requires_grad=True)
        global_orient = torch.zeros(3, device=self.device, requires_grad=True)
        translation = torch.zeros(3, device=self.device, requires_grad=True)
        log_scale = torch.zeros(1, device=self.device, requires_grad=True)

        parameters = [betas, body_pose, global_orient, translation, log_scale]
        optimizer = torch.optim.Adam(parameters, lr=cfg.lr)

        chamfer_value = torch.tensor(0.0, device=self.device)
        keypoint_value = torch.tensor(0.0, device=self.device)
        prior_value = torch.tensor(0.0, device=self.device)
        anchor_value = torch.tensor(0.0, device=self.device)

        preset_anchor_targets = None
        if anchor_targets:
            preset_anchor_targets = {
                int(idx): torch.as_tensor(
                    value, dtype=torch.float32, device=self.device
                )
                for idx, value in anchor_targets.items()
            }

        for iteration in range(1, cfg.iterations + 1):
            optimizer.zero_grad()

            model_output = self.model(
                betas=betas.unsqueeze(0),
                body_pose=body_pose.unsqueeze(0),
                global_orient=global_orient.unsqueeze(0),
                transl=translation.unsqueeze(0),
            )
            smpl_vertices = model_output.vertices[0] * torch.exp(log_scale)
            smpl_joints = model_output.joints[0] * torch.exp(log_scale)

            chamfer_value = _chunked_chamfer(
                smpl_vertices, sam_points, chunk=cfg.chunk_size
            )

            pose_reg = torch.mean(body_pose ** 2)
            shape_reg = torch.mean(betas ** 2)
            keypoint_value = torch.tensor(0.0, device=self.device)
            anchor_value = torch.tensor(0.0, device=self.device)

            if keypoints is not None:
                if keypoint_indices is None:
                    idx = torch.arange(len(keypoints), device=self.device)
                else:
                    idx = keypoint_indices.to(self.device)
                pred = smpl_joints.index_select(0, idx)
                keypoint_value = torch.mean(
                    (pred - keypoints.to(self.device)) ** 2
                )

            if (
                self.anchor_indices.numel() > 0
                and cfg.anchor_weight > 0.0
            ):
                anchor_terms = []
                for idx in self.anchor_indices.tolist():
                    joint_vec = smpl_joints[idx]
                    if preset_anchor_targets and idx in preset_anchor_targets:
                        target = preset_anchor_targets[idx]
                        anchor_terms.append(torch.mean((joint_vec - target) ** 2))
                    elif sam_points.shape[0] > 0:
                        dists = torch.cdist(
                            joint_vec.unsqueeze(0).unsqueeze(0),
                            sam_points.unsqueeze(0),
                        )
                        nearest = torch.argmin(dists, dim=-1).squeeze()
                        target = sam_points[nearest]
                        anchor_terms.append(torch.mean((joint_vec - target) ** 2))
                if anchor_terms:
                    anchor_value = torch.stack(anchor_terms).mean()

            prior_value = cfg.pose_reg * pose_reg + cfg.shape_reg * shape_reg
            loss = (
                cfg.chamfer_weight * chamfer_value
                + cfg.keypoint_weight * keypoint_value
                + cfg.anchor_weight * anchor_value
                + cfg.prior_weight * prior_value
            )
            loss.backward()
            optimizer.step()

        with torch.no_grad():
            final_output = self.model(
                betas=betas.unsqueeze(0),
                body_pose=body_pose.unsqueeze(0),
                global_orient=global_orient.unsqueeze(0),
                transl=translation.unsqueeze(0),
            )
            smpl_vertices = (
                final_output.vertices[0] * torch.exp(log_scale)
            ).detach()
            smpl_joints = (
                final_output.joints[0] * torch.exp(log_scale)
            ).detach()
        if (
            self.anchor_indices.numel() > 0
            and cfg.anchor_weight > 0.0
        ):
            anchor_terms = []
            for idx in self.anchor_indices.tolist():
                joint_vec = smpl_joints[idx]
                if preset_anchor_targets and idx in preset_anchor_targets:
                    target = preset_anchor_targets[idx]
                    anchor_terms.append(torch.mean((joint_vec - target) ** 2))
                elif sam_points.shape[0] > 0:
                    dists = torch.cdist(
                        joint_vec.unsqueeze(0).unsqueeze(0),
                        sam_points.unsqueeze(0),
                    )
                    nearest = torch.argmin(dists, dim=-1).squeeze()
                    target = sam_points[nearest]
                    anchor_terms.append(torch.mean((joint_vec - target) ** 2))
            if anchor_terms:
                anchor_value = torch.stack(anchor_terms).mean().detach()

        return FittingResult(
            betas=betas.detach().cpu().numpy(),
            body_pose=body_pose.detach().cpu().numpy(),
            global_orient=global_orient.detach().cpu().numpy(),
            translation=translation.detach().cpu().numpy(),
            scale=float(torch.exp(log_scale).item()),
            vertices=smpl_vertices.cpu().numpy(),
            joints=smpl_joints.cpu().numpy(),
            chamfer=float(chamfer_value.detach().cpu().item()),
            keypoint=float(keypoint_value.detach().cpu().item()),
            anchor=float(anchor_value.detach().cpu().item()),
            prior=float(prior_value.detach().cpu().item()),
            total_loss=float(
                cfg.chamfer_weight * chamfer_value.detach().cpu().item()
                + cfg.keypoint_weight * keypoint_value.detach().cpu().item()
                + cfg.anchor_weight * anchor_value.detach().cpu().item()
                + cfg.prior_weight * prior_value.detach().cpu().item()
            ),
            iterations=cfg.iterations,
            success=True,
        )

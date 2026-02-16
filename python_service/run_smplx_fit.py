# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict

repo_root = Path(__file__).resolve().parent
repo_parent = repo_root.parent
if str(repo_parent) not in sys.path:
    sys.path.insert(0, str(repo_parent))

import numpy as np
import torch
from smplx.joint_names import JOINT_NAMES

from sam_smplx_pipeline import (
    OptimizationConfig,
    SAMMesh,
    SMPLXFitter,
    WeightTransferConfig,
    transfer_weights,
)


def _build_anchor_targets(mesh: SAMMesh) -> Dict[int, np.ndarray]:
    anchors = mesh.estimate_body_keypoints()
    if not anchors:
        return {}

    name_to_idx = {name: idx for idx, name in enumerate(JOINT_NAMES)}
    resolved: Dict[int, np.ndarray] = {}
    for name, value in anchors.items():
        # Map SAM toe names to SMPL-X big toe joints.
        if name == "left_toe":
            name = "left_big_toe"
        elif name == "right_toe":
            name = "right_big_toe"
        if name in name_to_idx:
            resolved[name_to_idx[name]] = value
    return resolved


def _build_keypoints(anchor_targets: Dict[int, np.ndarray]):
    if not anchor_targets:
        return None, None
    indices = sorted(anchor_targets.keys())
    if not indices:
        return None, None
    keypoints = torch.as_tensor(
        [anchor_targets[idx] for idx in indices],
        dtype=torch.float32,
    )
    keypoint_indices = torch.as_tensor(indices, dtype=torch.long)
    return keypoints, keypoint_indices


def _parse_triplet(value: str, name: str) -> tuple[int, int, int]:
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if len(parts) != 3:
        raise ValueError(f"{name} 需要 3 个整数，例如 0,2,1")
    try:
        return tuple(int(part) for part in parts)  # type: ignore[return-value]
    except ValueError as exc:  # pragma: no cover
        raise ValueError(f"{name} 需要整数，例如 0,2,1") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit SMPL-X to SAM mesh JSON.")
    parser.add_argument("--input_json", required=True, type=str)
    parser.add_argument("--smplx_model_dir", required=True, type=str)
    parser.add_argument("--output_dir", required=True, type=str)
    parser.add_argument("--gender", default="neutral", type=str)
    parser.add_argument("--iterations", default=200, type=int)
    parser.add_argument("--device", default="cuda", type=str)
    parser.add_argument("--target_height", default=1.7, type=float)
    parser.add_argument(
        "--axis_permutation",
        default="0,1,2",
        type=str,
        help="Axis permutation applied before normalization, e.g. 0,2,1",
    )
    parser.add_argument(
        "--axis_sign",
        default="1,1,1",
        type=str,
        help="Axis sign applied before normalization, e.g. 1,-1,1",
    )
    parser.add_argument(
        "--anchor_names",
        default="",
        type=str,
        help="Comma-separated SMPL-X joint names to use as anchors.",
    )
    parser.add_argument(
        "--anchor_weight",
        default=None,
        type=float,
        help="Override anchor weight (0 disables anchor loss).",
    )
    parser.add_argument(
        "--keypoint_weight",
        default=None,
        type=float,
        help="Override keypoint weight (0 disables keypoint loss).",
    )
    parser.add_argument("--export_obj", action="store_true", default=False)
    parser.add_argument("--export_ply", action="store_true", default=False)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    mesh = SAMMesh.from_json(Path(args.input_json))
    axis_perm = _parse_triplet(args.axis_permutation, "axis_permutation")
    axis_sign = _parse_triplet(args.axis_sign, "axis_sign")
    mesh.align_to_canonical(
        target_height=args.target_height,
        axis_permutation=axis_perm,
        axis_sign=axis_sign,
    )

    anchor_targets = _build_anchor_targets(mesh)
    opt_cfg = OptimizationConfig(device=args.device, iterations=args.iterations)
    if args.anchor_names:
        names = tuple(
            name.strip()
            for name in args.anchor_names.split(",")
            if name.strip()
        )
        if names:
            opt_cfg.anchor_joint_names = names
    if args.anchor_weight is not None:
        opt_cfg.anchor_weight = args.anchor_weight
    if args.keypoint_weight is not None:
        opt_cfg.keypoint_weight = args.keypoint_weight

    fitter = SMPLXFitter(
        model_dir=Path(args.smplx_model_dir),
        gender=args.gender,
        config=opt_cfg,
    )

    keypoints, keypoint_indices = _build_keypoints(anchor_targets)
    fit_result = fitter.fit_mesh(
        mesh,
        keypoints=keypoints,
        keypoint_indices=keypoint_indices,
        anchor_targets=anchor_targets,
    )

    result_npz = output_dir / "smplx_fit_result.npz"
    np.savez_compressed(
        result_npz,
        betas=fit_result.betas,
        body_pose=fit_result.body_pose,
        global_orient=fit_result.global_orient,
        translation=fit_result.translation,
        scale=fit_result.scale,
        vertices=fit_result.vertices,
        joints=fit_result.joints,
        chamfer=fit_result.chamfer,
        keypoint=fit_result.keypoint,
        anchor=fit_result.anchor,
        prior=fit_result.prior,
        total_loss=fit_result.total_loss,
        iterations=fit_result.iterations,
        success=fit_result.success,
    )

    summary = {
        "success": fit_result.success,
        "iterations": fit_result.iterations,
        "loss": {
            "chamfer": float(fit_result.chamfer),
            "keypoint": float(fit_result.keypoint),
            "anchor": float(fit_result.anchor),
            "prior": float(fit_result.prior),
            "total": float(fit_result.total_loss),
        },
        "output": {
            "smplx_fit_result": str(result_npz),
        },
    }

    if fitter.lbs_weights is not None:
        weight_cfg = WeightTransferConfig()
        weight_result = transfer_weights(
            smpl_vertices=fit_result.vertices,
            sam_vertices=mesh.normalized_vertices,
            smpl_weights=fitter.lbs_weights,
            faces=mesh.faces,
            config=weight_cfg,
        )
        weights_path = output_dir / "sam_weights.npz"
        weight_result.save_npz(weights_path)
        summary["output"]["sam_weights"] = str(weights_path)

    if args.export_obj or args.export_ply:
        try:
            import trimesh
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("导出 OBJ/PLY 需要 trimesh 依赖") from exc
        faces = np.asarray(getattr(fitter.model, "faces", []), dtype=np.int32)
        smplx_mesh = trimesh.Trimesh(vertices=fit_result.vertices, faces=faces, process=False)
        if args.export_obj:
            smplx_mesh.export(output_dir / "smplx_mesh.obj")
        if args.export_ply:
            smplx_mesh.export(output_dir / "smplx_mesh.ply")

    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved SMPL-X fit -> {result_npz}")
    print(f"Summary -> {summary_path}")


if __name__ == "__main__":
    main()

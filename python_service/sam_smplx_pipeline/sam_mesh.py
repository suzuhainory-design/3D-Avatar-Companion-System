# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple, Union

import numpy as np


@dataclass
class SAMPerson:
    """单个人体实例的数据容器。"""

    pid: int
    vertices: np.ndarray
    bbox: np.ndarray
    metadata: Dict


class SAMMesh:
    """
    负责加载 / 归一化 SAM 3D Body 的 mesh json。
    - 支持多人的顶点拼接
    - 提供统一坐标、尺度、采样等工具
    """

    def __init__(
        self,
        vertices: np.ndarray,
        faces: np.ndarray,
        people: List[SAMPerson],
        metadata: Dict,
    ) -> None:
        if vertices.ndim != 2 or vertices.shape[1] != 3:
            raise ValueError("vertices 需要为 [N,3] 数组")
        if faces.ndim != 2 or faces.shape[1] != 3:
            raise ValueError("faces 需要为 [F,3] 三角形索引")

        self.vertices = vertices.astype(np.float32)
        self.faces = faces.astype(np.int32)
        self.people = people
        self.metadata = metadata

        self._normalized_vertices: Optional[np.ndarray] = None
        self._norm_transform: Optional[
            Dict[str, Union[np.ndarray, float]]
        ] = None

    @classmethod
    def from_json(cls, path: Path) -> "SAMMesh":
        data = json.loads(path.read_text(encoding="utf-8"))
        faces = np.asarray(data.get("faces", []), dtype=np.int32)
        people_entries = data.get("people", [])
        if not people_entries:
            raise ValueError(f"{path} 中未找到 people 数据")

        concat_vertices: List[np.ndarray] = []
        people: List[SAMPerson] = []
        for entry in people_entries:
            verts = np.asarray(entry["vertices"], dtype=np.float32)
            concat_vertices.append(verts)
            people.append(
                SAMPerson(
                    pid=int(entry.get("id", len(people))),
                    vertices=verts,
                    bbox=np.asarray(entry.get("bbox", [0, 0, 0, 0]), dtype=np.float32),
                    metadata={
                        k: v
                        for k, v in entry.items()
                        if k not in {"vertices", "bbox", "id"}
                    },
                )
            )

        vertices = np.concatenate(concat_vertices, axis=0)
        return cls(vertices=vertices, faces=faces, people=people, metadata=data)

    # ------------------------------------------------------------------ #
    # 归一化 / 采样
    # ------------------------------------------------------------------ #
    def align_to_canonical(
        self,
        target_height: float = 1.7,
        axis_permutation: Sequence[int] = (0, 1, 2),
        axis_sign: Sequence[int] = (1, 1, 1),
        pose: str = "A",
    ) -> "SAMMesh":
        """
        将 SAM 顶点调整到统一坐标系，并缩放到指定身高。
        pose 参数目前仅用于记录，后续可接入 T/A Pose 调整逻辑。
        """
        perm = np.asarray(axis_permutation, dtype=np.int64)
        sign = np.asarray(axis_sign, dtype=np.float32)
        canonical = self.vertices[:, perm] * sign

        center = canonical.mean(axis=0, keepdims=True)
        canonical = canonical - center
        height_axis = 1  # 经过 permutation 后的第二个分量作为竖直方向
        raw_height = float(canonical[:, height_axis].max() - canonical[:, height_axis].min())
        if raw_height < 1e-6:
            raw_height = 1e-6
        scale = target_height / raw_height
        canonical *= scale

        self._normalized_vertices = canonical
        self._norm_transform = {
            "center": center.squeeze(0),
            "scale": float(scale),
            "pose_hint": pose,
            "axis_permutation": perm,
            "axis_sign": sign,
            "target_height": target_height,
        }
        return self

    @property
    def normalized_vertices(self) -> np.ndarray:
        if self._normalized_vertices is None:
            self.align_to_canonical()
        assert self._normalized_vertices is not None
        return self._normalized_vertices

    @property
    def norm_transform(self) -> Dict[str, np.ndarray]:
        if self._norm_transform is None:
            self.align_to_canonical()
        assert self._norm_transform is not None
        return self._norm_transform

    def sample_vertices(
        self,
        count: int,
        use_faces: bool = True,
        normalized: bool = True,
        seed: Optional[int] = None,
    ) -> np.ndarray:
        verts = self.normalized_vertices if normalized else self.vertices
        if use_faces and len(self.faces) > 0:
            try:
                import trimesh

                mesh = trimesh.Trimesh(vertices=verts, faces=self.faces, process=False)
                return mesh.sample(count, seed=seed)
            except Exception:
                # 回退为纯随机采样
                pass

        rng = np.random.default_rng(seed)
        if count >= len(verts):
            return verts.copy()
        indices = rng.choice(len(verts), size=count, replace=False)
        return verts[indices]

    def to_tensor(
        self,
        device: str = "cpu",
        sample_vertices: Optional[int] = None,
        normalized: bool = True,
    ):
        import torch

        verts = (
            self.normalized_vertices.copy()
            if normalized
            else self.vertices.copy()
        )
        if sample_vertices is not None and sample_vertices < len(verts):
            verts = self.sample_vertices(sample_vertices, normalized=normalized)
        return torch.as_tensor(verts, dtype=torch.float32, device=device)

    # ------------------------------------------------------------------ #
    # 导出 / 统计
    # ------------------------------------------------------------------ #
    def export_mesh(self, path: Path, normalized: bool = True) -> Path:
        try:
            import trimesh

            verts = self.normalized_vertices if normalized else self.vertices
            mesh = trimesh.Trimesh(vertices=verts, faces=self.faces, process=False)
            mesh.export(path)
            return path
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("导出 PLY 需要 trimesh 依赖") from exc

    def scene_bounds(self, normalized: bool = True) -> Dict[str, float]:
        verts = self.normalized_vertices if normalized else self.vertices
        min_corner = verts.min(axis=0)
        max_corner = verts.max(axis=0)
        return {
            "min": min_corner.tolist(),
            "max": max_corner.tolist(),
            "diagonal": float(np.linalg.norm(max_corner - min_corner)),
        }

    def denormalize_points(self, points: np.ndarray) -> np.ndarray:
        """
        将 canonical/normalized 坐标还原到原始 SAM 坐标系。
        """
        if self._norm_transform is None:
            raise ValueError("请先调用 align_to_canonical 再进行反变换")
        pts = np.asarray(points, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 3:
            raise ValueError("points 需要为 [N,3]")
        transform = self._norm_transform
        perm = transform["axis_permutation"]
        sign = transform["axis_sign"]
        center = transform["center"]
        scale = float(transform["scale"])

        temp = pts / scale + center
        restored = np.zeros_like(temp)
        restored[:, perm] = temp / sign
        return restored

    def estimate_body_keypoints(self) -> Dict[str, np.ndarray]:
        """
        基于 canonical 顶点估计骨盆/膝盖/脚部关键点，返回 normalized 空间下的坐标。
        """
        verts = self.normalized_vertices
        if verts.size == 0:
            return {}

        y_coords = verts[:, 1]
        min_corner = verts.min(axis=0)
        max_corner = verts.max(axis=0)
        height = float(max_corner[1] - min_corner[1])
        width = float(max_corner[0] - min_corner[0])
        depth = float(max_corner[2] - min_corner[2])
        if height <= 1e-6:
            return {}

        center_x = float(np.median(verts[:, 0]))
        center_z = float(np.median(verts[:, 2]))
        left_mask = verts[:, 0] <= center_x
        right_mask = ~left_mask

        def _band(low: float, high: float) -> np.ndarray:
            return (y_coords >= low) & (y_coords <= high)

        anchors: Dict[str, np.ndarray] = {}

        def _assign(name: str, mask: np.ndarray):
            pts = verts[mask]
            if pts.shape[0] < 12:
                return
            anchors[name] = pts.mean(axis=0)

        foot_zone = min_corner[1] + height * 0.03
        toe_zone = min_corner[1] + height * 0.015
        ankle_zone = min_corner[1] + height * 0.09
        knee_low = min_corner[1] + height * 0.35
        knee_high = min_corner[1] + height * 0.5
        pelvis_low = min_corner[1] + height * 0.48
        pelvis_high = min_corner[1] + height * 0.6
        head_zone = max_corner[1] - height * 0.03

        tight_center_mask = np.abs(verts[:, 0] - center_x) <= width * 0.15
        tight_depth_mask = np.abs(verts[:, 2] - center_z) <= depth * 0.2

        _assign("pelvis", _band(pelvis_low, pelvis_high) & tight_center_mask & tight_depth_mask)
        _assign("head", y_coords >= head_zone)

        _assign("left_ankle", left_mask & _band(foot_zone, ankle_zone))
        _assign("right_ankle", right_mask & _band(foot_zone, ankle_zone))
        _assign("left_foot", left_mask & (y_coords <= foot_zone))
        _assign("right_foot", right_mask & (y_coords <= foot_zone))
        _assign("left_toe", left_mask & (y_coords <= toe_zone))
        _assign("right_toe", right_mask & (y_coords <= toe_zone))
        _assign("left_knee", left_mask & _band(knee_low, knee_high))
        _assign("right_knee", right_mask & _band(knee_low, knee_high))

        return anchors

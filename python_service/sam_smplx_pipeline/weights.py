# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy.spatial import cKDTree

from .config import WeightTransferConfig


@dataclass
class WeightTransferResult:
    weights: np.ndarray
    neighbor_indices: np.ndarray
    neighbor_distances: np.ndarray
    metadata: Dict

    def save_npz(self, path: Path) -> Path:
        np.savez_compressed(
            path,
            weights=self.weights,
            neighbor_indices=self.neighbor_indices,
            neighbor_distances=self.neighbor_distances,
            metadata=self.metadata,
        )
        return path


def _build_adjacency(faces: np.ndarray, vertex_count: int) -> List[np.ndarray]:
    adjacency: List[set[int]] = [set() for _ in range(vertex_count)]
    for tri in faces:
        a, b, c = tri.astype(int).tolist()
        adjacency[a].update([b, c])
        adjacency[b].update([a, c])
        adjacency[c].update([a, b])
    return [np.fromiter(neigh, dtype=np.int64) for neigh in adjacency]


def transfer_weights(
    smpl_vertices: np.ndarray,
    sam_vertices: np.ndarray,
    smpl_weights: np.ndarray,
    faces: np.ndarray,
    config: Optional[WeightTransferConfig] = None,
) -> WeightTransferResult:
    cfg = config or WeightTransferConfig()
    if smpl_vertices.shape[1] != 3 or sam_vertices.shape[1] != 3:
        raise ValueError("顶点坐标需要为 [N,3]")

    neighbors = max(cfg.neighbors, 1)
    tree = cKDTree(smpl_vertices)
    distances, indices = tree.query(sam_vertices, k=neighbors, workers=-1)
    if neighbors == 1:
        distances = distances[:, None]
        indices = indices[:, None]

    influence = np.exp(-np.square(distances) / max(cfg.falloff, 1e-6))
    weights = smpl_weights[indices]  # [V, K, J]
    weighted_sum = (weights * influence[..., None]).sum(axis=1)
    norm = influence.sum(axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    transferred = weighted_sum / norm

    transferred /= np.clip(
        transferred.sum(axis=1, keepdims=True), a_min=1e-6, a_max=None
    )

    if cfg.laplacian_iters > 0:
        adjacency = _build_adjacency(faces, len(sam_vertices))
        for _ in range(cfg.laplacian_iters):
            new_weights = transferred.copy()
            for vid, neigh in enumerate(adjacency):
                if neigh.size == 0:
                    continue
                smooth = transferred[neigh].mean(axis=0)
                new_weights[vid] = (
                    (1 - cfg.laplacian_lambda) * transferred[vid]
                    + cfg.laplacian_lambda * smooth
                )
            transferred = new_weights
        transferred /= np.clip(
            transferred.sum(axis=1, keepdims=True), a_min=1e-6, a_max=None
        )

    metadata = {
        "neighbors": neighbors,
        "falloff": cfg.falloff,
        "laplacian_iters": cfg.laplacian_iters,
        "laplacian_lambda": cfg.laplacian_lambda,
    }
    return WeightTransferResult(
        weights=transferred.astype(np.float32),
        neighbor_indices=indices.astype(np.int32),
        neighbor_distances=distances.astype(np.float32),
        metadata=metadata,
    )

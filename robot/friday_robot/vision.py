from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ALLOWED_TASKS = {"object_detection", "face_detection", "face_embedding", "marker_detection"}


@dataclass(frozen=True)
class ModelArtifact:
    name: str
    task: str
    path: Path
    sha256: str
    license: str
    source: str


class ModelRegistry:
    """Charge uniquement des poids explicitement inventoriés et vérifiés."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def load(self, manifest_path: Path) -> list[ModelArtifact]:
        manifest = manifest_path.resolve()
        if manifest.parent != self.root or manifest.name != "manifest.json":
            raise ValueError("Le manifeste doit être à la racine du registre de modèles.")
        raw = json.loads(manifest.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or set(raw) != {"version", "models"} or raw["version"] != 1:
            raise ValueError("Format de manifeste invalide.")
        if not isinstance(raw["models"], list) or len(raw["models"]) > 12:
            raise ValueError("Liste de modèles invalide.")
        return [self._artifact(item) for item in raw["models"]]

    def _artifact(self, value: object) -> ModelArtifact:
        expected = {"name", "task", "file", "sha256", "license", "source"}
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("Entrée de modèle invalide.")
        if value["task"] not in ALLOWED_TASKS:
            raise ValueError("Tâche de vision non autorisée.")
        if not all(isinstance(value[key], str) and value[key].strip() for key in expected):
            raise ValueError("Métadonnées de modèle incomplètes.")
        file_path = (self.root / value["file"]).resolve()
        if file_path.parent != self.root or not file_path.is_file():
            raise ValueError("Fichier de modèle absent ou hors registre.")
        expected_hash = value["sha256"].lower()
        if len(expected_hash) != 64 or any(char not in "0123456789abcdef" for char in expected_hash):
            raise ValueError("Empreinte SHA-256 invalide.")
        digest = hashlib.sha256(file_path.read_bytes()).hexdigest()
        if digest != expected_hash:
            raise ValueError(f"Empreinte invalide pour {value['name']}.")
        return ModelArtifact(
            name=value["name"], task=value["task"], path=file_path,
            sha256=digest, license=value["license"], source=value["source"],
        )


def normalize_detection(value: object) -> dict[str, Any]:
    expected = {"id", "kind", "label", "confidence", "x", "y", "width", "height", "trackId"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Détection invalide.")
    if value["kind"] not in {"object", "person", "identity", "marker", "safety"}:
        raise ValueError("Type de détection invalide.")
    if not isinstance(value["id"], str) or not 1 <= len(value["id"]) <= 80:
        raise ValueError("Identifiant de détection invalide.")
    if not isinstance(value["label"], str) or not 1 <= len(value["label"]) <= 80:
        raise ValueError("Libellé de détection invalide.")
    confidence = value["confidence"]
    if confidence is not None and (isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1):
        raise ValueError("Confiance invalide.")
    coordinates = [value[key] for key in ("x", "y", "width", "height")]
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in coordinates):
        raise ValueError("Coordonnées invalides.")
    x, y, width, height = map(float, coordinates)
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1.000001 or y + height > 1.000001:
        raise ValueError("Boîte de détection hors image.")
    if value["trackId"] is not None and not isinstance(value["trackId"], str):
        raise ValueError("Piste invalide.")
    return {**value, "x": x, "y": y, "width": width, "height": height}

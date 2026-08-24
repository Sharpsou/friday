from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from friday_robot.vision import ModelRegistry, normalize_detection


class VisionTests(unittest.TestCase):
    def test_registry_verifies_hash_and_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "detector.onnx"
            model.write_bytes(b"model")
            manifest = {
                "version": 1,
                "models": [{
                    "name": "tiny-detector", "task": "object_detection",
                    "file": model.name, "sha256": hashlib.sha256(b"model").hexdigest(),
                    "license": "Apache-2.0", "source": "https://example.invalid/upstream",
                }],
            }
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            artifacts = ModelRegistry(root).load(root / "manifest.json")
            self.assertEqual(artifacts[0].name, "tiny-detector")
            model.write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                ModelRegistry(root).load(root / "manifest.json")

    def test_detection_must_stay_inside_frame(self):
        detection = {
            "id": "1", "kind": "object", "label": "chaise", "confidence": 0.9,
            "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4, "trackId": None,
        }
        self.assertEqual(normalize_detection(detection)["label"], "chaise")
        detection["width"] = 1
        with self.assertRaises(ValueError):
            normalize_detection(detection)


if __name__ == "__main__":
    unittest.main()

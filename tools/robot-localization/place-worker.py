"""Worker OpenCV borné pour la ressemblance entre lieux visuels Friday.

Le protocole est volontairement simple : une requête JSON par ligne sur stdin,
une réponse JSON par ligne sur stdout. Les images ne sont jamais écrites sur
disque et ne sont pas renvoyées au hub.
"""

from __future__ import annotations

import base64
import json
import sys
from typing import Any

import cv2
import numpy as np


WIDTH = 320
HEIGHT = 240
MAX_FEATURES = 500
MAX_MOTION_FEATURES = 160


def perceptual_hash(gray: np.ndarray) -> str:
    small = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    transformed = cv2.dct(np.float32(small))[:8, :8]
    values = transformed.flatten()
    median = float(np.median(values[1:]))
    bits = 0
    for value in values:
        bits = (bits << 1) | int(float(value) > median)
    return f"{bits:016x}"


def decode_descriptors(value: str, feature_count: int) -> np.ndarray:
    raw = base64.b64decode(value)
    if feature_count == 0:
        return np.empty((0, 32), dtype=np.uint8)
    expected = feature_count * 32
    if len(raw) != expected:
        raise ValueError("Longueur de descripteurs ORB invalide.")
    return np.frombuffer(raw, dtype=np.uint8).reshape((feature_count, 32))


def extract(payload: dict[str, Any]) -> dict[str, Any]:
    encoded = payload.get("image")
    if not isinstance(encoded, str):
        raise ValueError("Image JPEG absente.")
    image = cv2.imdecode(
        np.frombuffer(base64.b64decode(encoded), dtype=np.uint8),
        cv2.IMREAD_COLOR,
    )
    if image is None:
        raise ValueError("Image JPEG illisible.")
    image = cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    for mask in payload.get("masks", []):
        x = max(0, min(WIDTH, round(float(mask["x"]) * WIDTH)))
        y = max(0, min(HEIGHT, round(float(mask["y"]) * HEIGHT)))
        right = max(x, min(WIDTH, round((float(mask["x"]) + float(mask["width"])) * WIDTH)))
        bottom = max(y, min(HEIGHT, round((float(mask["y"]) + float(mask["height"])) * HEIGHT)))
        gray[y:bottom, x:right] = 127

    quality = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    orb = cv2.ORB_create(nfeatures=MAX_FEATURES, fastThreshold=15)
    keypoints, descriptors = orb.detectAndCompute(gray, None)
    keypoints = keypoints or []
    if descriptors is None:
        descriptors = np.empty((0, 32), dtype=np.uint8)
    return {
        "perceptualHash": perceptual_hash(gray),
        "quality": quality,
        "luminance": float(np.mean(gray)),
        "featureCount": len(keypoints),
        "keypoints": [
            [round(point.pt[0] / WIDTH, 6), round(point.pt[1] / HEIGHT, 6), round(point.angle, 3)]
            for point in keypoints
        ],
        "descriptors": base64.b64encode(descriptors.tobytes()).decode("ascii"),
    }


def decode_gray(encoded: str) -> np.ndarray:
    image = cv2.imdecode(
        np.frombuffer(base64.b64decode(encoded), dtype=np.uint8),
        cv2.IMREAD_GRAYSCALE,
    )
    if image is None:
        raise ValueError("Image JPEG illisible.")
    return cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)


def motion(payload: dict[str, Any]) -> dict[str, Any]:
    previous = decode_gray(payload["previousImage"])
    current = decode_gray(payload["currentImage"])
    points = cv2.goodFeaturesToTrack(
        previous,
        maxCorners=MAX_MOTION_FEATURES,
        qualityLevel=0.01,
        minDistance=7,
        blockSize=7,
    )
    if points is None or len(points) < 12:
        return {
            "trackCount": 0,
            "medianFlowPx": 0.0,
            "rotationRad": 0.0,
            "scaleDelta": 0.0,
            "coherence": 0.0,
        }
    tracked, status, _ = cv2.calcOpticalFlowPyrLK(
        previous,
        current,
        points,
        None,
        winSize=(21, 21),
        maxLevel=3,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
    )
    if tracked is None or status is None:
        return {
            "trackCount": 0,
            "medianFlowPx": 0.0,
            "rotationRad": 0.0,
            "scaleDelta": 0.0,
            "coherence": 0.0,
        }
    accepted = status.ravel().astype(bool)
    source = points.reshape(-1, 2)[accepted]
    target = tracked.reshape(-1, 2)[accepted]
    if len(source) < 12:
        return {
            "trackCount": int(len(source)),
            "medianFlowPx": 0.0,
            "rotationRad": 0.0,
            "scaleDelta": 0.0,
            "coherence": 0.0,
        }
    transform, inliers = cv2.estimateAffinePartial2D(
        source,
        target,
        method=cv2.RANSAC,
        ransacReprojThreshold=2.5,
    )
    flow = target - source
    magnitudes = np.linalg.norm(flow, axis=1)
    median_flow = float(np.median(magnitudes))
    if transform is None:
        rotation = 0.0
        scale_delta = 0.0
    else:
        a = float(transform[0, 0])
        b = float(transform[0, 1])
        rotation = float(np.arctan2(b, a))
        scale_delta = float(np.sqrt(a * a + b * b) - 1.0)
    coherence = (
        float(np.count_nonzero(inliers)) / max(1, len(source))
        if inliers is not None
        else 0.0
    )
    return {
        "trackCount": int(len(source)),
        "medianFlowPx": round(median_flow, 6),
        "rotationRad": round(rotation, 6),
        "scaleDelta": round(scale_delta, 6),
        "coherence": round(coherence, 6),
    }


def match(payload: dict[str, Any]) -> dict[str, Any]:
    probe = payload["probe"]
    probe_points = np.float32([[point[0] * WIDTH, point[1] * HEIGHT] for point in probe["keypoints"]])
    probe_descriptors = decode_descriptors(probe["descriptors"], int(probe["featureCount"]))
    if len(probe_descriptors) < 4:
        return {"matches": []}
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    results: list[dict[str, Any]] = []
    for candidate in payload.get("candidates", []):
        candidate_points = np.float32(
            [[point[0] * WIDTH, point[1] * HEIGHT] for point in candidate["keypoints"]]
        )
        candidate_descriptors = decode_descriptors(
            candidate["descriptors"], int(candidate["featureCount"])
        )
        if len(candidate_descriptors) < 4:
            continue
        pairs = matcher.knnMatch(probe_descriptors, candidate_descriptors, k=2)
        good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance]
        if len(good) < 4:
            continue
        source = np.float32([probe_points[item.queryIdx] for item in good]).reshape(-1, 1, 2)
        target = np.float32([candidate_points[item.trainIdx] for item in good]).reshape(-1, 1, 2)
        _, inlier_mask = cv2.findHomography(source, target, cv2.RANSAC, 4.0)
        if inlier_mask is None:
            continue
        accepted = inlier_mask.ravel().astype(bool)
        inliers = int(np.count_nonzero(accepted))
        inlier_ratio = inliers / max(1, len(good))
        quadrants: set[int] = set()
        angle_deltas: list[float] = []
        for item, is_inlier in zip(good, accepted, strict=True):
            if not is_inlier:
                continue
            point = probe["keypoints"][item.queryIdx]
            quadrants.add((1 if point[0] >= 0.5 else 0) + (2 if point[1] >= 0.5 else 0))
            delta = float(candidate["keypoints"][item.trainIdx][2]) - float(point[2])
            angle_deltas.append((delta + 180.0) % 360.0 - 180.0)
        rotation = float(np.median(angle_deltas)) * np.pi / 180.0 if angle_deltas else 0.0
        coverage = len(quadrants)
        score = min(1.0, inliers / 40.0) * 0.5 + min(1.0, inlier_ratio) * 0.35 + coverage / 4.0 * 0.15
        results.append(
            {
                "candidateId": candidate["id"],
                "rawMatches": len(good),
                "inliers": inliers,
                "inlierRatio": round(inlier_ratio, 6),
                "coverage": coverage,
                "rotationRad": round(rotation, 6),
                "score": round(score, 6),
            }
        )
    results.sort(key=lambda item: item["score"], reverse=True)
    return {"matches": results}


def respond(payload: dict[str, Any]) -> dict[str, Any]:
    operation = payload.get("operation")
    if operation == "extract":
        return extract(payload)
    if operation == "match":
        return match(payload)
    if operation == "motion":
        return motion(payload)
    raise ValueError("Opération de reconnaissance visuelle inconnue.")


for line in sys.stdin:
    try:
        request = json.loads(line)
        result = respond(request)
        response = {"id": request.get("id"), "result": result}
    except Exception as error:  # le hub journalise et dégrade sans arrêter le robot
        response = {
            "id": request.get("id") if "request" in locals() else None,
            "error": f"{type(error).__name__}: {error}",
        }
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
    sys.stdout.flush()

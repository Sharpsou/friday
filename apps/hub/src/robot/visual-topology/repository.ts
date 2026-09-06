import {
  RobotVisualGraphSchema,
  type RobotState,
  type RobotVisualGraph,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import type { RobotVisionKeyframe } from '../robot-controller.js';
import type { RobotPlaceSignatureFeatures } from '../robot-place-recognition.js';
import {
  DESCRIPTOR_QUOTA_BYTES,
  IMAGE_QUOTA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_OBJECTS,
  MAX_PLACES,
  MAX_VIEWS_PER_PLACE,
  PROVISIONAL_TTL_MS,
} from './policy.js';
import type { ViewRow } from './records.js';
export class VisualTopologyRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
  ) {}
  navigationPath(
    from: string,
    to: string,
    allowCandidates: boolean,
  ): string[] | null {
    if (from === to) return [from];
    const rows = this.database
      .prepare(
        `SELECT t.from_place_id, t.to_place_id
           FROM robot_visual_transitions t
           JOIN robot_visual_places a ON a.id = t.from_place_id
           JOIN robot_visual_places b ON b.id = t.to_place_id
          WHERE t.household_id = ? AND a.status = 'confirmed'
            AND b.status = 'confirmed'
            AND a.panorama_status = 'complete'
            AND b.panorama_status = 'complete'
            AND t.status IN (${allowCandidates ? "'confirmed', 'candidate'" : "'confirmed'"})`,
      )
      .all(this.householdId) as Array<{
      from_place_id: string;
      to_place_id: string;
    }>;
    const neighbors = new Map<string, string[]>();
    for (const row of rows)
      neighbors.set(row.from_place_id, [
        ...(neighbors.get(row.from_place_id) ?? []),
        row.to_place_id,
      ]);
    const queue: string[][] = [[from]];
    const seen = new Set([from]);
    while (queue.length > 0) {
      const path = queue.shift()!;
      if (allowCandidates && path.length >= 4) continue;
      for (const next of neighbors.get(path.at(-1)!) ?? []) {
        if (seen.has(next)) continue;
        const candidate = [...path, next];
        if (next === to) {
          const edgeCount = candidate.length - 1;
          if (!allowCandidates || (edgeCount >= 2 && edgeCount <= 3))
            return candidate;
          continue;
        }
        seen.add(next);
        queue.push(candidate);
      }
    }
    return null;
  }
  readCandidateViews(): ViewRow[] {
    return this.database
      .prepare(
        `SELECT id, place_id, perceptual_hash, keypoints_json, descriptors,
                feature_count, quality, luminance
           FROM robot_visual_place_views WHERE household_id = ?
          ORDER BY observed_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACES * MAX_VIEWS_PER_PLACE) as ViewRow[];
  }
  canonicalSectorId(placeId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT canonical_sector_id FROM robot_visual_places
          WHERE household_id = ? AND id = ?`,
      )
      .get(this.householdId, placeId) as
      { canonical_sector_id: string | null } | undefined;
    return row?.canonical_sector_id ?? null;
  }
  persistViewIfUseful(
    placeId: string,
    state: RobotState,
    keyframe: RobotVisionKeyframe,
    features: RobotPlaceSignatureFeatures,
    containsPerson: boolean,
  ): void {
    const existing = this.database
      .prepare(
        `SELECT pan, tilt FROM robot_visual_place_views
          WHERE place_id = ? ORDER BY quality DESC`,
      )
      .all(placeId) as Array<{ pan: number; tilt: number }>;
    if (existing.length >= MAX_VIEWS_PER_PLACE) return;
    if (
      existing.some(
        (view) =>
          Math.abs(view.pan - state.cameraPose.pan) < 0.2 &&
          Math.abs(view.tilt - state.cameraPose.tilt) < 0.2,
      )
    )
      return;
    this.persistView(placeId, state, keyframe, features, containsPerson);
  }
  persistView(
    placeId: string,
    state: RobotState,
    keyframe: RobotVisionKeyframe,
    features: RobotPlaceSignatureFeatures,
    containsPerson: boolean,
  ): void {
    const descriptors = Buffer.from(features.descriptors, 'base64');
    const storage = this.database
      .prepare(
        `SELECT COALESCE(SUM(length(descriptors)), 0) AS bytes
           FROM robot_visual_place_views WHERE household_id = ?`,
      )
      .get(this.householdId) as { bytes: number };
    if (storage.bytes + descriptors.length > DESCRIPTOR_QUOTA_BYTES) return;
    this.pruneImages(keyframe.image.length);
    const image =
      !containsPerson && keyframe.image.length <= MAX_IMAGE_BYTES
        ? keyframe.image
        : null;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO robot_visual_place_views(
           id, household_id, place_id, frame_id, perceptual_hash,
           keypoints_json, descriptors, feature_count, quality, luminance,
           pan, tilt, image_jpeg, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        this.householdId,
        placeId,
        keyframe.frameId,
        features.perceptualHash,
        JSON.stringify(features.keypoints),
        descriptors,
        features.featureCount,
        features.quality,
        features.luminance,
        state.cameraPose.pan,
        state.cameraPose.tilt,
        image,
        keyframe.observedAt,
        new Date().toISOString(),
      );
  }
  mergePlaceObjects(targetPlaceId: string, sourcePlaceId: string): void {
    const rows = this.database
      .prepare(
        `SELECT id, place_id, class_label, display_name, confidence,
                sighting_count, first_seen_at, last_seen_at
           FROM robot_visual_objects
          WHERE household_id = ? AND place_id IN (?, ?)`,
      )
      .all(this.householdId, targetPlaceId, sourcePlaceId) as Array<{
      class_label: string;
      confidence: number;
      display_name: string;
      first_seen_at: string;
      id: string;
      last_seen_at: string;
      place_id: string;
      sighting_count: number;
    }>;
    const targetByClass = new Map(
      rows
        .filter((row) => row.place_id === targetPlaceId)
        .map((row) => [row.class_label, row]),
    );
    const now = new Date().toISOString();
    for (const source of rows.filter((row) => row.place_id === sourcePlaceId)) {
      const target = targetByClass.get(source.class_label);
      if (!target) {
        this.database
          .prepare(
            `UPDATE robot_visual_objects SET place_id = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(targetPlaceId, now, source.id);
        continue;
      }
      const targetCustom = target.display_name !== target.class_label;
      const sourceCustom = source.display_name !== source.class_label;
      const displayName = targetCustom
        ? target.display_name
        : sourceCustom
          ? source.display_name
          : target.display_name;
      this.database
        .prepare(
          `UPDATE robot_visual_objects
              SET display_name = ?, confidence = ?, sighting_count = ?,
                  first_seen_at = ?, last_seen_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          displayName,
          Math.max(target.confidence, source.confidence),
          target.sighting_count + source.sighting_count,
          target.first_seen_at < source.first_seen_at
            ? target.first_seen_at
            : source.first_seen_at,
          target.last_seen_at > source.last_seen_at
            ? target.last_seen_at
            : source.last_seen_at,
          now,
          target.id,
        );
      this.database
        .prepare('DELETE FROM robot_visual_objects WHERE id = ?')
        .run(source.id);
    }
  }
  mergePlaceTransitions(_targetPlaceId: string, sourcePlaceId: string): void {
    // Sector-relative routes cannot be safely redirected to another panorama.
    // Forget only the absorbed place's routes and let them be observed again.
    this.database
      .prepare(
        `DELETE FROM robot_visual_transitions
          WHERE household_id = ? AND (from_place_id = ? OR to_place_id = ?)`,
      )
      .run(this.householdId, sourcePlaceId, sourcePlaceId);
  }
  deleteLearningForPlace(placeId: string): void {
    // Procedural habits deliberately do not contain place identifiers.
    this.database
      .prepare(
        `DELETE FROM robot_recovery_skills
          WHERE household_id = ? AND instr(situation_key, ?) > 0`,
      )
      .run(this.householdId, placeId);
  }
  pruneImages(incomingBytes: number): void {
    let total = (
      this.database
        .prepare(
          `SELECT COALESCE(SUM(length(image_jpeg)), 0) AS bytes
             FROM robot_visual_place_views WHERE household_id = ?`,
        )
        .get(this.householdId) as { bytes: number }
    ).bytes;
    const oldest = this.database
      .prepare(
        `SELECT id, length(image_jpeg) AS bytes FROM robot_visual_place_views
          WHERE household_id = ? AND image_jpeg IS NOT NULL
          ORDER BY observed_at`,
      )
      .all(this.householdId) as Array<{ bytes: number; id: string }>;
    for (const row of oldest) {
      if (total + incomingBytes <= IMAGE_QUOTA_BYTES) break;
      this.database
        .prepare(
          'UPDATE robot_visual_place_views SET image_jpeg = NULL WHERE id = ?',
        )
        .run(row.id);
      total -= row.bytes;
    }
  }
  expireProvisionalPlaces(): void {
    this.database
      .prepare(
        `DELETE FROM robot_visual_places
          WHERE household_id = ? AND status = 'provisional' AND last_seen_at < ?`,
      )
      .run(
        this.householdId,
        new Date(Date.now() - PROVISIONAL_TTL_MS).toISOString(),
      );
  }

  snapshot(currentPlaceId: string | null): RobotVisualGraph {
    const places = this.database
      .prepare(
        `SELECT p.id, p.status, p.label, p.confidence, p.panorama_status,
                p.canonical_sector_id,
                COUNT(DISTINCT v.id) AS view_count,
                COUNT(DISTINCT o.id) AS object_count,
                p.first_seen_at, p.last_seen_at
           FROM robot_visual_places p
           LEFT JOIN robot_visual_place_views v ON v.place_id = p.id
           LEFT JOIN robot_visual_objects o ON o.place_id = p.id
          WHERE p.household_id = ?
          GROUP BY p.id ORDER BY p.last_seen_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACES) as Array<Record<string, unknown>>;
    const views = this.database
      .prepare(
        `SELECT id, place_id, observed_at, pan, tilt, quality,
                image_jpeg IS NOT NULL AS has_image
           FROM robot_visual_place_views
          WHERE household_id = ? ORDER BY observed_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_PLACES * MAX_VIEWS_PER_PLACE) as Array<
      Record<string, unknown>
    >;
    const transitions = this.database
      .prepare(
        `SELECT id, from_place_id, to_place_id, from_sector_id, to_sector_id,
                direction, status, confidence, traversal_count, success_count,
                failure_count, expected_duration_ms, last_traversed_at
           FROM robot_visual_transitions WHERE household_id = ?
          ORDER BY last_traversed_at DESC LIMIT 1024`,
      )
      .all(this.householdId) as Array<Record<string, unknown>>;
    const sectors = this.database
      .prepare(
        `SELECT id, place_id, ordinal, quality, observed_at, is_canonical
           FROM robot_visual_anchor_sectors WHERE household_id = ?
          ORDER BY place_id, ordinal LIMIT 1536`,
      )
      .all(this.householdId) as Array<Record<string, unknown>>;
    const ports = this.database
      .prepare(
        `SELECT id, place_id, sector_id, status, evidence_count,
                failure_count, blocked_until
           FROM robot_visual_ports WHERE household_id = ? LIMIT 1536`,
      )
      .all(this.householdId) as Array<Record<string, unknown>>;
    const objects = this.database
      .prepare(
        `SELECT id, place_id, class_label, display_name, confidence,
                sighting_count, last_seen_at
           FROM robot_visual_objects WHERE household_id = ?
          ORDER BY last_seen_at DESC LIMIT ?`,
      )
      .all(this.householdId, MAX_OBJECTS) as Array<Record<string, unknown>>;
    const storage = this.database
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(length(image_jpeg)), 0)
              FROM robot_visual_place_views WHERE household_id = ?) AS image_bytes,
           (SELECT COALESCE(SUM(length(descriptors)), 0)
              FROM robot_visual_place_views WHERE household_id = ?) +
           (SELECT COALESCE(SUM(length(descriptors)), 0)
              FROM robot_visual_anchor_sectors WHERE household_id = ?)
              AS descriptor_bytes`,
      )
      .get(this.householdId, this.householdId, this.householdId) as {
      descriptor_bytes: number;
      image_bytes: number;
    };

    return RobotVisualGraphSchema.parse({
      version:
        places.length +
        views.length +
        sectors.length +
        ports.length +
        transitions.length +
        objects.length,
      currentPlaceId: currentPlaceId,
      places: places.map((row) => ({
        id: row.id,
        status: row.status,
        label: row.label,
        confidence: row.confidence,
        viewCount: row.view_count,
        objectCount: row.object_count,
        panoramaStatus: row.panorama_status,
        canonicalSectorId: row.canonical_sector_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      })),
      views: views.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        observedAt: row.observed_at,
        pan: row.pan,
        tilt: row.tilt,
        quality: row.quality,
        hasImage: Boolean(row.has_image),
      })),
      sectors: sectors.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        ordinal: row.ordinal,
        quality: row.quality,
        observedAt: row.observed_at,
        isCanonical: Boolean(row.is_canonical),
      })),
      ports: ports.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        sectorId: row.sector_id,
        status: row.status,
        evidenceCount: row.evidence_count,
        failureCount: row.failure_count,
        blockedUntil: row.blocked_until,
      })),
      transitions: transitions.map((row) => ({
        id: row.id,
        fromPlaceId: row.from_place_id,
        toPlaceId: row.to_place_id,
        direction: row.direction,
        status: row.status,
        confidence: row.confidence,
        traversalCount: row.traversal_count,
        successCount: row.success_count,
        failureCount: row.failure_count,
        fromSectorId: row.from_sector_id,
        toSectorId: row.to_sector_id,
        expectedDurationMs: row.expected_duration_ms,
        lastTraversedAt: row.last_traversed_at,
      })),
      objects: objects.map((row) => ({
        id: row.id,
        placeId: row.place_id,
        classLabel: row.class_label,
        displayName: row.display_name,
        confidence: row.confidence,
        sightingCount: row.sighting_count,
        lastSeenAt: row.last_seen_at,
      })),
      storage: {
        imageBytes: storage.image_bytes,
        imageQuotaBytes: IMAGE_QUOTA_BYTES,
        descriptorBytes: storage.descriptor_bytes,
        descriptorQuotaBytes: DESCRIPTOR_QUOTA_BYTES,
      },
    });
  }
}

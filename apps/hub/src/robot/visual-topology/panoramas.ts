import { type RobotVisualGraph } from '@friday/contracts';
import type Database from 'better-sqlite3';
import type { RobotPlaceRecognitionEngine } from '../robot-place-recognition.js';
import {
  DESCRIPTOR_QUOTA_BYTES,
  hammingDistance,
  isAcceptedPlaceMatch,
  isCorroboratedPanoramaMatch,
  isUsableVisual,
  toCandidate,
  trimSectorFeatures,
} from './policy.js';
import type { ViewRow } from './records.js';
import type { VisualTopologyRepository } from './repository.js';
import type { VisualObservationState } from './state.js';
export class VisualPanoramas {
  private snapshot(): RobotVisualGraph {
    return this.repository.snapshot(this.state.currentPlaceId);
  }
  constructor(
    private readonly state: VisualObservationState,
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly recognition: RobotPlaceRecognitionEngine | undefined,
    private readonly repository: VisualTopologyRepository,
  ) {}
  panoramaProgress(): {
    complete: boolean;
    placeId: string | null;
    sectorCount: number;
  } {
    if (!this.state.currentPlaceId)
      return { complete: false, placeId: null, sectorCount: 0 };
    const row = this.database
      .prepare(
        `SELECT p.panorama_status,
                (SELECT COUNT(*) FROM robot_visual_anchor_sectors s
                  WHERE s.place_id = p.id) AS sector_count
           FROM robot_visual_places p
          WHERE p.household_id = ? AND p.id = ?`,
      )
      .get(this.householdId, this.state.currentPlaceId) as {
      panorama_status: string;
      sector_count: number;
    };
    return {
      complete: row.panorama_status === 'complete',
      placeId: this.state.currentPlaceId,
      sectorCount: row.sector_count,
    };
  }
  beginPanoramaSession(): void {
    this.state.panoramaSession = this.state.currentPlaceId
      ? {
          canonicalFeatures: null,
          canonicalObjects: new Set<string>(),
          captureCount: 0,
          objectOccurrences: new Map<string, number>(),
          placeId: this.state.currentPlaceId,
        }
      : null;
  }
  async captureStablePanoramaSector(): Promise<{
    added: boolean;
    complete: boolean;
    sectorCount: number;
  }> {
    const placeId = this.state.currentPlaceId;
    const features = this.state.lastFeatures;
    if (!placeId || !features || !this.recognition || !isUsableVisual(features))
      return { added: false, complete: false, sectorCount: 0 };
    const rows = this.database
      .prepare(
        `SELECT id, place_id, perceptual_hash, keypoints_json, descriptors,
                feature_count, quality, 0 AS luminance
           FROM robot_visual_anchor_sectors
          WHERE household_id = ? AND place_id = ? ORDER BY ordinal`,
      )
      .all(this.householdId, placeId) as ViewRow[];
    const session =
      this.state.panoramaSession?.placeId === placeId
        ? this.state.panoramaSession
        : {
            canonicalFeatures: null,
            canonicalObjects: new Set<string>(),
            captureCount: 0,
            objectOccurrences: new Map<string, number>(),
            placeId,
          };
    this.state.panoramaSession = session;
    const hasSessionStart = session.canonicalFeatures !== null;
    if (!session.canonicalFeatures) {
      session.canonicalFeatures = features;
      session.canonicalObjects = new Set(this.state.lastVisibleObjectLabels);
    }
    session.captureCount += 1;
    for (const label of this.state.lastVisibleObjectLabels)
      session.objectOccurrences.set(
        label,
        (session.objectOccurrences.get(label) ?? 0) + 1,
      );
    const sessionStartCandidateId = '__panorama_session_start__';
    const matches = await this.recognition.match(features, [
      ...rows.map(toCandidate),
      ...(hasSessionStart
        ? [
            {
              id: sessionStartCandidateId,
              descriptors: session.canonicalFeatures.descriptors,
              featureCount: session.canonicalFeatures.featureCount,
              keypoints: session.canonicalFeatures.keypoints,
              luminance: session.canonicalFeatures.luminance,
              perceptualHash: session.canonicalFeatures.perceptualHash,
              quality: session.canonicalFeatures.quality,
            },
          ]
        : []),
    ]);
    const canonicalMatch = matches.find(
      (match) => match.candidateId === sessionStartCandidateId,
    );
    const recurringCanonicalObject = [...session.canonicalObjects].some(
      (label) =>
        this.state.lastVisibleObjectLabels.has(label) &&
        (session.objectOccurrences.get(label) ?? 0) >= 3,
    );
    const perceptualDistance = hammingDistance(
      session.canonicalFeatures.perceptualHash,
      features.perceptualHash,
    );
    const strongVisualClosure =
      canonicalMatch &&
      isAcceptedPlaceMatch(canonicalMatch) &&
      canonicalMatch.score >= 0.7;
    const objectCorroboratedClosure =
      recurringCanonicalObject &&
      (perceptualDistance <= 12 ||
        (canonicalMatch && isCorroboratedPanoramaMatch(canonicalMatch)));
    if (
      rows.length >= 6 &&
      session.captureCount >= 6 &&
      (strongVisualClosure ||
        perceptualDistance <= 6 ||
        objectCorroboratedClosure)
    ) {
      this.database
        .prepare(
          `UPDATE robot_visual_places
              SET panorama_status = 'complete', status = 'confirmed',
                  updated_at = ? WHERE household_id = ? AND id = ?`,
        )
        .run(new Date().toISOString(), this.householdId, placeId);
      this.state.panoramaSession = null;
      return { added: false, complete: true, sectorCount: rows.length };
    }
    const duplicate = matches.some(
      (match) => isAcceptedPlaceMatch(match) && match.score >= 0.78,
    );
    if (duplicate || rows.length >= 12)
      return { added: false, complete: false, sectorCount: rows.length };
    const id = crypto.randomUUID();
    const ordinal = rows.length;
    const trimmed = trimSectorFeatures(features);
    const descriptorBytes = Buffer.from(
      trimmed.descriptors,
      'base64',
    ).byteLength;
    if (
      this.snapshot().storage.descriptorBytes + descriptorBytes >
      DESCRIPTOR_QUOTA_BYTES
    )
      return { added: false, complete: false, sectorCount: rows.length };
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO robot_visual_anchor_sectors(
             id, household_id, place_id, ordinal, perceptual_hash,
             keypoints_json, descriptors, feature_count, quality, observed_at,
             is_canonical
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.householdId,
          placeId,
          ordinal,
          trimmed.perceptualHash,
          JSON.stringify(trimmed.keypoints),
          Buffer.from(trimmed.descriptors, 'base64'),
          trimmed.featureCount,
          trimmed.quality,
          now,
          ordinal === 0 ? 1 : 0,
        );
      this.database
        .prepare(
          `INSERT INTO robot_visual_ports(
             id, household_id, place_id, sector_id, status, evidence_count,
             failure_count, blocked_until, updated_at
           ) VALUES (?, ?, ?, ?, 'unknown', 0, 0, NULL, ?)`,
        )
        .run(crypto.randomUUID(), this.householdId, placeId, id, now);
      this.database
        .prepare(
          `UPDATE robot_visual_places
              SET panorama_status = 'incomplete',
                  canonical_sector_id = COALESCE(canonical_sector_id, ?),
                  updated_at = ? WHERE household_id = ? AND id = ?`,
        )
        .run(id, now, this.householdId, placeId);
      if (ordinal === 0) {
        this.database
          .prepare(
            `UPDATE robot_visual_transitions
                SET from_sector_id = COALESCE(from_sector_id, ?)
              WHERE household_id = ? AND from_place_id = ?`,
          )
          .run(id, this.householdId, placeId);
        this.database
          .prepare(
            `UPDATE robot_visual_transitions
                SET to_sector_id = COALESCE(to_sector_id, ?)
              WHERE household_id = ? AND to_place_id = ?`,
          )
          .run(id, this.householdId, placeId);
      }
    })();
    return { added: true, complete: false, sectorCount: ordinal + 1 };
  }
  markPanoramaIncomplete(): void {
    this.state.panoramaSession = null;
    if (!this.state.currentPlaceId) return;
    this.database
      .prepare(
        `UPDATE robot_visual_places SET panorama_status = 'incomplete',
                updated_at = ? WHERE household_id = ? AND id = ?
                  AND panorama_status != 'complete'`,
      )
      .run(
        new Date().toISOString(),
        this.householdId,
        this.state.currentPlaceId,
      );
  }
  markCurrentPortBlocked(): void {
    if (!this.state.currentPlaceId) return;
    const sectorId = this.repository.canonicalSectorId(
      this.state.currentPlaceId,
    );
    if (!sectorId) return;
    const now = new Date();
    this.database
      .prepare(
        `UPDATE robot_visual_ports
            SET status = 'temporarily_blocked',
                failure_count = failure_count + 1,
                blocked_until = ?, updated_at = ?
          WHERE household_id = ? AND place_id = ? AND sector_id = ?`,
      )
      .run(
        new Date(now.getTime() + 60_000).toISOString(),
        now.toISOString(),
        this.householdId,
        this.state.currentPlaceId,
        sectorId,
      );
  }
}

import {
  type RobotDirection,
  type RobotState,
  type RobotVisualGraph,
  type RobotVisualMemoryPurgeScope,
} from '@friday/contracts';
import type Database from 'better-sqlite3';
import type { RobotVisionKeyframe } from './robot-controller.js';
import type { RobotPlaceRecognitionEngine } from './robot-place-recognition.js';
import { VisualGraphMutations } from './visual-topology/mutations.js';
import { VisualObjectTracker } from './visual-topology/objects.js';
import { VisualObservationProcessor } from './visual-topology/observations.js';
import { VisualPanoramas } from './visual-topology/panoramas.js';
import type {
  RobotVisualMemoryPurgeResult,
  RobotVisualObservation,
} from './visual-topology/records.js';
import { VisualTopologyRepository } from './visual-topology/repository.js';
import { VisualObservationState } from './visual-topology/state.js';
import { VisualTransitions } from './visual-topology/transitions.js';
export class RobotVisualTopologyService {
  private readonly repository: VisualTopologyRepository;
  private readonly state: VisualObservationState;
  private readonly objects: VisualObjectTracker;
  private readonly transitions: VisualTransitions;
  private readonly observations: VisualObservationProcessor;
  private readonly panoramas: VisualPanoramas;
  private readonly mutations: VisualGraphMutations;
  private queue = Promise.resolve<RobotVisualObservation>({
    confidence: 0,
    imageUsable: false,
    placeId: null,
    stable: false,
    motionState: 'uncertain',
    informationGain: 0,
  });
  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly recognition?: RobotPlaceRecognitionEngine,
  ) {
    this.repository = new VisualTopologyRepository(
      this.database,
      this.householdId,
    );
    this.repository.expireProvisionalPlaces();
    this.state = new VisualObservationState();
    this.objects = new VisualObjectTracker(
      this.database,
      this.householdId,
      this.state,
    );
    this.transitions = new VisualTransitions(
      this.state,
      this.database,
      this.householdId,
      this.repository,
      this.objects,
    );
    this.observations = new VisualObservationProcessor(
      this.state,
      this.recognition,
      this.repository,
      this.transitions,
      this.database,
      this.objects,
      this.householdId,
    );
    this.panoramas = new VisualPanoramas(
      this.state,
      this.database,
      this.householdId,
      this.recognition,
      this.repository,
    );
    this.mutations = new VisualGraphMutations(
      this.database,
      this.householdId,
      this.state,
      () => this.queue,
      this.repository,
    );
  }
  observe(
    state: RobotState,
    keyframe: RobotVisionKeyframe | null,
  ): Promise<RobotVisualObservation> {
    const epoch = this.state.observationEpoch;
    this.queue = this.queue
      .catch(() => ({
        confidence: 0,
        imageUsable: false,
        placeId: null,
        stable: false,
        motionState: 'uncertain' as const,
        informationGain: 0,
      }))
      .then(() => this.observations.processObservation(state, keyframe, epoch))
      .then((observation) => {
        this.state.latestObservation = observation;
        return observation;
      });
    return this.queue;
  }
  recordDriveCommand(direction: RobotDirection): void {
    const now = Date.now();
    this.state.lastDrive = { at: now, direction };
    if (!this.state.currentPlaceId) return;
    if (
      !this.state.traversal ||
      this.state.traversal.fromPlaceId !== this.state.currentPlaceId
    ) {
      this.state.traversal = {
        directions: [direction],
        fromPlaceId: this.state.currentPlaceId,
        startedAt: now,
        translationScore: 0,
      };
      return;
    }
    if (this.state.traversal.directions.at(-1) !== direction)
      this.state.traversal.directions.push(direction);
  }
  snapshot(): RobotVisualGraph {
    return this.repository.snapshot(this.state.currentPlaceId);
  }
  hasConfirmedPlace(placeId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM robot_visual_places
            WHERE id = ? AND household_id = ? AND status = 'confirmed'`,
        )
        .get(placeId, this.householdId),
    );
  }
  hasConfirmedArrival(placeId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM robot_visual_transitions t
             JOIN robot_visual_places a ON a.id = t.from_place_id
             JOIN robot_visual_places b ON b.id = t.to_place_id
            WHERE t.household_id = ? AND t.to_place_id = ?
              AND a.status = 'confirmed' AND b.status = 'confirmed'
              AND t.status = 'confirmed'
            LIMIT 1`,
        )
        .get(this.householdId, placeId),
    );
  }
  confirmedPath(from: string, to: string): string[] | null {
    return this.repository.navigationPath(from, to, false);
  }
  validationPath(from: string, to: string): string[] | null {
    return this.repository.navigationPath(from, to, true);
  }
  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    await this.recognition?.close();
  }
  pauseObservations(): void {
    return this.state.pauseObservations();
  }
  resumeObservationsAfter(durationMs: number): void {
    return this.state.resumeObservationsAfter(durationMs);
  }
  image(
    placeId: string,
    viewId: string,
  ): { image: Buffer; observedAt: string } | null {
    return this.mutations.image(placeId, viewId);
  }
  renameObject(id: string, displayName: string): RobotVisualGraph {
    return this.mutations.renameObject(id, displayName);
  }
  renamePlace(id: string, label: string): RobotVisualGraph {
    return this.mutations.renamePlace(id, label);
  }
  async mergePlaces(
    targetPlaceId: string,
    sourcePlaceId: string,
  ): Promise<RobotVisualGraph> {
    return this.mutations.mergePlaces(targetPlaceId, sourcePlaceId);
  }
  async deletePlace(placeId: string): Promise<RobotVisualGraph> {
    return this.mutations.deletePlace(placeId);
  }
  deleteObject(objectId: string): RobotVisualGraph {
    return this.mutations.deleteObject(objectId);
  }
  async purge(
    scope: RobotVisualMemoryPurgeScope,
  ): Promise<RobotVisualMemoryPurgeResult> {
    return this.mutations.purge(scope);
  }
  panoramaProgress(): {
    complete: boolean;
    placeId: string | null;
    sectorCount: number;
  } {
    return this.panoramas.panoramaProgress();
  }
  beginPanoramaSession(): void {
    return this.panoramas.beginPanoramaSession();
  }
  async captureStablePanoramaSector(): Promise<{
    added: boolean;
    complete: boolean;
    sectorCount: number;
  }> {
    return this.panoramas.captureStablePanoramaSector();
  }
  markPanoramaIncomplete(): void {
    return this.panoramas.markPanoramaIncomplete();
  }
  markCurrentPortBlocked(): void {
    return this.panoramas.markCurrentPortBlocked();
  }
}
export { RobotVisualTopologyError } from './visual-topology/errors.js';
export {
  classifyVisualMotion,
  hammingDistance,
  isAcceptedPlaceMatch,
  isCorroboratedPanoramaMatch,
  isUsableVisual,
} from './visual-topology/policy.js';
export type {
  RobotVisualMemoryPurgeResult,
  RobotVisualMotionState,
  RobotVisualObservation,
} from './visual-topology/records.js';

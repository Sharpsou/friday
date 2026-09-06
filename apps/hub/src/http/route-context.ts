import type {
  RobotControlPreferencesSchema,
  RobotDisplayPreferencesSchema,
  RobotPanoramaPreferencesSchema,
} from '@friday/contracts';
import type { AssistantArchiveService } from '../assistant/assistant-service.js';
import type { ClosedAuthService } from '../auth/auth-service.js';
import type { openDatabase } from '../db/database.js';
import type { GroceryClassificationService } from '../groceries/grocery-classification-service.js';
import type { GroceryPhotoTranscriptionEngine } from '../groceries/ollama-photo-transcription-engine.js';
import type { RobotAutonomyService } from '../robot/robot-autonomy.js';
import type { RobotController } from '../robot/robot-controller.js';
import type { RobotVisualTopologyService } from '../robot/robot-visual-topology.js';
import type { SyncService } from '../sync/sync-service.js';
import type { WatchService } from '../watch/watch-service.js';

export interface HubRouteContext {
  closedAuth: ClosedAuthService;
  database: ReturnType<typeof openDatabase>;
  sync: SyncService;
  groceryClassification: GroceryClassificationService;
  groceryPhotoTranscription: GroceryPhotoTranscriptionEngine;
  assistant: AssistantArchiveService;
  watch: WatchService;
  robot: RobotController;
  robotAutonomy: RobotAutonomyService;
  robotTopology: RobotVisualTopologyService;
  acceptsTrustedMutationOrigin(headers: {
    origin?: string | undefined;
    'sec-fetch-site'?: string | undefined;
  }): boolean;
  acceptsRobotCommandRate(deviceId: string, limit: number): boolean;
  readRobotDisplayPreferences(): ReturnType<
    typeof RobotDisplayPreferencesSchema.parse
  >;
  readRobotControlPreferences(): ReturnType<
    typeof RobotControlPreferencesSchema.parse
  >;
  readRobotPanoramaPreferences(): ReturnType<
    typeof RobotPanoramaPreferencesSchema.parse
  >;
}

import { type RobotDirection, type RobotState } from '@friday/contracts';
import type Database from 'better-sqlite3';
import type { RobotController } from '../robot-controller.js';
import type { RobotVisualTopologyService } from '../robot-visual-topology.js';
import type { AutonomyCommands } from './commands.js';
import { recoverySituationKey, type RecoveryCapture } from './policy.js';
import type { AutonomyState } from './state.js';
export class AutonomyRecovery {
  constructor(
    private readonly database: Database.Database,
    private readonly householdId: string,
    private readonly state: AutonomyState,
    private readonly commands: AutonomyCommands,
    private readonly topology: RobotVisualTopologyService,
    private readonly robot: RobotController,
  ) {}
  persistRecovery(capture: RecoveryCapture): void {
    const now = new Date().toISOString();
    const commands = capture.commands.map((command) => ({
      direction: command.direction,
      intensity: Math.min(0.2, command.intensity),
      steering: command.steering,
      maxDurationMs: Math.min(140, command.maxDurationMs),
    }));
    this.database
      .prepare(
        `INSERT INTO robot_recovery_skills(
           id, household_id, situation_key, commands_json, command_count,
           success_count, failure_count, confidence, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 0, 0.6, ?, ?)
         ON CONFLICT(household_id, situation_key)
         DO UPDATE SET commands_json = excluded.commands_json,
                       command_count = excluded.command_count,
                       success_count = success_count + 1,
                       confidence = MIN(1, confidence + 0.1),
                       updated_at = excluded.updated_at`,
      )
      .run(
        crypto.randomUUID(),
        this.householdId,
        capture.situationKey,
        JSON.stringify(commands),
        commands.length,
        now,
        now,
      );
  }
  findRecovery(
    situationKey: string,
  ): { commands_json: string; id: string } | null {
    return (
      (this.database
        .prepare(
          `SELECT id, commands_json FROM robot_recovery_skills
            WHERE household_id = ? AND situation_key = ? AND confidence >= 0.6`,
        )
        .get(this.householdId, situationKey) as
        { commands_json: string; id: string } | undefined) ?? null
    );
  }
  async applyRecovery(state: RobotState): Promise<void> {
    const epoch = this.state.controlEpoch;

    if (!this.state.replay) {
      const skill = this.findRecovery(
        recoverySituationKey(state, this.state.motionState),
      );
      if (!skill) return;
      const raw = JSON.parse(skill.commands_json) as Array<{
        direction: RobotDirection;
        intensity: number;
        maxDurationMs: number;
        steering: number;
      }>;
      this.state.replay = {
        commands: raw.map((command) => ({
          ...this.commands.driveCommand(
            command.direction,
            Math.min(command.intensity, this.state.powerPercent / 100),
            command.maxDurationMs,
          ),
          steering: command.steering,
        })),
        index: 0,
      };
    }
    const command = this.state.replay.commands[this.state.replay.index];
    if (!command) {
      this.state.replay = null;
      return;
    }
    if (
      command.direction === 'forward' &&
      (state.telemetry.irLeftClear === false ||
        state.telemetry.irRightClear === false)
    ) {
      this.state.replay = null;
      return;
    }
    this.topology.recordDriveCommand(command.direction);
    await this.robot.drive(this.commands.refreshCommand(command));
    if (epoch !== this.state.controlEpoch) return;
    this.state.replay.index += 1;
  }
}

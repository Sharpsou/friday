import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import {
  GROCERY_TAXONOMY_ID,
  GroceryClassificationApplyResponseSchema,
  GroceryClassificationJobSchema,
  GroceryClassificationPullResponseSchema,
  GroceryClassificationRecordSchema,
  type GroceryClassificationApplyRequest,
  type GroceryClassificationApplyResponse,
  type GroceryClassificationJob,
  type GroceryClassificationProposalItem,
  type GroceryClassificationPullResponse,
} from '@friday/contracts';

import type { GroceryClassificationEngine } from './ollama-classification-engine.js';
import { classifyKnownGroceryLabel } from './grocery-classification-rules.js';
import {
  groceryLabelFingerprint,
  normalizeGroceryLabel,
} from './grocery-label.js';

const JOB_RETENTION_MS = 24 * 60 * 60 * 1_000;
const CLASSIFICATION_BATCH_SIZE = 30;

interface GrocerySnapshotItem {
  itemId: string;
  groceryRevision: number;
  label: string;
  labelFingerprint: string;
}

interface JobRow {
  id: string;
  taxonomy_id: string;
  status: GroceryClassificationJob['status'];
  progress_completed: number;
  progress_total: number;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface RuleRow {
  normalized_label: string;
  store_family_id: string;
  aisle_id: string;
}

interface CurrentClassificationRow {
  revision: number;
  source: 'llm' | 'rule' | 'manual';
}

export class GroceryClassificationNotFoundError extends Error {}

export class GroceryClassificationService {
  private activeController: AbortController | null = null;
  private processing: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly database: Database.Database,
    private readonly engine: GroceryClassificationEngine,
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE grocery_classification_jobs
            SET status = 'queued', updated_at = ?, cancel_requested = 0
          WHERE status = 'running'`,
      )
      .run(now);
    this.database
      .prepare(
        `UPDATE grocery_classification_jobs
            SET status = 'cancelled', updated_at = ?, result_json = NULL
          WHERE status = 'cancelling'`,
      )
      .run(now);
    this.schedule();
  }

  createOrGetActiveJob(
    householdId: string,
    profileId: string,
  ): GroceryClassificationJob {
    this.purgeExpiredJobs();
    const active = this.database
      .prepare(
        `SELECT * FROM grocery_classification_jobs
          WHERE household_id = ? AND taxonomy_id = ?
            AND status IN ('queued', 'running', 'cancelling')
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(householdId, GROCERY_TAXONOMY_ID) as JobRow | undefined;
    if (active) return this.toJob(active);

    const groceries = this.database
      .prepare(
        `SELECT grocery.id, grocery.revision, grocery.label
           FROM grocery_items grocery
           LEFT JOIN grocery_classifications classification
             ON classification.item_id = grocery.id
          WHERE grocery.household_id = ?
            AND grocery.checked_at IS NULL
            AND grocery.deleted_at IS NULL
            AND grocery.manual_store_family_id IS NULL
            AND grocery.manual_aisle_id IS NULL
            AND classification.item_id IS NULL
          ORDER BY grocery.created_at, grocery.id`,
      )
      .all(householdId) as Array<{
      id: string;
      revision: number;
      label: string;
    }>;
    const snapshot: GrocerySnapshotItem[] = groceries.map((item) => ({
      itemId: item.id,
      groceryRevision: item.revision,
      label: item.label,
      labelFingerprint: groceryLabelFingerprint(item.label),
    }));
    const id = randomUUID();
    const now = new Date().toISOString();
    const completed = snapshot.length === 0;
    const expiresAt = completed
      ? new Date(Date.now() + JOB_RETENTION_MS).toISOString()
      : null;
    this.database
      .prepare(
        `INSERT INTO grocery_classification_jobs (
           id, household_id, taxonomy_id, requested_by_profile_id, status,
           progress_completed, progress_total, snapshot_json, result_json,
           created_at, updated_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        householdId,
        GROCERY_TAXONOMY_ID,
        profileId,
        completed ? 'completed' : 'queued',
        0,
        snapshot.length,
        JSON.stringify(snapshot),
        completed ? '[]' : null,
        now,
        now,
        expiresAt,
      );
    this.schedule();
    return this.getJob(householdId, id);
  }

  getJob(householdId: string, jobId: string): GroceryClassificationJob {
    const row = this.database
      .prepare(
        'SELECT * FROM grocery_classification_jobs WHERE id = ? AND household_id = ?',
      )
      .get(jobId, householdId) as JobRow | undefined;
    if (!row) throw new GroceryClassificationNotFoundError('Job introuvable.');
    return this.toJob(row);
  }

  cancelJob(householdId: string, jobId: string): GroceryClassificationJob {
    const row = this.database
      .prepare(
        'SELECT * FROM grocery_classification_jobs WHERE id = ? AND household_id = ?',
      )
      .get(jobId, householdId) as JobRow | undefined;
    if (!row) throw new GroceryClassificationNotFoundError('Job introuvable.');
    if (!['queued', 'running', 'cancelling'].includes(row.status)) {
      return this.toJob(row);
    }

    const now = new Date().toISOString();
    if (row.status === 'queued') {
      this.database
        .prepare(
          `UPDATE grocery_classification_jobs
              SET status = 'cancelled', cancel_requested = 1,
                  result_json = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .run(now, jobId);
    } else {
      this.database
        .prepare(
          `UPDATE grocery_classification_jobs
              SET status = 'cancelling', cancel_requested = 1, updated_at = ?
            WHERE id = ?`,
        )
        .run(now, jobId);
      this.activeController?.abort(new Error('Classement interrompu.'));
    }
    return this.getJob(householdId, jobId);
  }

  apply(
    householdId: string,
    profileId: string,
    request: GroceryClassificationApplyRequest,
  ): GroceryClassificationApplyResponse {
    const jobRow = this.database
      .prepare(
        `SELECT status, result_json, applied_response_json, expires_at
           FROM grocery_classification_jobs
          WHERE id = ? AND household_id = ?`,
      )
      .get(request.jobId, householdId) as
      | {
          status: string;
          result_json: string | null;
          applied_response_json: string | null;
          expires_at: string | null;
        }
      | undefined;
    if (!jobRow)
      throw new GroceryClassificationNotFoundError('Job introuvable.');
    if (jobRow.applied_response_json) {
      return GroceryClassificationApplyResponseSchema.parse(
        JSON.parse(jobRow.applied_response_json),
      );
    }
    if (
      jobRow.status !== 'completed' ||
      !jobRow.result_json ||
      (jobRow.expires_at && Date.parse(jobRow.expires_at) <= Date.now())
    ) {
      throw new Error('Cette proposition n’est plus applicable.');
    }

    const proposal = JSON.parse(
      jobRow.result_json,
    ) as GroceryClassificationProposalItem[];
    const proposalById = new Map(proposal.map((item) => [item.itemId, item]));
    const submittedIds = new Set<string>();
    for (const submitted of request.classifications) {
      if (submittedIds.has(submitted.itemId)) {
        throw new Error('Un produit ne peut être classé qu’une fois.');
      }
      submittedIds.add(submitted.itemId);
      if (!proposalById.has(submitted.itemId)) {
        throw new Error('Produit absent de la proposition.');
      }
    }

    return this.database.transaction(() => {
      const applied = [];
      const skippedItemIds: string[] = [];
      const now = new Date().toISOString();

      for (const submitted of request.classifications) {
        const suggested = proposalById.get(submitted.itemId);
        if (!suggested) continue;
        const grocery = this.database
          .prepare(
            `SELECT revision, label, checked_at, deleted_at
               FROM grocery_items WHERE id = ? AND household_id = ?`,
          )
          .get(submitted.itemId, householdId) as
          | {
              revision: number;
              label: string;
              checked_at: string | null;
              deleted_at: string | null;
            }
          | undefined;
        const current = this.database
          .prepare(
            'SELECT revision, source FROM grocery_classifications WHERE item_id = ?',
          )
          .get(submitted.itemId) as CurrentClassificationRow | undefined;
        const classificationRevisionMatches =
          (current?.revision ?? null) ===
          submitted.expectedClassificationRevision;
        if (
          !grocery ||
          grocery.checked_at !== null ||
          grocery.deleted_at !== null ||
          grocery.revision !== suggested.groceryRevision ||
          groceryLabelFingerprint(grocery.label) !==
            suggested.labelFingerprint ||
          !classificationRevisionMatches
        ) {
          skippedItemIds.push(submitted.itemId);
          continue;
        }

        const corrected =
          submitted.storeFamilyId !== suggested.storeFamilyId ||
          submitted.aisleId !== suggested.aisleId;
        if (current?.source === 'manual' && !corrected) {
          skippedItemIds.push(submitted.itemId);
          continue;
        }
        const source = corrected ? 'manual' : suggested.source;
        const classification = GroceryClassificationRecordSchema.parse({
          itemId: submitted.itemId,
          taxonomyId: GROCERY_TAXONOMY_ID,
          storeFamilyId: submitted.storeFamilyId,
          aisleId: submitted.aisleId,
          source,
          confidence: corrected ? 1 : suggested.confidence,
          itemRevision: grocery.revision,
          labelFingerprint: suggested.labelFingerprint,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: now,
          updatedByProfileId: profileId,
        });
        this.database
          .prepare(
            `INSERT INTO grocery_classifications (
               item_id, household_id, taxonomy_id, store_family_id, aisle_id,
               source, confidence, item_revision, label_fingerprint, revision,
               updated_at, updated_by_profile_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(item_id) DO UPDATE SET
               taxonomy_id = excluded.taxonomy_id,
               store_family_id = excluded.store_family_id,
               aisle_id = excluded.aisle_id,
               source = excluded.source,
               confidence = excluded.confidence,
               item_revision = excluded.item_revision,
               label_fingerprint = excluded.label_fingerprint,
               revision = excluded.revision,
               updated_at = excluded.updated_at,
               updated_by_profile_id = excluded.updated_by_profile_id`,
          )
          .run(
            classification.itemId,
            householdId,
            classification.taxonomyId,
            classification.storeFamilyId,
            classification.aisleId,
            classification.source,
            classification.confidence,
            classification.itemRevision,
            classification.labelFingerprint,
            classification.revision,
            classification.updatedAt,
            classification.updatedByProfileId,
          );
        if (corrected) {
          this.database
            .prepare(
              `INSERT INTO grocery_classification_rules (
                 household_id, taxonomy_id, normalized_label, store_family_id,
                 aisle_id, updated_at, updated_by_profile_id
               ) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(household_id, taxonomy_id, normalized_label)
               DO UPDATE SET store_family_id = excluded.store_family_id,
                 aisle_id = excluded.aisle_id, updated_at = excluded.updated_at,
                 updated_by_profile_id = excluded.updated_by_profile_id`,
            )
            .run(
              householdId,
              GROCERY_TAXONOMY_ID,
              normalizeGroceryLabel(grocery.label),
              classification.storeFamilyId,
              classification.aisleId,
              now,
              profileId,
            );
        }
        this.database
          .prepare(
            `INSERT INTO grocery_classification_change_log (
               household_id, item_id, payload_json, created_at
             ) VALUES (?, ?, ?, ?)`,
          )
          .run(
            householdId,
            classification.itemId,
            JSON.stringify(classification),
            now,
          );
        applied.push(classification);
      }

      const cursor = this.latestCursor(householdId);
      const response = GroceryClassificationApplyResponseSchema.parse({
        classifications: applied,
        skippedItemIds,
        cursor,
      });
      this.database
        .prepare(
          `UPDATE grocery_classification_jobs
              SET applied_response_json = ?, applied_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(JSON.stringify(response), now, now, request.jobId);
      return response;
    })();
  }

  pull(householdId: string, after: number): GroceryClassificationPullResponse {
    const rows = this.database
      .prepare(
        `SELECT sequence, payload_json
           FROM grocery_classification_change_log
          WHERE household_id = ? AND sequence > ?
          ORDER BY sequence LIMIT 500`,
      )
      .all(householdId, after) as Array<{
      sequence: number;
      payload_json: string;
    }>;
    return GroceryClassificationPullResponseSchema.parse({
      changes: rows.map((row) => ({
        cursor: row.sequence,
        classification: JSON.parse(row.payload_json) as unknown,
      })),
      cursor: rows.at(-1)?.sequence ?? after,
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.activeController?.abort(new Error('Arrêt du hub.'));
    await this.processing;
  }

  private schedule(): void {
    if (this.stopping || this.processing) return;
    this.processing = Promise.resolve()
      .then(() => this.processQueue())
      .finally(() => {
        this.processing = null;
        if (!this.stopping && this.hasQueuedJob()) this.schedule();
      });
  }

  private async processQueue(): Promise<void> {
    const job = this.database
      .prepare(
        `SELECT id, household_id, snapshot_json
           FROM grocery_classification_jobs
          WHERE status = 'queued'
          ORDER BY created_at LIMIT 1`,
      )
      .get() as
      { id: string; household_id: string; snapshot_json: string } | undefined;
    if (!job || this.stopping) return;

    const now = new Date().toISOString();
    const claimed = this.database
      .prepare(
        `UPDATE grocery_classification_jobs
            SET status = 'running', updated_at = ?
          WHERE id = ? AND status = 'queued'`,
      )
      .run(now, job.id);
    if (claimed.changes !== 1) return;

    const controller = new AbortController();
    this.activeController = controller;
    try {
      const snapshot = JSON.parse(job.snapshot_json) as GrocerySnapshotItem[];
      const ruleRows = this.database
        .prepare(
          `SELECT normalized_label, store_family_id, aisle_id
             FROM grocery_classification_rules
            WHERE household_id = ? AND taxonomy_id = ?`,
        )
        .all(job.household_id, GROCERY_TAXONOMY_ID) as RuleRow[];
      const rules = new Map(
        ruleRows.map((rule) => [rule.normalized_label, rule] as const),
      );
      const proposals = new Map<
        string,
        Omit<
          GroceryClassificationProposalItem,
          'expectedClassificationRevision'
        >
      >();
      const unresolved: GrocerySnapshotItem[] = [];
      for (const item of snapshot) {
        const rule = rules.get(normalizeGroceryLabel(item.label));
        if (rule) {
          proposals.set(item.itemId, {
            ...item,
            storeFamilyId: rule.store_family_id,
            aisleId: rule.aisle_id,
            confidence: 1,
            source: 'rule',
          });
        } else {
          const builtIn = classifyKnownGroceryLabel(item.label);
          if (builtIn) {
            proposals.set(item.itemId, {
              ...item,
              ...builtIn,
              confidence: 0.98,
              source: 'rule',
            });
            continue;
          }
          unresolved.push(item);
        }
      }
      this.updateProgress(job.id, proposals.size, snapshot.length);

      for (
        let offset = 0;
        offset < unresolved.length;
        offset += CLASSIFICATION_BATCH_SIZE
      ) {
        if (controller.signal.aborted || this.isCancellationRequested(job.id)) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const batch = unresolved.slice(
          offset,
          offset + CLASSIFICATION_BATCH_SIZE,
        );
        const choices = await this.engine.classify(
          batch.map((item) => item.label),
          controller.signal,
        );
        if (choices.length !== batch.length) {
          throw new Error('Le modèle a omis des produits.');
        }
        batch.forEach((item, index) => {
          const choice = choices[index];
          if (!choice) throw new Error('Classement incomplet.');
          proposals.set(item.itemId, {
            ...item,
            ...choice,
            source: 'llm',
          });
        });
        this.updateProgress(job.id, proposals.size, snapshot.length);
      }

      const orderedProposal = snapshot.map((item) => {
        const proposal = proposals.get(item.itemId);
        if (!proposal) throw new Error('Classement incomplet.');
        const current = this.database
          .prepare(
            'SELECT revision FROM grocery_classifications WHERE item_id = ?',
          )
          .get(item.itemId) as { revision: number } | undefined;
        return {
          ...proposal,
          expectedClassificationRevision: current?.revision ?? null,
        };
      });
      const completedAt = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE grocery_classification_jobs
              SET status = 'completed', progress_completed = progress_total,
                  result_json = ?, error_code = NULL, error_message = NULL,
                  updated_at = ?, expires_at = ?
            WHERE id = ?`,
        )
        .run(
          JSON.stringify(orderedProposal),
          completedAt,
          new Date(Date.now() + JOB_RETENTION_MS).toISOString(),
          job.id,
        );
    } catch (error) {
      if (this.stopping) return;
      const cancelled =
        controller.signal.aborted || this.isCancellationRequested(job.id);
      const failedAt = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE grocery_classification_jobs
              SET status = ?, result_json = NULL, error_code = ?,
                  error_message = ?, updated_at = ?, expires_at = ?
            WHERE id = ?`,
        )
        .run(
          cancelled ? 'cancelled' : 'failed',
          cancelled ? null : 'classification_failed',
          cancelled
            ? null
            : error instanceof Error
              ? error.message
              : 'Classement impossible.',
          failedAt,
          new Date(Date.now() + JOB_RETENTION_MS).toISOString(),
          job.id,
        );
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  private updateProgress(
    jobId: string,
    completed: number,
    total: number,
  ): void {
    this.database
      .prepare(
        `UPDATE grocery_classification_jobs
            SET progress_completed = ?, progress_total = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(completed, total, new Date().toISOString(), jobId);
  }

  private isCancellationRequested(jobId: string): boolean {
    const row = this.database
      .prepare(
        'SELECT cancel_requested FROM grocery_classification_jobs WHERE id = ?',
      )
      .get(jobId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  private hasQueuedJob(): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT 1 FROM grocery_classification_jobs WHERE status = 'queued' LIMIT 1",
        )
        .get(),
    );
  }

  private latestCursor(householdId: string): number {
    const row = this.database
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS cursor
           FROM grocery_classification_change_log WHERE household_id = ?`,
      )
      .get(householdId) as { cursor: number };
    return row.cursor;
  }

  private purgeExpiredJobs(): void {
    this.database
      .prepare(
        `DELETE FROM grocery_classification_jobs
          WHERE expires_at IS NOT NULL AND expires_at <= ?
            AND status IN ('completed', 'failed', 'cancelled')`,
      )
      .run(new Date().toISOString());
  }

  private toJob(row: JobRow): GroceryClassificationJob {
    return GroceryClassificationJobSchema.parse({
      id: row.id,
      taxonomyId: row.taxonomy_id,
      status: row.status,
      progress: {
        completed: row.progress_completed,
        total: row.progress_total,
      },
      proposal: row.result_json
        ? (JSON.parse(row.result_json) as unknown)
        : null,
      error:
        row.error_code && row.error_message
          ? { code: row.error_code, message: row.error_message }
          : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    });
  }
}

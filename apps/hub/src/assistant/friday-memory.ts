import type Database from 'better-sqlite3';

export interface FridayGroundedFact {
  confidence: number | null;
  detail: string;
  id: string;
  observedAt: string | null;
  source: 'agenda' | 'budget' | 'courses' | 'foyer' | 'robot';
  title: string;
}

interface HouseholdRow {
  household_id: string;
}

const MAX_FACTS = 60;

export class FridayMemoryReader {
  constructor(private readonly database: Database.Database) {}

  query(profileId: string, question: string): FridayGroundedFact[] {
    const membership = this.database
      .prepare(
        'SELECT household_id FROM household_members WHERE profile_id = ?',
      )
      .get(profileId) as HouseholdRow | undefined;
    if (!membership) return [];
    const normalized = normalize(question);
    const requested = requestedSources(normalized);
    const facts: FridayGroundedFact[] = [];
    const add = (fact: Omit<FridayGroundedFact, 'id'>): void => {
      if (facts.length >= MAX_FACTS) return;
      facts.push({ ...fact, id: `F${(facts.length + 1).toString()}` });
    };

    if (requested.has('agenda'))
      this.readAgenda(membership.household_id, normalized).forEach(add);
    if (requested.has('courses'))
      this.readGroceries(membership.household_id).forEach(add);
    if (requested.has('budget'))
      this.readBudget(membership.household_id).forEach(add);
    if (requested.has('foyer'))
      this.readHousehold(membership.household_id).forEach(add);
    if (requested.has('robot'))
      this.readRobot(membership.household_id, normalized).forEach(add);
    return facts.slice(0, MAX_FACTS);
  }

  private readAgenda(
    householdId: string,
    question: string,
  ): Array<Omit<FridayGroundedFact, 'id'>> {
    const rows = this.database
      .prepare(
        `SELECT title, due_date, due_time, status, assignee_profile_id, note, updated_at
           FROM tasks
          WHERE household_id = ? AND deleted_at IS NULL
          ORDER BY status = 'todo' DESC, due_date IS NULL, due_date, due_time
          LIMIT 20`,
      )
      .all(householdId) as Array<{
      assignee_profile_id: string | null;
      due_date: string | null;
      due_time: string | null;
      note: string | null;
      status: string;
      title: string;
      updated_at: string;
    }>;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    return rows
      .filter((row) => {
        if (question.includes('demain')) return row.due_date === tomorrow;
        if (question.includes('aujourd')) return row.due_date === today;
        return true;
      })
      .map((row) => ({
        source: 'agenda' as const,
        title: row.title,
        detail: safeText(
          `statut=${row.status}; date=${row.due_date ?? 'non datée'}; heure=${row.due_time ?? 'non précisée'}; responsable=${row.assignee_profile_id ?? 'non attribué'}${row.note ? `; note=${row.note}` : ''}`,
        ),
        observedAt: row.updated_at,
        confidence: 1,
      }));
  }

  private readGroceries(
    householdId: string,
  ): Array<Omit<FridayGroundedFact, 'id'>> {
    return (
      this.database
        .prepare(
          `SELECT label, quantity_text, checked_at, updated_at
             FROM grocery_items
            WHERE household_id = ? AND deleted_at IS NULL
            ORDER BY checked_at IS NULL DESC, created_at
            LIMIT 30`,
        )
        .all(householdId) as Array<{
        checked_at: string | null;
        label: string;
        quantity_text: string | null;
        updated_at: string;
      }>
    ).map((row) => ({
      source: 'courses' as const,
      title: row.label,
      detail: safeText(
        `quantité=${row.quantity_text ?? 'non précisée'}; état=${row.checked_at ? 'acheté' : 'à acheter'}`,
      ),
      observedAt: row.updated_at,
      confidence: 1,
    }));
  }

  private readBudget(
    householdId: string,
  ): Array<Omit<FridayGroundedFact, 'id'>> {
    const tables = [
      ['budget_entries', 'Mouvement'],
      ['budget_recurring_templates', 'Récurrence'],
      ['budget_envelopes', 'Enveloppe'],
      ['budget_planned_expenses', 'Provision'],
      ['budget_savings_months', 'Épargne'],
    ] as const;
    const facts: Array<Omit<FridayGroundedFact, 'id'>> = [];
    for (const [table, label] of tables) {
      const rows = this.database
        .prepare(
          `SELECT id, payload_json, updated_at FROM ${table}
            WHERE household_id = ? ORDER BY updated_at DESC LIMIT 12`,
        )
        .all(householdId) as Array<{
        id: string;
        payload_json: string;
        updated_at: string;
      }>;
      for (const row of rows)
        facts.push({
          source: 'budget',
          title: `${label} ${row.id.slice(0, 8)}`,
          detail: safeText(row.payload_json),
          observedAt: row.updated_at,
          confidence: 1,
        });
    }
    return facts;
  }

  private readHousehold(
    householdId: string,
  ): Array<Omit<FridayGroundedFact, 'id'>> {
    return (
      this.database
        .prepare(
          `SELECT u.name, hm.profile_id, hm.role
             FROM household_members hm JOIN "user" u ON u.id = hm.user_id
            WHERE hm.household_id = ? ORDER BY hm.role DESC`,
        )
        .all(householdId) as Array<{
        name: string;
        profile_id: string;
        role: string;
      }>
    ).map((row) => ({
      source: 'foyer' as const,
      title: row.name,
      detail: `profil=${row.profile_id}; rôle=${row.role}`,
      observedAt: null,
      confidence: 1,
    }));
  }

  private readRobot(
    householdId: string,
    question: string,
  ): Array<Omit<FridayGroundedFact, 'id'>> {
    const facts: Array<Omit<FridayGroundedFact, 'id'>> = [];
    const objectRows = this.database
      .prepare(
        `SELECT o.display_name, o.class_label, o.confidence,
                o.sighting_count, o.last_seen_at, o.place_id,
                p.label AS place_label, p.status AS place_status
           FROM robot_visual_objects o
           JOIN robot_visual_places p ON p.id = o.place_id
          WHERE o.household_id = ? AND p.status != 'ambiguous'
          ORDER BY o.last_seen_at DESC LIMIT 30`,
      )
      .all(householdId) as Array<{
      class_label: string;
      confidence: number;
      display_name: string;
      last_seen_at: string;
      place_id: string;
      place_label: string | null;
      place_status: string;
      sighting_count: number;
    }>;
    for (const row of objectRows) {
      const searchable = normalize(`${row.display_name} ${row.class_label}`);
      if (
        mentionsSpecificObject(question) &&
        !question
          .split(' ')
          .some((term) => term.length > 3 && searchable.includes(term))
      )
        continue;
      facts.push({
        source: 'robot',
        title: row.display_name,
        detail: `classe=${row.class_label}; lieu visuel=${row.place_label ?? row.place_id.slice(0, 8)}; observations=${row.sighting_count.toString()}; lieu=${row.place_status}`,
        observedAt: row.last_seen_at,
        confidence: row.confidence,
      });
    }
    return facts;
  }
}

function requestedSources(question: string): Set<FridayGroundedFact['source']> {
  const sources = new Set<FridayGroundedFact['source']>();
  if (hasAny(question, ['agenda', 'tache', 'rendez', 'demain', 'aujourd']))
    sources.add('agenda');
  if (hasAny(question, ['course', 'acheter', 'manque', 'liste']))
    sources.add('courses');
  if (hasAny(question, ['budget', 'depense', 'revenu', 'epargne', 'enveloppe']))
    sources.add('budget');
  if (hasAny(question, ['profil', 'foyer', 'famille', 'adulte']))
    sources.add('foyer');
  if (
    hasAny(question, [
      'robot',
      'vu',
      'objet',
      'chaise',
      'ecran',
      'personne',
      'quelqu',
      'lumiere',
      'trouve',
      'salon',
      'piece',
      'trajet',
    ])
  )
    sources.add('robot');
  if (sources.size === 0)
    for (const source of [
      'agenda',
      'courses',
      'budget',
      'foyer',
      'robot',
    ] as const)
      sources.add(source);
  return sources;
}

function mentionsSpecificObject(question: string): boolean {
  return hasAny(question, ['ou est', 'trouve', 'chaise', 'ecran', 'objet']);
}

function hasAny(question: string, terms: string[]): boolean {
  return terms.some((term) => question.includes(term));
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr-FR');
}

function safeText(value: string): string {
  return value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
}

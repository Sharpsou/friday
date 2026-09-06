import type { Watch } from '@friday/contracts';

export const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function splitKeywords(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

export function sourceKindLabel(kind: string): string {
  return (
    {
      official: 'Officiel',
      research: 'Recherche',
      specialized_press: 'Presse spécialisée',
      general_press: 'Presse généraliste',
      community: 'Communauté',
    }[kind] ?? kind
  );
}

export function runStageLabel(stage: string): string {
  return (
    {
      queued: 'En attente',
      discovering: 'Recherche des sources',
      collecting: 'Collecte',
      extracting: 'Analyse des articles',
      clustering: 'Classement par thèmes',
      synthesizing: 'Rédaction de la synthèse',
      completed: 'Terminé',
      failed: 'Échec de la mise à jour',
    }[stage] ?? stage
  );
}

export function runTriggerLabel(trigger: string): string {
  return (
    {
      initialization: 'Initialisation',
      scheduled: 'Mise à jour planifiée',
      catch_up: 'Rattrapage',
      manual: 'Mise à jour manuelle',
      resume: 'Reprise',
    }[trigger] ?? trigger
  );
}

export function formatWatchSchedule(watch: Watch): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: watch.timeZone,
  }).format(new Date(watch.nextDigestAt));
}

export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

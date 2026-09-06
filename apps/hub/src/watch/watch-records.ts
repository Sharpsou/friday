import { type WatchSourceKind } from '@friday/contracts';

export type WatchRunTrigger =
  'initialization' | 'scheduled' | 'catch_up' | 'manual' | 'resume';

export interface WatchRow {
  baseline_completed_at: string | null;
  cadence: 'daily' | 'weekly';
  created_at: string;
  exclude_keywords_json: string;
  id: string;
  include_keywords_json: string;
  languages_json: string;
  last_web_search_at: string | null;
  local_time: string;
  memory_initialized_at: string | null;
  name: string;
  next_digest_at: string;
  profile_id: string;
  question: string;
  status: 'active' | 'paused';
  time_zone: string;
  updated_at: string;
  weekday: number | null;
}

export interface FeedRow {
  etag: string | null;
  feed_url: string;
  id: string;
  last_modified: string | null;
  site_url: string;
  title: string;
  source_mode: 'rss' | 'web';
}

export interface DiscoveryCandidate {
  feedUrl: string | null;
  id: string;
  kind: WatchSourceKind;
  language: string;
  reason: string;
  score: number;
  siteUrl: string;
  status: 'validated' | 'rejected';
  title: string;
}

export interface WatchAnalysisCandidate {
  canonical_url: string;
  excerpt: string;
  id: string;
  source_id: string;
  source_title: string;
  title: string;
}

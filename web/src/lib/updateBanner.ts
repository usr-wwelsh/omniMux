export interface UpdateCommit {
  hash: string;
  subject: string;
}

export interface UpdateStatus {
  available: boolean;
  current?: string | null;
  latest?: string | null;
  up_to_date?: boolean | null;
  commits?: UpdateCommit[];
  error?: string | null;
}

export interface UpdateProgress {
  available: boolean;
  phase?: string;
  percent?: number;
  log_tail?: string;
  error?: string | null;
}

export interface ApplyUpdateResult {
  accepted: boolean;
  reason?: string;
}

// Fails closed: anything unexpected about the status response (unconfigured,
// a git error on the host, an already-current repo) hides the banner rather
// than showing something confusing.
export function pendingCommits(status: UpdateStatus | null | undefined): UpdateCommit[] {
  if (!status || !status.available || status.error || status.up_to_date) return [];
  return status.commits ?? [];
}

export function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'starting':
      return 'Starting update…';
    case 'fetching':
      return 'Checking for updates…';
    case 'pulling':
      return 'Pulling changes…';
    case 'building':
      return 'Rebuilding (this can take a few minutes)…';
    case 'done':
      return 'Update complete — reloading…';
    case 'error':
      return 'Update failed';
    default:
      return 'Updating…';
  }
}

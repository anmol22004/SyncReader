import type { Location, Operation, Pending, Progress, SaveResult } from './types';
import { sameLocation } from './locations';
export type SyncState = 'synced' | 'saving' | 'local' | 'conflict' | 'error';
type Dependencies = {
  send: (op: Operation) => Promise<SaveResult>;
  persist: (pending: Pending) => Promise<void>;
  clear: () => Promise<void>;
  uuid: () => string;
  changed: (state: SyncState, conflict?: Progress, error?: string) => void;
  reopen?: () => Promise<{ sessionId: string; progress: Progress }>;
};
// Single-flight, immutable retries, and revision-based conflict handling.
export class ProgressSync {
  private sequence = 0;
  private operation: Operation | null = null;
  private nextLocation: Location | null = null;
  private running = false;
  private stopped = false;
  private conflict: Progress | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private persistence = Promise.resolve();
  location: Location | null;
  constructor(private userId: string, private bookId: string, private sessionId: string, public progress: Progress, private deps: Dependencies, pending?: Pending) {
    this.location = pending?.latestLocation || pending?.operation.location || progress.location;
    if (pending) { this.operation = pending.operation; this.nextLocation = pending.latestLocation || null; }
  }
  private snapshot() {
    const op = this.operation;
    if (!op) return;
    const pending: Pending = { key: `${this.userId}:${this.bookId}`, userId: this.userId, bookId: this.bookId, operation: { ...op }, latestLocation: this.nextLocation || undefined, savedAt: new Date().toISOString() };
    this.persistence = this.persistence.catch(() => {}).then(() => this.deps.persist(pending));
    return this.persistence;
  }
  private newOperation(location: Location): Operation {
    return { operationId: this.deps.uuid(), sessionId: this.sessionId, sequence: ++this.sequence, expectedRevision: this.progress.revision, location };
  }
  move(location: Location) {
    if (this.stopped || sameLocation(location, this.location)) return;
    this.location = location;
    if (this.operation) this.nextLocation = location;
    else this.operation = this.newOperation(location);
    void this.snapshot()?.catch(() => this.deps.changed('error', undefined, 'Device recovery storage is unavailable.'));
    if (this.conflict) { this.deps.changed('conflict', this.conflict); return; }
    this.deps.changed('saving');
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 800);
  }
  async flush(): Promise<void> {
    if (this.running || this.stopped || this.conflict || !this.operation) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = true;
    let accepted = false;
    let persisted = false;
    try {
      await this.snapshot();
      persisted = true;
      const result = await this.deps.send(this.operation);
      if (this.stopped) return;
      if (result.outcome !== 'accepted') {
        this.conflict = result.progress; this.deps.changed('conflict', result.progress); return;
      }
      this.progress = result.progress;
      accepted = true;
      const next = this.nextLocation;
      this.operation = null; this.nextLocation = null;
      if (next && !sameLocation(next, result.progress.location)) {
        this.operation = this.newOperation(next); await this.snapshot();
      } else {
        this.persistence = this.persistence.catch(() => {}).then(() => this.deps.clear()); await this.persistence;
        if (!this.operation) this.deps.changed('synced');
      }
    } catch (e) {
      if (!this.stopped && persisted && /Session expired|Session unavailable/i.test(e instanceof Error ? e.message : '') && this.deps.reopen) {
        try {
          const fresh = await this.deps.reopen();
          if (this.stopped) return;
          this.sessionId = fresh.sessionId; this.sequence = 0; this.conflict = fresh.progress;
          this.deps.changed('conflict', fresh.progress, 'Your old reader session expired. Choose which position to keep.'); return;
        } catch { /* Preserve pending data if reauthentication/reopening fails. */ }
      }
      if (!this.stopped) this.deps.changed(persisted && this.operation ? 'local' : 'error', undefined, e instanceof Error ? e.message : 'Save failed');
    } finally {
      this.running = false;
    }
    if (this.operation && !this.conflict && !this.stopped) {
      if (accepted) return this.flush();
      // On failure, back off. Online/focus events also retry the same payload.
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 5000);
    }
  }
  async observeRemote(remote: Progress) {
    if (this.stopped || this.running || remote.revision === this.progress.revision) return;
    if (sameLocation(remote.location, this.location) && !this.operation) { this.progress = remote; return; }
    this.conflict = remote;
    if (this.location && !this.operation) { this.operation = this.newOperation(this.location); await this.snapshot(); }
    this.deps.changed('conflict', remote);
  }
  async resolve(keepLocal: boolean): Promise<Location | null> {
    if (!this.conflict || this.running) return null;
    this.progress = this.conflict; this.conflict = null;
    this.operation = null; this.nextLocation = null;
    if (keepLocal && this.location) {
      this.operation = this.newOperation(this.location); await this.snapshot(); this.deps.changed('saving'); await this.flush(); return null;
    }
    this.location = this.progress.location;
    this.persistence = this.persistence.catch(() => {}).then(() => this.deps.clear()); await this.persistence;
    this.deps.changed('synced'); return this.location;
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}

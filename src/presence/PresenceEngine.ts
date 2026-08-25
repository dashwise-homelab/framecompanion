import { PresenceSource } from '../config/schema';
import { PresenceSnapshot, PresenceSourceState } from './types';

export type PresenceEngineOptions = {
  enabledSources: PresenceSource[];
  ownerAbsenceSources: PresenceSource[];
  debounceMs: number;
  now?: () => number;
};

export class PresenceEngine {
  private readonly now: () => number;
  private options: PresenceEngineOptions;
  private states: Partial<Record<PresenceSource, PresenceSourceState>> = {};
  private snapshot: PresenceSnapshot = {
    mainPresent: false,
    activeSources: [],
    ownerPresent: false,
    sources: {},
  };
  private pendingMain?: { value: boolean; since: number };

  constructor(options: PresenceEngineOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  configure(options: PresenceEngineOptions) {
    this.options = options;
    this.recompute(this.now());
  }

  update(source: PresenceSource, present: boolean, value?: number, confidence?: number, at = this.now()): PresenceSnapshot {
    this.states[source] = { source, present, value, confidence, updatedAt: at };
    this.recompute(at);
    return this.getSnapshot();
  }

  getSnapshot(): PresenceSnapshot {
    return { ...this.snapshot, activeSources: [...this.snapshot.activeSources], sources: { ...this.snapshot.sources } };
  }

  private recompute(at: number) {
    const enabled = new Set(this.options.enabledSources);
    const activeSources = this.options.enabledSources.filter((source) => this.states[source]?.present === true);
    const nextMain = activeSources.length > 0;
    if (nextMain !== this.snapshot.mainPresent) {
      if (!this.pendingMain || this.pendingMain.value !== nextMain) this.pendingMain = { value: nextMain, since: at };
      if (at - this.pendingMain.since >= this.options.debounceMs) {
        this.snapshot.mainPresent = nextMain;
        this.snapshot.lastTransitionAt = at;
        if (nextMain) this.snapshot.lastSource = activeSources[activeSources.length - 1];
        this.pendingMain = undefined;
      }
    } else {
      this.pendingMain = undefined;
    }

    const ownerSources = this.options.ownerAbsenceSources.filter((source) => enabled.has(source));
    this.snapshot.ownerPresent = ownerSources.some((source) => this.states[source]?.present === true);
    this.snapshot.activeSources = activeSources;
    this.snapshot.sources = { ...this.states };
  }
}

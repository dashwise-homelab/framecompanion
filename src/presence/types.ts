import { PresenceSource } from '../config/schema';

export type PresenceSourceState = {
  source: PresenceSource;
  present: boolean;
  value?: number;
  confidence?: number;
  updatedAt: number;
};

export type PresenceSnapshot = {
  mainPresent: boolean;
  activeSources: PresenceSource[];
  lastSource?: PresenceSource;
  lastTransitionAt?: number;
  ownerPresent: boolean;
  sources: Partial<Record<PresenceSource, PresenceSourceState>>;
};

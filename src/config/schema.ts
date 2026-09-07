export const CONFIG_VERSION = 1;

export type PresenceSource = 'light' | 'vibration';

export type FrameCompanionConfig = {
  version: number;
  deviceName: string;
  dashwiseUrl: string;
  pinnedPackages: string[];
  mqtt: {
    enabled: boolean;
    host: string;
    port: number;
    authEnabled: boolean;
    username: string;
    passwordSecretRef?: string;
    clientId: string;
    tlsEnabled: boolean;
    topicRoot: string;
    openBrowserUrl: string;
  };
  presence: {
    enabledSources: PresenceSource[];
    debounceMs: number;
    ownerAbsenceSources: PresenceSource[];
    screensaverTrigger: PresenceSource;
  };

  light: {
    enabled: boolean;
    spikeDeltaLux: number;
    spikePercent: number;
    activationMs: number;
    baselineTolerance: number;
    learningWindowMs: number;
  };
  vibration: {
    enabled: boolean;
    tolerance: number;
    activationMs: number;
    clearDelayMs: number;
    samplingMode: 'normal' | 'low-power' | 'high';
  };
  audio: {
    enabled: boolean;
    inputDeviceId?: number;
    clapDetection: boolean;
    sensitivity: number;
  };
};

export function defaultConfig(deviceId = 'device'): FrameCompanionConfig {
  return {
    version: CONFIG_VERSION,
    deviceName: 'FrameCompanion',
    dashwiseUrl: '',
    pinnedPackages: [],
    mqtt: {
      enabled: false,
      host: '',
      port: 1883,
      authEnabled: false,
      username: '',
      clientId: `framecompanion-${deviceId}`,
      tlsEnabled: false,
      topicRoot: `framecompanion/${deviceId}`,
      openBrowserUrl: '',
    },
    presence: {
      enabledSources: ['light', 'vibration'],
      debounceMs: 3_000,
      ownerAbsenceSources: ['light', 'vibration'],
      screensaverTrigger: 'light',
    },
    light: {
      enabled: false,
      spikeDeltaLux: 25,
      spikePercent: 100,
      activationMs: 1_000,
      baselineTolerance: 0.25,
      learningWindowMs: 30 * 60 * 1_000,
    },
    vibration: {
      enabled: false,
      tolerance: 0.2,
      activationMs: 500,
      clearDelayMs: 5_000,
      samplingMode: 'low-power',
    },
    audio: { enabled: false, clapDetection: true, sensitivity: 0.6 },
  };
}

function mergeConfig(base: FrameCompanionConfig, value: Partial<FrameCompanionConfig>): FrameCompanionConfig {
  return {
    ...base,
    ...value,
    mqtt: { ...base.mqtt, ...(value.mqtt ?? {}) },
    presence: { ...base.presence, ...(value.presence ?? {}) },

    light: { ...base.light, ...(value.light ?? {}) },
    vibration: { ...base.vibration, ...(value.vibration ?? {}) },
    audio: (() => {
      const audio = value.audio ?? {};
      const { breathingExperiment: _breathingExperiment, ...supportedAudio } = audio as typeof audio & { breathingExperiment?: boolean };
      return { ...base.audio, ...supportedAudio };
    })(),
    version: CONFIG_VERSION,
  };
}

export function migrateConfig(input: unknown, deviceId = 'device'): FrameCompanionConfig {
  const defaults = defaultConfig(deviceId);
  if (!input || typeof input !== 'object') return defaults;
  const value = input as Partial<FrameCompanionConfig> & { baseUrl?: string; bluetooth?: unknown; camera?: unknown; clips?: unknown; clipServer?: unknown; cameraServer?: unknown };
  const { bluetooth: _bluetooth, camera: _camera, clips: _clips, clipServer: _clipServer, cameraServer: _cameraServer, ...supported } = value;
  const presence = (supported.presence ?? {}) as { enabledSources?: unknown[]; ownerAbsenceSources?: unknown[]; screensaverTrigger?: unknown; debounceMs?: number };
  return mergeConfig(defaults, {
    ...supported,
    presence: {
      ...defaults.presence,
      ...presence,
      enabledSources: (presence.enabledSources ?? defaults.presence.enabledSources).filter((source: unknown): source is PresenceSource => source === 'light' || source === 'vibration'),
      ownerAbsenceSources: (presence.ownerAbsenceSources ?? defaults.presence.ownerAbsenceSources).filter((source: unknown): source is PresenceSource => source === 'light' || source === 'vibration'),
      screensaverTrigger: presence.screensaverTrigger === 'vibration' || presence.screensaverTrigger === 'light' ? presence.screensaverTrigger : defaults.presence.screensaverTrigger,
    },
    dashwiseUrl: supported.dashwiseUrl ?? value.baseUrl ?? defaults.dashwiseUrl,
    pinnedPackages: Array.isArray(supported.pinnedPackages) ? supported.pinnedPackages : defaults.pinnedPackages,
  });
}

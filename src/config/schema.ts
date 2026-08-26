export const CONFIG_VERSION = 1;

export type PresenceSource = 'bluetooth' | 'light' | 'vibration' | 'camera';
export type RetentionUnit = 'hours' | 'days';

export type BluetoothTarget = {
  id: string;
  name: string;
  minimumRssi: number;
  lostTimeoutMs: number;
  smoothing: number;
};

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
  };
  presence: {
    enabledSources: PresenceSource[];
    debounceMs: number;
    ownerAbsenceSources: PresenceSource[];
    screensaverTrigger: PresenceSource;
  };
  bluetooth: {
    enabled: boolean;
    devices: BluetoothTarget[];
    scanIntervalMs: number;
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
    breathingExperiment: boolean;
    sensitivity: number;
  };
  camera: {
    enabled: boolean;
    cameraId?: string;
    zoom: number;
    motionDetection: boolean;
    useAsPresence: boolean;
    sensitivity: number;
    fps: number;
  };
  clips: {
    enabled: boolean;
    directory?: string;
    retentionValue: number;
    retentionUnit: RetentionUnit;
    preRollSeconds: number;
    postMotionSeconds: number;
  };
  clipServer: {
    enabled: boolean;
    port: number;
    username: string;
    passwordSecretRef?: string;
    wifiOnly: boolean;
  };
  cameraServer: {
    enabled: boolean;
    port: number;
    username: string;
    passwordSecretRef?: string;
    mode: 'always' | 'absence-motion-only';
    wifiOnly: boolean;
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
    },
    presence: {
      enabledSources: ['bluetooth'],
      debounceMs: 3_000,
      ownerAbsenceSources: ['bluetooth', 'light', 'vibration'],
      screensaverTrigger: 'bluetooth',
    },
    bluetooth: { enabled: true, devices: [], scanIntervalMs: 10_000 },
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
    audio: { enabled: false, clapDetection: true, breathingExperiment: false, sensitivity: 0.6 },
    camera: {
      enabled: false,
      zoom: 1,
      motionDetection: true,
      useAsPresence: false,
      sensitivity: 9,
      fps: 3,
    },
    clips: {
      enabled: false,
      retentionValue: 1,
      retentionUnit: 'days',
      preRollSeconds: 0,
      postMotionSeconds: 10,
    },
    clipServer: { enabled: false, port: 8765, username: 'admin', wifiOnly: true },
    cameraServer: { enabled: false, port: 8766, username: 'camera', mode: 'absence-motion-only', wifiOnly: true },
  };
}

function mergeConfig(base: FrameCompanionConfig, value: Partial<FrameCompanionConfig>): FrameCompanionConfig {
  return {
    ...base,
    ...value,
    mqtt: { ...base.mqtt, ...(value.mqtt ?? {}) },
    presence: { ...base.presence, ...(value.presence ?? {}) },
    bluetooth: { ...base.bluetooth, ...(value.bluetooth ?? {}) },
    light: { ...base.light, ...(value.light ?? {}) },
    vibration: { ...base.vibration, ...(value.vibration ?? {}) },
    audio: { ...base.audio, ...(value.audio ?? {}) },
    camera: { ...base.camera, ...(value.camera ?? {}) },
    clips: { ...base.clips, ...(value.clips ?? {}) },
    clipServer: { ...base.clipServer, ...(value.clipServer ?? {}) },
    cameraServer: { ...base.cameraServer, ...(value.cameraServer ?? {}) },
    version: CONFIG_VERSION,
  };
}

export function migrateConfig(input: unknown, deviceId = 'device'): FrameCompanionConfig {
  const defaults = defaultConfig(deviceId);
  if (!input || typeof input !== 'object') return defaults;
  const value = input as Partial<FrameCompanionConfig> & { baseUrl?: string };
  return mergeConfig(defaults, {
    ...value,
    dashwiseUrl: value.dashwiseUrl ?? value.baseUrl ?? defaults.dashwiseUrl,
    pinnedPackages: Array.isArray(value.pinnedPackages) ? value.pinnedPackages : defaults.pinnedPackages,
  });
}

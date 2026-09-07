import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type CapabilitySnapshot = {
  light: boolean;
  vibration: boolean;
  microphone: boolean;
  secureStorage: boolean;
};

export type NativeStatus = {
  mqttState: 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';
  lastError?: string;
  ambientLightLux?: number;
  vibrationLevel?: number;
  lightPresence?: boolean;
  vibrationPresence?: boolean;
  audioEnergy?: number;
  vibrationBaseline?: number;
  vibrationThreshold?: number;
  vibrationCalibrating?: boolean;
  batteryPercent?: number;
  thermalStatus?: number;

  volumePercent?: number;
  displayOn?: boolean;
  displayAdminActive?: boolean;
  brightnessPercent?: number;
  autoBrightness?: boolean;
  canWriteSettings?: boolean;
};

export type FrameCompanionNative = {
  getCapabilities?: () => Promise<CapabilitySnapshot>;
  configure?: (configJson: string) => Promise<void>;
  startService?: () => Promise<void>;
  stopService?: () => Promise<void>;
  testMqtt?: (configJson: string) => Promise<string>;
  requestPermissions?: (features: string[]) => Promise<string[]>;
  getStatus?: () => Promise<NativeStatus>;
  resetLightBaseline?: () => Promise<void>;

  calibrateVibration?: (durationMs?: number) => Promise<void>;
  getLocalIp?: () => Promise<string | null>;
  getAudioInputs?: () => Promise<Array<{ id: number; name: string }>>;
  isDisplayAdminActive?: () => Promise<boolean>;
  requestDisplayAdmin?: () => Promise<void>;
  canWriteSettings?: () => Promise<boolean>;
  requestWriteSettings?: () => Promise<void>;
};

export const nativeCompanion = NativeModules.FrameCompanion as FrameCompanionNative | undefined;
export const companionEvents = Platform.OS === 'android' && NativeModules.FrameCompanion
  ? new NativeEventEmitter(NativeModules.FrameCompanion)
  : null;

export async function getCapabilities(): Promise<CapabilitySnapshot> {
  if (nativeCompanion?.getCapabilities) return nativeCompanion.getCapabilities();
  return { light: false, vibration: false, microphone: false, secureStorage: false };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { NativeModules } from 'react-native';
import { FrameCompanionConfig, migrateConfig } from './schema';

const CONFIG_KEY = 'framecompanion.config.v1';
const LEGACY_BASE_URL_KEY = 'dashwise.baseUrl';
const LEGACY_PINNED_KEY = 'dashwise.pinnedApps';

type SecureSecretsModule = {
  setSecret?: (key: string, value: string) => Promise<void>;
  getSecret?: (key: string) => Promise<string | null>;
  deleteSecret?: (key: string) => Promise<void>;
};

export const nativeSecrets = NativeModules.SecureSecrets as SecureSecretsModule | undefined;

export async function loadConfig(): Promise<FrameCompanionConfig> {
  const deviceId = Application.getAndroidId() ?? Application.applicationId ?? 'device';
  const stored = await AsyncStorage.getItem(CONFIG_KEY);
  if (stored) {
    try {
      return migrateConfig(JSON.parse(stored), deviceId);
    } catch {
      // Fall through to a clean default when storage was corrupted.
    }
  }

  const [baseUrl, pinned] = await Promise.all([
    AsyncStorage.getItem(LEGACY_BASE_URL_KEY),
    AsyncStorage.getItem(LEGACY_PINNED_KEY),
  ]);
  const config = migrateConfig({
    dashwiseUrl: baseUrl ?? '',
    pinnedPackages: pinned ? JSON.parse(pinned) : [],
  }, deviceId);
  await saveConfig(config);
  return config;
}

export async function saveConfig(config: FrameCompanionConfig) {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, version: 1 }));
}

export async function setSecret(ref: string, value: string) {
  if (nativeSecrets?.setSecret) {
    await nativeSecrets.setSecret(ref, value);
    return;
  }
  await AsyncStorage.setItem(`secret.${ref}`, value);
}

export async function getSecret(ref?: string) {
  if (!ref) return null;
  if (nativeSecrets?.getSecret) return nativeSecrets.getSecret(ref);
  return AsyncStorage.getItem(`secret.${ref}`);
}

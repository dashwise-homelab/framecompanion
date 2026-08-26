import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, NativeModules, PanResponder, PermissionsAndroid, Platform, View } from 'react-native';
import { WebViewNavigation } from 'react-native-webview';
import { AppViewScreen, InstalledApp } from './src/screens/AppViewScreen';
import { FrameScreen } from './src/screens/FrameScreen';
import { SettingsScreen } from './src/screens/settings/SettingsScreen';
import { styles } from './src/components/Styles';
import { FrameCompanionConfig, migrateConfig } from './src/config/schema';
import { loadConfig, saveConfig } from './src/config/storage';
import { CapabilitySnapshot, NativeStatus, companionEvents, getCapabilities, nativeCompanion } from './src/native/capabilities';
import { MqttClient, MqttStatus } from './src/mqtt/client';

const CURRENT_VERSION = '0.1.1';
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/dashwise-homelab/framecompanion/releases/latest';

type Screen = 'loading' | 'frame' | 'black' | 'appview' | 'settings';
type InstalledAppsModule = { getInstalledApps?: () => Promise<InstalledApp[]>; openApp?: (packageName: string) => Promise<void> };
const nativeInstalledApps = NativeModules.InstalledApps as InstalledAppsModule | undefined;

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [config, setConfig] = useState<FrameCompanionConfig | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitySnapshot>({ bluetooth: false, light: false, vibration: false, microphone: false, camera: false, secureStorage: false });
  const [nativeStatus, setNativeStatus] = useState<NativeStatus>({ mqttState: 'disabled' });
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>({ state: 'disabled' });
  const gesturePoints = useRef<Array<{ x: number; y: number }>>([]);
  const mqttClient = useRef(new MqttClient()).current;

  useEffect(() => {
    void hydrate();
    const unsubscribe = mqttClient.onStatus(setMqttStatus);
    return () => { unsubscribe(); };
  }, [mqttClient]);

  useEffect(() => {
    if (!companionEvents) return undefined;
    const subscription = companionEvents.addListener('status', (status: NativeStatus) => {
      setNativeStatus((current) => ({ ...current, ...status }));
      if (status.mqttState) setMqttStatus({ state: status.mqttState, lastError: status.lastError });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!config) return;
    void syncServices(config);
  }, [config]);

  useEffect(() => {
    if (screen !== 'appview' || !config) return;
    void loadApps();
    void checkForUpdate();
  }, [screen, config]);

  useEffect(() => {
    if (!config?.dashwiseUrl || (screen !== 'frame' && screen !== 'black')) return;
    const trigger = config.presence.screensaverTrigger;
    const hasTrigger = trigger !== 'bluetooth' || config.bluetooth.devices.length > 0;
    if (!hasTrigger) return;
    const present = trigger === 'bluetooth' ? nativeStatus.bluetoothPresence === true
      : trigger === 'light' ? nativeStatus.lightPresence === true
        : trigger === 'vibration' ? nativeStatus.vibrationPresence === true
          : nativeStatus.cameraPresence === true;
    setScreen(present ? 'frame' : 'black');
  }, [config, nativeStatus, screen]);

  const displayStateRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (nativeStatus.displayOn === undefined) return;
    if (!nativeStatus.displayOn) {
      if (screen === 'frame') setScreen('black');
    } else if (displayStateRef.current === false && screen === 'black') {
      setScreen('frame');
    }
    displayStateRef.current = nativeStatus.displayOn;
  }, [nativeStatus.displayOn, screen]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 18 || Math.abs(gesture.dy) > 18,
    onPanResponderGrant: (event) => { gesturePoints.current = [{ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }]; },
    onPanResponderMove: (event) => { gesturePoints.current.push({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }); },
    onPanResponderRelease: () => { if (isLShape(gesturePoints.current)) setScreen('appview'); gesturePoints.current = []; },
  }), []);

  async function hydrate() {
    const loaded = await loadConfig();
    setConfig(loaded);
    setDraftUrl(loaded.dashwiseUrl);
    setCapabilities(await getCapabilities());
    if (nativeCompanion?.getStatus) setNativeStatus(await nativeCompanion.getStatus());
    setScreen('frame');
  }

  async function updateConfig(next: FrameCompanionConfig) {
    setConfig(next);
    await saveConfig(next);
  }

  async function syncServices(next: FrameCompanionConfig) {
    await requestRuntimePermissions(next);
    setCapabilities(await getCapabilities());
    await mqttClient.apply(next);
    if (!nativeCompanion?.configure) return;
    try {
      await nativeCompanion.configure(JSON.stringify(next));
      const needsService = next.mqtt.enabled || next.bluetooth.enabled || next.light.enabled || next.vibration.enabled || next.audio.enabled || next.camera.enabled || next.clipServer.enabled || next.cameraServer.enabled;
      if (needsService) await nativeCompanion.startService?.();
      else await nativeCompanion.stopService?.();
    } catch (error) {
      setNativeStatus((current) => ({ ...current, lastError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function requestRuntimePermissions(next: FrameCompanionConfig) {
    if (Platform.OS !== 'android') return;
    const permissions: string[] = [];
    if (next.bluetooth.enabled) {
      permissions.push(Platform.Version >= 31 ? PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (Platform.Version >= 31) permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    }
    if (next.audio.enabled) permissions.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (next.camera.enabled || next.cameraServer.enabled) permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (Platform.Version >= 33 && (next.mqtt.enabled || next.bluetooth.enabled || next.light.enabled || next.vibration.enabled || next.audio.enabled || next.camera.enabled)) permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (permissions.length === 0) return;
    try { await PermissionsAndroid.requestMultiple([...new Set(permissions)] as Parameters<typeof PermissionsAndroid.requestMultiple>[0]); } catch (error) { setNativeStatus((current) => ({ ...current, lastError: `Permission request failed: ${String(error)}` })); }
  }

  async function saveBaseUrl() {
    if (!config) return;
    const normalizedUrl = normalizeUrl(draftUrl);
    if (!normalizedUrl) {
      Alert.alert('Invalid URL', 'Enter the root URL for your Dashwise instance.');
      return;
    }
    await updateConfig({ ...config, dashwiseUrl: normalizedUrl });
    setDraftUrl(normalizedUrl);
    setScreen('frame');
  }

  async function loadApps() {
    try {
      if (nativeInstalledApps?.getInstalledApps) {
        setApps(await nativeInstalledApps.getInstalledApps());
        return;
      }
    } catch (error) {
      console.warn('Unable to load installed apps', error);
      Alert.alert('Apps unavailable', 'Android could not read the installed apps on this device.');
    }
    setApps([{ packageName: Application.applicationId ?? 'com.dashwise.framecompanion', label: 'Dashwise Companion' }]);
  }

  async function checkForUpdate() {
    try {
      const response = await fetch(LATEST_RELEASE_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) return;
      const release = await response.json() as { tag_name?: string; html_url?: string };
      const currentVersion = Application.nativeApplicationVersion ?? CURRENT_VERSION;
      if (release.tag_name && release.html_url && isNewerVersion(release.tag_name, currentVersion)) setReleaseUrl(release.html_url);
    } catch {
      // Offline update checks do not affect launcher behavior.
    }
  }

  async function togglePinned(packageName: string) {
    if (!config) return;
    const pinnedPackages = config.pinnedPackages.includes(packageName) ? config.pinnedPackages.filter((candidate) => candidate !== packageName) : [packageName, ...config.pinnedPackages];
    await updateConfig({ ...config, pinnedPackages });
  }

  async function openAppInfo(packageName: string) {
    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, { data: `package:${packageName}` });
      return;
    }
    Alert.alert('Unavailable', 'App info is only available on Android.');
  }

  async function openApp(packageName: string) {
    await nativeInstalledApps?.openApp?.(packageName);
  }

  function handleNavigationChange(navState: WebViewNavigation) {
    const closeAction = getQueryParam(navState.url, 'closeActionTriggered');
    if (isTruthyCloseAction(closeAction)) setScreen('appview');
  }

  if (!config) return <View style={styles.centered} />;
  const sortedApps = [...apps].sort((a, b) => {
    const aPin = config.pinnedPackages.indexOf(a.packageName);
    const bPin = config.pinnedPackages.indexOf(b.packageName);
    if (aPin !== -1 || bPin !== -1) return (aPin === -1 ? Number.MAX_SAFE_INTEGER : aPin) - (bPin === -1 ? Number.MAX_SAFE_INTEGER : bPin);
    return a.label.localeCompare(b.label);
  });

  return (
    <View style={styles.root} {...(screen === 'frame' ? {} : panResponder.panHandlers)}>
      <StatusBar hidden />
      {screen === 'frame' ? <FrameScreen baseUrl={config.dashwiseUrl} draftUrl={draftUrl} onChangeUrl={setDraftUrl} onSubmit={() => void saveBaseUrl()} onNavigationChange={handleNavigationChange} /> : null}
      {screen === 'black' ? <View style={styles.root} accessible={false} /> : null}
      {screen === 'appview' ? <AppViewScreen apps={sortedApps} pinnedPackages={config.pinnedPackages} releaseUrl={releaseUrl} onBack={() => setScreen(config.dashwiseUrl ? 'frame' : 'frame')} onSettings={() => setScreen('settings')} onOpenApp={openApp} onOpenAppInfo={openAppInfo} onTogglePinned={(packageName) => void togglePinned(packageName)} /> : null}
      {screen === 'settings' ? <SettingsScreen config={config} capabilities={capabilities} nativeStatus={nativeStatus} mqttStatus={mqttStatus} mqttClient={mqttClient} onChange={(next) => void updateConfig(migrateConfig(next, Application.getAndroidId() ?? 'device'))} onBack={() => setScreen('appview')} /> : null}
    </View>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getQueryParam(url: string, param: string) {
  try { return new URL(url).searchParams.get(param); } catch { return null; }
}

function isTruthyCloseAction(value: string | null) {
  if (value === null) return false;
  const normalized = value.toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

function isNewerVersion(candidate: string, current: string) {
  const parse = (value: string) => { const match = value.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/); return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null; };
  const candidateParts = parse(candidate);
  const currentParts = parse(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index];
  }
  return false;
}

function isLShape(points: Array<{ x: number; y: number }>) {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const corner = points.reduce((best, point) => {
    const score = Math.min(Math.abs(point.x - first.x) + Math.abs(last.y - point.y), Math.abs(point.y - first.y) + Math.abs(last.x - point.x));
    return score < best.score ? { point, score } : best;
  }, { point: first, score: Number.MAX_SAFE_INTEGER });
  const firstLeg = Math.hypot(first.x - corner.point.x, first.y - corner.point.y);
  const secondLeg = Math.hypot(corner.point.x - last.x, corner.point.y - last.y);
  return firstLeg > 80 && secondLeg > 80 && firstLeg + secondLeg > Math.hypot(first.x - last.x, first.y - last.y) * 1.35;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

const BASE_URL_STORAGE_KEY = 'dashwise.baseUrl';
const PINNED_APPS_STORAGE_KEY = 'dashwise.pinnedApps';
const ACCENT_COLOR = 'hsl(196, 100%, 44%)';

type Screen = 'loading' | 'onboarding' | 'webview' | 'appview';

type InstalledApp = {
  packageName: string;
  label: string;
  icon?: string;
};

type InstalledAppsModule = {
  getInstalledApps?: () => Promise<InstalledApp[]>;
  openApp?: (packageName: string) => Promise<void>;
};

const nativeInstalledApps = NativeModules.InstalledApps as InstalledAppsModule | undefined;

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [baseUrl, setBaseUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [pinnedPackages, setPinnedPackages] = useState<string[]>([]);
  const gesturePoints = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    void hydrate();
  }, []);

  useEffect(() => {
    if (screen === 'appview') {
      void loadApps();
    }
  }, [screen]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 18 || Math.abs(gesture.dy) > 18,
        onPanResponderGrant: (event) => {
          gesturePoints.current = [{ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }];
        },
        onPanResponderMove: (event) => {
          gesturePoints.current.push({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
        },
        onPanResponderRelease: () => {
          if (isLShape(gesturePoints.current)) {
            setScreen('appview');
          }
          gesturePoints.current = [];
        },
      }),
    [],
  );

  async function hydrate() {
    const [storedBaseUrl, storedPinnedApps] = await Promise.all([
      AsyncStorage.getItem(BASE_URL_STORAGE_KEY),
      AsyncStorage.getItem(PINNED_APPS_STORAGE_KEY),
    ]);

    if (storedPinnedApps) {
      setPinnedPackages(JSON.parse(storedPinnedApps) as string[]);
    }

    if (storedBaseUrl) {
      setBaseUrl(storedBaseUrl);
      setDraftUrl(storedBaseUrl);
      setScreen('webview');
    } else {
      setScreen('onboarding');
    }
  }

  async function saveBaseUrl() {
    const normalizedUrl = normalizeUrl(draftUrl);
    if (!normalizedUrl) {
      Alert.alert('Invalid URL', 'Enter the root URL for your Dashwise instance.');
      return;
    }

    await AsyncStorage.setItem(BASE_URL_STORAGE_KEY, normalizedUrl);
    setBaseUrl(normalizedUrl);
    setScreen('webview');
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

    setApps([
      {
        packageName: Application.applicationId ?? 'com.dashwise.framecompanion',
        label: 'Dashwise Companion',
      },
    ]);
  }

  async function togglePinned(packageName: string) {
    const next = pinnedPackages.includes(packageName)
      ? pinnedPackages.filter((candidate) => candidate !== packageName)
      : [packageName, ...pinnedPackages];

    setPinnedPackages(next);
    await AsyncStorage.setItem(PINNED_APPS_STORAGE_KEY, JSON.stringify(next));
  }

  async function openAppInfo(packageName: string) {
    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
        data: `package:${packageName}`,
      });
      return;
    }

    Alert.alert('Unavailable', 'App info is only available on Android.');
  }

  async function openApp(packageName: string) {
    if (nativeInstalledApps?.openApp) {
      await nativeInstalledApps.openApp(packageName);
    }
  }

  function handleNavigationChange(navState: WebViewNavigation) {
    const closeAction = getQueryParam(navState.url, 'closeActionTriggered');
    if (isTruthyCloseAction(closeAction)) {
      setScreen('appview');
    }
  }

  const sortedApps = [...apps].sort((a, b) => {
    const aPin = pinnedPackages.indexOf(a.packageName);
    const bPin = pinnedPackages.indexOf(b.packageName);
    if (aPin !== -1 || bPin !== -1) {
      return (aPin === -1 ? Number.MAX_SAFE_INTEGER : aPin) - (bPin === -1 ? Number.MAX_SAFE_INTEGER : bPin);
    }
    return a.label.localeCompare(b.label);
  });

  return (
    <View style={styles.root} {...(screen === 'webview' ? {} : panResponder.panHandlers)}>
      <StatusBar hidden />
      {screen === 'loading' ? <LoadingScreen /> : null}
      {screen === 'onboarding' ? (
        <OnboardingScreen draftUrl={draftUrl} onChangeUrl={setDraftUrl} onSubmit={saveBaseUrl} />
      ) : null}
      {screen === 'webview' ? <FrameWebView baseUrl={baseUrl} onNavigationChange={handleNavigationChange} /> : null}
      {screen === 'appview' ? (
        <AppView
          apps={sortedApps}
          pinnedPackages={pinnedPackages}
          onBack={() => setScreen(baseUrl ? 'webview' : 'onboarding')}
          onOpenApp={openApp}
          onOpenAppInfo={openAppInfo}
          onTogglePinned={togglePinned}
        />
      ) : null}
    </View>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>Dashwise</Text>
    </View>
  );
}

function OnboardingScreen({ draftUrl, onChangeUrl, onSubmit }: { draftUrl: string; onChangeUrl: (value: string) => void; onSubmit: () => void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.onboardingCard}>
        <Text style={styles.eyebrow}>Smart Frame Setup</Text>
        <Text style={styles.title}>Connect Dashwise</Text>
        <Text style={styles.body}>Enter your Dashwise instance root URL. The frame view opens at /frame with closeAction=urlParam.</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={onChangeUrl}
          onSubmitEditing={onSubmit}
          placeholder="https://dashwise.example.com"
          placeholderTextColor="#687080"
          returnKeyType="go"
          style={styles.input}
          value={draftUrl}
        />
        <Pressable onPress={onSubmit} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Open Frame</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function FrameWebView({ baseUrl, onNavigationChange }: { baseUrl: string; onNavigationChange: (navState: WebViewNavigation) => void }) {
  return <WebView source={{ uri: `${baseUrl}/frame?closeAction=urlParam` }} style={styles.webview} onNavigationStateChange={onNavigationChange} />;
}

function AppView({ apps, pinnedPackages, onBack, onOpenApp, onOpenAppInfo, onTogglePinned }: { apps: InstalledApp[]; pinnedPackages: string[]; onBack: () => void; onOpenApp: (packageName: string) => void; onOpenAppInfo: (packageName: string) => void; onTogglePinned: (packageName: string) => void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Apps</Text>
        <Pressable onPress={onBack} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Frame</Text>
        </Pressable>
      </View>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={apps}
        keyExtractor={(item) => item.packageName}
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() =>
              Alert.alert(item.label, undefined, [
                { text: pinnedPackages.includes(item.packageName) ? 'Unpin' : 'Pin', onPress: () => onTogglePinned(item.packageName) },
                { text: 'App info', onPress: () => onOpenAppInfo(item.packageName) },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
            onPress={() => onOpenApp(item.packageName)}
            style={styles.appRow}
          >
            {item.icon ? <Image source={{ uri: item.icon }} style={styles.appIcon} /> : <View style={styles.appIconFallback}><Text style={styles.appIconLetter}>{item.label.slice(0, 1)}</Text></View>}
            <View style={styles.appText}>
              <Text style={styles.appTitle}>{item.label}</Text>
              <Text style={styles.appPackage}>{item.packageName}</Text>
            </View>
            {pinnedPackages.includes(item.packageName) ? <Text style={styles.pin}>Pinned</Text> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
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
  try {
    return new URL(url).searchParams.get(param);
  } catch {
    return null;
  }
}

function isTruthyCloseAction(value: string | null) {
  if (value === null) return false;
  const normalized = value.toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

function isLShape(points: Array<{ x: number; y: number }>) {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const corner = points.reduce((best, point) => {
    const verticalThenHorizontal = Math.abs(point.x - first.x) + Math.abs(last.y - point.y);
    const horizontalThenVertical = Math.abs(point.y - first.y) + Math.abs(last.x - point.x);
    const score = Math.min(verticalThenHorizontal, horizontalThenVertical);
    return score < best.score ? { point, score } : best;
  }, { point: first, score: Number.MAX_SAFE_INTEGER });

  const firstLeg = distance(first, corner.point);
  const secondLeg = distance(corner.point, last);
  const total = distance(first, last);
  return firstLeg > 80 && secondLeg > 80 && firstLeg + secondLeg > total * 1.35;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070a' },
  screen: { flex: 1, backgroundColor: '#05070a' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#05070a' },
  onboardingCard: { flex: 1, justifyContent: 'center', padding: 28, gap: 16 },
  eyebrow: { color: ACCENT_COLOR, fontSize: 13, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { color: '#f6f8fb', fontSize: 36, fontWeight: '800' },
  body: { color: '#a8b0bf', fontSize: 17, lineHeight: 25 },
  input: { backgroundColor: '#101722', borderColor: '#263244', borderRadius: 16, borderWidth: 1, color: '#f6f8fb', fontSize: 17, padding: 18 },
  primaryButton: { alignItems: 'center', backgroundColor: ACCENT_COLOR, borderRadius: 16, padding: 18 },
  primaryButtonText: { color: '#f6f8fb', fontSize: 17, fontWeight: '800' },
  secondaryButton: { borderColor: '#2f3b4d', borderRadius: 999, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },
  secondaryButtonText: { color: '#f6f8fb', fontWeight: '700' },
  webview: { flex: 1, backgroundColor: '#05070a' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  listContent: { padding: 12, paddingBottom: 32 },
  appRow: { alignItems: 'center', backgroundColor: '#101722', borderRadius: 18, flexDirection: 'row', gap: 14, marginBottom: 10, padding: 14 },
  appIcon: { borderRadius: 12, height: 48, width: 48 },
  appIconFallback: { alignItems: 'center', backgroundColor: '#243145', borderRadius: 12, height: 48, justifyContent: 'center', width: 48 },
  appIconLetter: { color: '#f6f8fb', fontSize: 20, fontWeight: '800' },
  appText: { flex: 1 },
  appTitle: { color: '#f6f8fb', fontSize: 17, fontWeight: '700' },
  appPackage: { color: '#687080', fontSize: 12, marginTop: 3 },
  pin: { color: ACCENT_COLOR, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
});

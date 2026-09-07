import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { FrameCompanionConfig, PresenceSource } from '../../config/schema';
import { styles } from '../../components/Styles';
import { CapabilitySnapshot, NativeStatus, nativeCompanion } from '../../native/capabilities';
import { MqttClient, MqttStatus } from '../../mqtt/client';
import { setSecret } from '../../config/storage';

const sourceLabels: Record<PresenceSource, string> = { light: 'Ambient light', vibration: 'Vibration' };

function Field({ label, value, onChangeText, keyboardType = 'default', secureTextEntry = false }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'numeric' | 'url'; secureTextEntry?: boolean }) {
  return <View style={{ gap: 6, marginBottom: 10 }}><Text style={styles.muted}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} secureTextEntry={secureTextEntry} autoCapitalize="none" style={styles.input} /></View>;
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return <View style={styles.row}><Text style={styles.rowText}>{label}</Text><Switch value={value} onValueChange={onValueChange} /></View>;
}

function StatusValue({ status, kind }: { status: NativeStatus; kind: 'light' | 'vibration' }) {
  return <Text style={styles.rowValue}>{kind === 'light' ? `${status.ambientLightLux?.toFixed(1) ?? '--'} lux` : status.vibrationLevel?.toFixed(2) ?? '--'}</Text>;
}

export function SettingsScreen({ config, buildCommit, capabilities, nativeStatus, mqttStatus, mqttClient, onChange, onBack }: {
  config: FrameCompanionConfig;
  buildCommit: string | null;
  capabilities: CapabilitySnapshot;
  nativeStatus: NativeStatus;
  mqttStatus: MqttStatus;
  mqttClient: MqttClient;
  onChange: (next: FrameCompanionConfig) => void;
  onBack: () => void;
}) {
  const [mqttPassword, setMqttPassword] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [audioInputNames, setAudioInputNames] = useState<Record<number, string>>({});
  const previousBrowserUrl = useRef(config.mqtt.openBrowserUrl);

  useEffect(() => { setTestMessage(''); }, [config.mqtt.host, config.mqtt.port]);
  useEffect(() => {
    void (async () => {
      try {
        const inputs = await nativeCompanion?.getAudioInputs?.() ?? [];
        setAudioInputNames(Object.fromEntries(inputs.map((input) => [input.id, input.name])));
      } catch { /* Audio input enumeration is optional. */ }
    })();
  }, []);
  useEffect(() => {
    const nextUrl = config.mqtt.openBrowserUrl.trim();
    if (nextUrl === previousBrowserUrl.current.trim()) return;
    previousBrowserUrl.current = nextUrl;
    if (!nextUrl) return;
    const timer = setTimeout(() => {
      const browserUrl = nextUrl.includes('://') ? nextUrl : `https://${nextUrl}`;
      try {
        const parsed = new URL(browserUrl);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.hostname.includes('.') || parsed.hostname === 'localhost')) void Linking.openURL(parsed.toString()).catch(() => undefined);
      } catch { /* Ignore incomplete URLs while editing. */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [config.mqtt.openBrowserUrl]);

  const update = (next: Partial<FrameCompanionConfig>) => onChange({ ...config, ...next });
  const toggleSource = (source: PresenceSource, enabled: boolean) => update({ presence: { ...config.presence, enabledSources: enabled ? [...new Set([...config.presence.enabledSources, source])] : config.presence.enabledSources.filter((item) => item !== source) } });
  const saveMqttPassword = async () => {
    if (!mqttPassword) return;
    const ref = `mqtt-${config.mqtt.clientId}`;
    await setSecret(ref, mqttPassword);
    update({ mqtt: { ...config.mqtt, passwordSecretRef: ref } });
    setMqttPassword('');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <View style={styles.header}><Text style={styles.title}>Settings</Text><Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Apps</Text></Pressable></View>
      <View style={styles.section}><Text style={styles.sectionTitle}>General</Text><View style={styles.card}>
        <Field label="Device name" value={config.deviceName} onChangeText={(deviceName) => update({ deviceName })} />
        <Field label="Dashwise URL" value={config.dashwiseUrl} onChangeText={(dashwiseUrl) => update({ dashwiseUrl })} keyboardType="url" />
        <View style={styles.row}><Text style={styles.rowText}>Build commit</Text><Text selectable style={styles.rowValue}>{buildCommit?.slice(0, 7) ?? 'Unavailable'}</Text></View>
        <View style={styles.row}><Text style={styles.rowText}>Display power control</Text><Text style={styles.rowValue}>{nativeStatus.displayAdminActive ? 'Device Admin enabled' : 'Black-screen fallback'}</Text></View>
        <Pressable onPress={() => void requestDisplayAdmin()} style={styles.smallButton}><Text style={styles.smallButtonText}>Enable Android display power control</Text></Pressable>
        <View style={styles.row}><Text style={styles.rowText}>Brightness / auto</Text><Text style={styles.rowValue}>{nativeStatus.brightnessPercent?.toFixed(0) ?? '--'}% / {nativeStatus.autoBrightness ? 'Auto' : 'Manual'}</Text></View>
        {!nativeStatus.canWriteSettings ? <Pressable onPress={() => void requestWriteSettings()} style={styles.smallButton}><Text style={styles.smallButtonText}>Allow remote brightness changes</Text></Pressable> : null}
      </View></View>

      <View style={styles.section}><Text style={styles.sectionTitle}>MQTT / Home Assistant</Text><View style={styles.card}>
        <ToggleRow label="Enabled" value={config.mqtt.enabled} onValueChange={(enabled) => update({ mqtt: { ...config.mqtt, enabled } })} />
        <Field label="Broker host" value={config.mqtt.host} onChangeText={(host) => update({ mqtt: { ...config.mqtt, host } })} />
        <Field label="Port" value={String(config.mqtt.port)} onChangeText={(port) => update({ mqtt: { ...config.mqtt, port: Number(port) || 1883 } })} keyboardType="numeric" />
        <Field label="Client ID" value={config.mqtt.clientId} onChangeText={(clientId) => update({ mqtt: { ...config.mqtt, clientId } })} />
        <Field label="Open Browser URL" value={config.mqtt.openBrowserUrl} onChangeText={(openBrowserUrl) => update({ mqtt: { ...config.mqtt, openBrowserUrl } })} keyboardType="url" />
        <ToggleRow label="Authentication" value={config.mqtt.authEnabled} onValueChange={(authEnabled) => update({ mqtt: { ...config.mqtt, authEnabled } })} />
        <ToggleRow label="TLS" value={config.mqtt.tlsEnabled} onValueChange={(tlsEnabled) => update({ mqtt: { ...config.mqtt, tlsEnabled } })} />
        {config.mqtt.authEnabled ? <><Field label="Username" value={config.mqtt.username} onChangeText={(username) => update({ mqtt: { ...config.mqtt, username } })} /><Field label="New password" value={mqttPassword} onChangeText={setMqttPassword} secureTextEntry /><Pressable onPress={() => void saveMqttPassword()} style={styles.smallButton}><Text style={styles.smallButtonText}>Save password securely</Text></Pressable></> : null}
        <View style={styles.row}><Text style={styles.rowText}>Connection</Text><Text style={mqttStatus.state === 'connected' ? styles.status : styles.error}>{mqttStatus.state}</Text></View>
        {mqttStatus.lastError ? <Text style={styles.error}>{mqttStatus.lastError}</Text> : null}
        <Pressable onPress={() => void mqttClient.test(config).then(setTestMessage).catch((error: Error) => setTestMessage(error.message))} style={styles.smallButton}><Text style={styles.smallButtonText}>Test connection</Text></Pressable>
        {testMessage ? <Text style={styles.muted}>{testMessage}</Text> : null}
      </View></View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Presence</Text><View style={styles.card}>
        <Text style={[styles.muted, { padding: 15 }]}>Main presence is true when any enabled light or vibration source is present.</Text>
        {(['light', 'vibration'] as PresenceSource[]).map((source) => <ToggleRow key={source} label={`${sourceLabels[source]} presence`} value={config.presence.enabledSources.includes(source)} onValueChange={(enabled) => toggleSource(source, enabled)} />)}
        <Field label="Main presence debounce (ms)" value={String(config.presence.debounceMs)} onChangeText={(debounceMs) => update({ presence: { ...config.presence, debounceMs: Number(debounceMs) || 0 } })} keyboardType="numeric" />
        <Pressable onPress={() => chooseScreensaverTrigger()} style={styles.row}><Text style={styles.rowText}>Screensaver trigger</Text><Text style={styles.rowValue}>{sourceLabels[config.presence.screensaverTrigger]}</Text></Pressable>
      </View>
      {!capabilities.light ? <View style={styles.warning}><Text style={styles.warningText}>Ambient light sensor not available on this device.</Text></View> : null}
      {!capabilities.vibration ? <View style={styles.warning}><Text style={styles.warningText}>Motion sensors not available on this device.</Text></View> : null}
      <View style={styles.card}><ToggleRow label="Ambient light detector" value={config.light.enabled} onValueChange={(enabled) => update({ light: { ...config.light, enabled } })} /><View style={styles.row}><Text style={styles.rowText}>Live reading</Text><StatusValue status={nativeStatus} kind="light" /></View><View style={styles.row}><Text style={styles.rowText}>Learned baseline</Text><Text style={styles.rowValue}>Local adaptive model</Text></View><Pressable onPress={() => void nativeCompanion?.resetLightBaseline?.()} style={styles.smallButton}><Text style={styles.smallButtonText}>Reset learned baseline</Text></Pressable></View>
      <View style={styles.card}><ToggleRow label="Vibration detector" value={config.vibration.enabled} onValueChange={(enabled) => update({ vibration: { ...config.vibration, enabled } })} /><Field label="Tolerance" value={String(config.vibration.tolerance)} onChangeText={(tolerance) => update({ vibration: { ...config.vibration, tolerance: Number(tolerance) || 0 } })} keyboardType="numeric" /><View style={styles.row}><Text style={styles.rowText}>Baseline / threshold</Text><Text style={styles.rowValue}>{nativeStatus.vibrationBaseline?.toFixed(3) ?? '--'} / {nativeStatus.vibrationThreshold?.toFixed(3) ?? '--'}</Text></View><Pressable onPress={() => void nativeCompanion?.calibrateVibration?.(10_000)} style={styles.smallButton}><Text style={styles.smallButtonText}>{nativeStatus.vibrationCalibrating ? 'Calibrating...' : 'Calibrate idle vibration'}</Text></Pressable><View style={styles.row}><Text style={styles.rowText}>Live reading</Text><StatusValue status={nativeStatus} kind="vibration" /></View></View>
      </View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Audio</Text><View style={styles.card}><ToggleRow label="Enabled" value={config.audio.enabled} onValueChange={(enabled) => update({ audio: { ...config.audio, enabled } })} /><ToggleRow label="Clap actions" value={config.audio.clapDetection} onValueChange={(clapDetection) => update({ audio: { ...config.audio, clapDetection } })} /><Field label="Sensitivity" value={String(config.audio.sensitivity)} onChangeText={(sensitivity) => update({ audio: { ...config.audio, sensitivity: Number(sensitivity) || 0.6 } })} keyboardType="numeric" /><Pressable onPress={() => void chooseAudioInput()} style={styles.row}><Text style={styles.rowText}>Input device</Text><Text style={styles.rowValue}>{config.audio.inputDeviceId === undefined ? 'System default' : audioInputNames[config.audio.inputDeviceId] ?? config.audio.inputDeviceId}</Text></Pressable><View style={styles.row}><Text style={styles.rowText}>Live signal energy</Text><Text style={styles.rowValue}>{nativeStatus.audioEnergy?.toFixed(3) ?? '--'}</Text></View><Text style={[styles.muted, { padding: 15 }]}>Clap analysis is performed locally; raw microphone buffers are discarded.</Text></View>{!capabilities.microphone ? <View style={styles.warning}><Text style={styles.warningText}>Microphone unavailable or permission not granted.</Text></View> : null}</View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Diagnostics</Text><View style={styles.card}><View style={styles.row}><Text style={styles.rowText}>MQTT</Text><Text style={styles.rowValue}>{mqttStatus.state}</Text></View><View style={styles.row}><Text style={styles.rowText}>Ambient light</Text><StatusValue status={nativeStatus} kind="light" /></View><View style={styles.row}><Text style={styles.rowText}>Audio energy</Text><Text style={styles.rowValue}>{nativeStatus.audioEnergy?.toFixed(3) ?? 'Unavailable'}</Text></View><View style={styles.row}><Text style={styles.rowText}>Battery / thermal</Text><Text style={styles.rowValue}>{nativeStatus.batteryPercent?.toFixed(0) ?? '--'}% / {nativeStatus.thermalStatus ?? '--'}</Text></View></View></View>
    </ScrollView>
  );

  function chooseScreensaverTrigger() {
    Alert.alert('Screensaver trigger', undefined, [
      { text: 'Ambient light', onPress: () => onChange({ ...config, presence: { ...config.presence, screensaverTrigger: 'light' } }) },
      { text: 'Vibration', onPress: () => onChange({ ...config, presence: { ...config.presence, screensaverTrigger: 'vibration' } }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  async function requestDisplayAdmin() {
    if (!nativeCompanion?.requestDisplayAdmin) { Alert.alert('Unavailable', 'Android display power control is unavailable on this build.'); return; }
    try { await nativeCompanion.requestDisplayAdmin(); Alert.alert('Permission requested', 'Enable FrameCompanion in Android device-admin settings, then return here.'); } catch (error) { Alert.alert('Display control unavailable', error instanceof Error ? error.message : String(error)); }
  }
  async function requestWriteSettings() {
    if (!nativeCompanion?.requestWriteSettings) { Alert.alert('Unavailable', 'Android brightness control is unavailable on this build.'); return; }
    try { await nativeCompanion.requestWriteSettings(); Alert.alert('Permission requested', 'Allow FrameCompanion to modify system settings, then return here.'); } catch (error) { Alert.alert('Brightness control unavailable', error instanceof Error ? error.message : String(error)); }
  }
  async function chooseAudioInput() {
    if (!nativeCompanion?.getAudioInputs) return;
    try {
      const inputs = await nativeCompanion.getAudioInputs();
      Alert.alert('Audio input', undefined, [{ text: 'System default', onPress: () => onChange({ ...config, audio: { ...config.audio, inputDeviceId: undefined } }) }, ...inputs.map((input) => ({ text: input.name, onPress: () => onChange({ ...config, audio: { ...config.audio, inputDeviceId: input.id } }) })), { text: 'Cancel', style: 'cancel' }]);
    } catch (error) { Alert.alert('Audio input enumeration failed', error instanceof Error ? error.message : String(error)); }
  }
}

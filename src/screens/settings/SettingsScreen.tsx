import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { FrameCompanionConfig, PresenceSource } from '../../config/schema';
import { styles } from '../../components/Styles';
import { CapabilitySnapshot, NativeStatus, nativeCompanion } from '../../native/capabilities';
import { MqttClient, MqttStatus } from '../../mqtt/client';
import { setSecret } from '../../config/storage';

const sourceLabels: Record<PresenceSource, string> = { bluetooth: 'Bluetooth', light: 'Ambient light', vibration: 'Vibration', camera: 'Camera' };

function Field({ label, value, onChangeText, keyboardType = 'default', secureTextEntry = false }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'numeric' | 'url'; secureTextEntry?: boolean }) {
  return <View style={{ gap: 6, marginBottom: 10 }}><Text style={styles.muted}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} secureTextEntry={secureTextEntry} autoCapitalize="none" style={styles.input} /></View>;
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return <View style={styles.row}><Text style={styles.rowText}>{label}</Text><Switch value={value} onValueChange={onValueChange} /></View>;
}

function StatusValue({ status }: { status: NativeStatus }) {
  return <Text style={styles.rowValue}>{status.ambientLightLux !== undefined ? `${status.ambientLightLux.toFixed(1)} lux` : status.vibrationLevel !== undefined ? status.vibrationLevel.toFixed(2) : 'Unavailable'}</Text>;
}

export function SettingsScreen({ config, capabilities, nativeStatus, mqttStatus, mqttClient, onChange, onBack }: {
  config: FrameCompanionConfig;
  capabilities: CapabilitySnapshot;
  nativeStatus: NativeStatus;
  mqttStatus: MqttStatus;
  mqttClient: MqttClient;
  onChange: (next: FrameCompanionConfig) => void;
  onBack: () => void;
}) {
  const [mqttPassword, setMqttPassword] = useState('');
  const [clipPassword, setClipPassword] = useState('');
  const [cameraPassword, setCameraPassword] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [localIp, setLocalIp] = useState<string | null>(null);

  useEffect(() => { setTestMessage(''); }, [config.mqtt.host, config.mqtt.port]);
  useEffect(() => { const promise = nativeCompanion?.getLocalIp?.(); if (promise) void promise.then(setLocalIp); }, []);

  const update = (next: Partial<FrameCompanionConfig>) => onChange({ ...config, ...next });
  const toggleSource = (source: PresenceSource, enabled: boolean) => update({ presence: { ...config.presence, enabledSources: enabled ? [...new Set([...config.presence.enabledSources, source])] : config.presence.enabledSources.filter((item) => item !== source) } });
  const saveMqttPassword = async () => {
    if (!mqttPassword) return;
    const ref = `mqtt-${config.mqtt.clientId}`;
    await setSecret(ref, mqttPassword);
    update({ mqtt: { ...config.mqtt, passwordSecretRef: ref } });
    setMqttPassword('');
  };
  const saveServerPassword = async (kind: 'clip' | 'camera') => {
    const value = kind === 'clip' ? clipPassword : cameraPassword;
    if (!value) return;
    const ref = `${kind}-server-${config.mqtt.clientId}`;
    await setSecret(ref, value);
    if (kind === 'clip') {
      update({ clipServer: { ...config.clipServer, passwordSecretRef: ref } });
      setClipPassword('');
    } else {
      update({ cameraServer: { ...config.cameraServer, passwordSecretRef: ref } });
      setCameraPassword('');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <View style={styles.header}><Text style={styles.title}>Settings</Text><Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Apps</Text></Pressable></View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>General</Text>
        <View style={styles.card}>
          <Field label="Device name" value={config.deviceName} onChangeText={(deviceName) => update({ deviceName })} />
          <Field label="Dashwise URL" value={config.dashwiseUrl} onChangeText={(dashwiseUrl) => update({ dashwiseUrl })} keyboardType="url" />
          <View style={styles.row}><Text style={styles.rowText}>Display power control</Text><Text style={styles.rowValue}>{nativeStatus.displayAdminActive ? 'Device Admin enabled' : 'Black-screen fallback'}</Text></View>
          <Pressable onPress={() => void requestDisplayAdmin()} style={styles.smallButton}><Text style={styles.smallButtonText}>Enable Android display power control</Text></Pressable>
          <View style={styles.row}><Text style={styles.rowText}>Brightness / auto</Text><Text style={styles.rowValue}>{nativeStatus.brightnessPercent?.toFixed(0) ?? '--'}% / {nativeStatus.autoBrightness ? 'Auto' : 'Manual'}</Text></View>
          {!nativeStatus.canWriteSettings ? <Pressable onPress={() => void requestWriteSettings()} style={styles.smallButton}><Text style={styles.smallButtonText}>Allow remote brightness changes</Text></Pressable> : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MQTT / Home Assistant</Text>
        <View style={styles.card}>
          <ToggleRow label="Enabled" value={config.mqtt.enabled} onValueChange={(enabled) => update({ mqtt: { ...config.mqtt, enabled } })} />
          <Field label="Broker host" value={config.mqtt.host} onChangeText={(host) => update({ mqtt: { ...config.mqtt, host } })} />
          <Field label="Port" value={String(config.mqtt.port)} onChangeText={(port) => update({ mqtt: { ...config.mqtt, port: Number(port) || 1883 } })} keyboardType="numeric" />
          <Field label="Client ID" value={config.mqtt.clientId} onChangeText={(clientId) => update({ mqtt: { ...config.mqtt, clientId } })} />
          <ToggleRow label="Authentication" value={config.mqtt.authEnabled} onValueChange={(authEnabled) => update({ mqtt: { ...config.mqtt, authEnabled } })} />
          <ToggleRow label="TLS (future-compatible)" value={config.mqtt.tlsEnabled} onValueChange={(tlsEnabled) => update({ mqtt: { ...config.mqtt, tlsEnabled } })} />
          {config.mqtt.authEnabled ? <><Field label="Username" value={config.mqtt.username} onChangeText={(username) => update({ mqtt: { ...config.mqtt, username } })} /><Field label="New password" value={mqttPassword} onChangeText={setMqttPassword} secureTextEntry /><Pressable onPress={() => void saveMqttPassword()} style={styles.smallButton}><Text style={styles.smallButtonText}>Save password securely</Text></Pressable></> : null}
          <View style={styles.row}><Text style={styles.rowText}>Connection</Text><Text style={mqttStatus.state === 'connected' ? styles.status : styles.error}>{mqttStatus.state}</Text></View>
          {mqttStatus.lastError ? <Text style={styles.error}>{mqttStatus.lastError}</Text> : null}
          <View style={styles.buttonRow}><Pressable onPress={() => void mqttClient.test(config).then(setTestMessage).catch((error: Error) => setTestMessage(error.message))} style={styles.smallButton}><Text style={styles.smallButtonText}>Test connection</Text></Pressable></View>
          {testMessage ? <Text style={styles.muted}>{testMessage}</Text> : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Presence</Text>
        <View style={styles.card}>
          <Text style={[styles.muted, { padding: 15 }]}>Main presence is true when any enabled source is present. Each source remains visible in Home Assistant.</Text>
          {(['bluetooth', 'light', 'vibration', 'camera'] as PresenceSource[]).map((source) => <ToggleRow key={source} label={`${sourceLabels[source]} presence`} value={config.presence.enabledSources.includes(source)} onValueChange={(enabled) => toggleSource(source, enabled)} />)}
          <Field label="Main presence debounce (ms)" value={String(config.presence.debounceMs)} onChangeText={(debounceMs) => update({ presence: { ...config.presence, debounceMs: Number(debounceMs) || 0 } })} keyboardType="numeric" />
          <Pressable onPress={() => chooseScreensaverTrigger()} style={styles.row}><Text style={styles.rowText}>Screensaver trigger</Text><Text style={styles.rowValue}>{sourceLabels[config.presence.screensaverTrigger]}</Text></Pressable>
        </View>
        {!capabilities.bluetooth ? <View style={styles.warning}><Text style={styles.warningText}>Bluetooth scanning unavailable or permission not granted. Registered targets will remain unavailable.</Text></View> : null}
        {!capabilities.light ? <View style={styles.warning}><Text style={styles.warningText}>Ambient light sensor not available on this device.</Text></View> : null}
        {!capabilities.vibration ? <View style={styles.warning}><Text style={styles.warningText}>Motion sensors not available on this device.</Text></View> : null}
        <View style={styles.card}>
          <ToggleRow label="Bluetooth detector" value={config.bluetooth.enabled} onValueChange={(enabled) => update({ bluetooth: { ...config.bluetooth, enabled } })} />
          <View style={styles.row}><Text style={styles.rowText}>Targets</Text><Text style={styles.rowValue}>{config.bluetooth.devices.length || 'None registered'}</Text></View>
          <View style={styles.row}><Text style={styles.rowText}>Current target RSSI</Text><Text style={styles.rowValue}>{nativeStatus.bluetoothTargets?.map((target) => `${target.name}: ${target.rssi ?? '--'} dBm`).join(', ') || 'Unavailable'}</Text></View>
          {config.bluetooth.devices.map((target) => <View key={target.id} style={{ borderTopColor: '#1e2a3b', borderTopWidth: 1, padding: 15 }}><Text style={styles.rowText}>{target.name}</Text><Field label="Weakest allowed signal (dBm)" value={String(target.minimumRssi)} onChangeText={(minimumRssi) => update({ bluetooth: { ...config.bluetooth, devices: config.bluetooth.devices.map((item) => item.id === target.id ? { ...item, minimumRssi: Number(minimumRssi) || -80 } : item) } })} keyboardType="numeric" /><Field label="Lost-device timeout (ms)" value={String(target.lostTimeoutMs)} onChangeText={(lostTimeoutMs) => update({ bluetooth: { ...config.bluetooth, devices: config.bluetooth.devices.map((item) => item.id === target.id ? { ...item, lostTimeoutMs: Number(lostTimeoutMs) || 60_000 } : item) } })} keyboardType="numeric" /><Pressable onPress={() => update({ bluetooth: { ...config.bluetooth, devices: config.bluetooth.devices.filter((item) => item.id !== target.id) } })} style={styles.smallButton}><Text style={styles.smallButtonText}>Remove target</Text></Pressable></View>)}
          <Pressable onPress={() => void registerNearby()} style={styles.smallButton}><Text style={styles.smallButtonText}>Pair / register nearby device</Text></Pressable>
          <Text style={[styles.muted, { padding: 15 }]}>Register nearby advertisements, not active phone connections. A target must advertise a stable identifier for reliable tracking.</Text>
        </View>
        <View style={styles.card}>
          <ToggleRow label="Ambient light detector" value={config.light.enabled} onValueChange={(enabled) => update({ light: { ...config.light, enabled } })} />
          <View style={styles.row}><Text style={styles.rowText}>Live reading</Text><StatusValue status={nativeStatus} /></View>
          <View style={styles.row}><Text style={styles.rowText}>Learned baseline</Text><Text style={styles.rowValue}>Local adaptive model</Text></View>
          <Pressable onPress={() => void nativeCompanion?.resetLightBaseline?.()} style={styles.smallButton}><Text style={styles.smallButtonText}>Reset learned baseline</Text></Pressable>
        </View>
        <View style={styles.card}>
          <ToggleRow label="Vibration detector" value={config.vibration.enabled} onValueChange={(enabled) => update({ vibration: { ...config.vibration, enabled } })} />
          <Field label="Tolerance" value={String(config.vibration.tolerance)} onChangeText={(tolerance) => update({ vibration: { ...config.vibration, tolerance: Number(tolerance) || 0 } })} keyboardType="numeric" />
          <View style={styles.row}><Text style={styles.rowText}>Baseline / threshold</Text><Text style={styles.rowValue}>{nativeStatus.vibrationBaseline?.toFixed(3) ?? '--'} / {nativeStatus.vibrationThreshold?.toFixed(3) ?? '--'}</Text></View>
          <Pressable onPress={() => void nativeCompanion?.calibrateVibration?.(10_000)} style={styles.smallButton}><Text style={styles.smallButtonText}>{nativeStatus.vibrationCalibrating ? 'Calibrating...' : 'Calibrate idle vibration'}</Text></Pressable>
          <View style={styles.row}><Text style={styles.rowText}>Live reading</Text><StatusValue status={{ ...nativeStatus, ambientLightLux: undefined }} /></View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Audio</Text>
        <View style={styles.card}><ToggleRow label="Enabled" value={config.audio.enabled} onValueChange={(enabled) => update({ audio: { ...config.audio, enabled } })} /><ToggleRow label="Clap actions" value={config.audio.clapDetection} onValueChange={(clapDetection) => update({ audio: { ...config.audio, clapDetection } })} /><ToggleRow label="Breathing experiment" value={config.audio.breathingExperiment} onValueChange={(breathingExperiment) => update({ audio: { ...config.audio, breathingExperiment } })} /><Field label="Sensitivity" value={String(config.audio.sensitivity)} onChangeText={(sensitivity) => update({ audio: { ...config.audio, sensitivity: Number(sensitivity) || 0.6 } })} keyboardType="numeric" /><Pressable onPress={() => void chooseAudioInput()} style={styles.row}><Text style={styles.rowText}>Input device</Text><Text style={styles.rowValue}>{config.audio.inputDeviceId ?? 'System default'}</Text></Pressable><View style={styles.row}><Text style={styles.rowText}>Live signal energy</Text><Text style={styles.rowValue}>{nativeStatus.audioEnergy?.toFixed(3) ?? '--'}</Text></View><View style={styles.row}><Text style={styles.rowText}>Breathing confidence</Text><Text style={styles.rowValue}>{nativeStatus.breathingConfidence?.toFixed(2) ?? '--'}</Text></View><Text style={[styles.muted, { padding: 15 }]}>Raw microphone buffers are analyzed locally and discarded. Breathing stays outside main presence.</Text></View>
        {!capabilities.microphone ? <View style={styles.warning}><Text style={styles.warningText}>Microphone unavailable or permission not granted.</Text></View> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Camera & Recording</Text>
        <View style={styles.card}><ToggleRow label="Camera enabled" value={config.camera.enabled} onValueChange={(enabled) => update({ camera: { ...config.camera, enabled } })} /><ToggleRow label="Motion detection" value={config.camera.motionDetection} onValueChange={(motionDetection) => update({ camera: { ...config.camera, motionDetection } })} /><ToggleRow label="Use camera as presence" value={config.camera.useAsPresence} onValueChange={(useAsPresence) => update({ camera: { ...config.camera, useAsPresence } })} /><ToggleRow label="Record unexpected clips" value={config.clips.enabled} onValueChange={(enabled) => update({ clips: { ...config.clips, enabled } })} /><Field label="Motion sensitivity (%)" value={String(config.camera.sensitivity)} onChangeText={(sensitivity) => update({ camera: { ...config.camera, sensitivity: Number(sensitivity) || 9 } })} keyboardType="numeric" /><Field label="Zoom" value={String(config.camera.zoom)} onChangeText={(zoom) => update({ camera: { ...config.camera, zoom: Number(zoom) || 1 } })} keyboardType="numeric" /><Field label="Clip storage directory" value={config.clips.directory ?? ''} onChangeText={(directory) => update({ clips: { ...config.clips, directory: directory || undefined } })} /><Field label="Clip retention value" value={String(config.clips.retentionValue)} onChangeText={(retentionValue) => update({ clips: { ...config.clips, retentionValue: Math.max(1, Number(retentionValue) || 1) } })} keyboardType="numeric" /><Field label="Post-motion seconds" value={String(config.clips.postMotionSeconds)} onChangeText={(postMotionSeconds) => update({ clips: { ...config.clips, postMotionSeconds: Math.max(1, Number(postMotionSeconds) || 1) } })} keyboardType="numeric" /><Pressable onPress={() => chooseRetentionUnit()} style={styles.row}><Text style={styles.rowText}>Clip retention unit</Text><Text style={styles.rowValue}>{config.clips.retentionUnit}</Text></Pressable><View style={styles.row}><Text style={styles.rowText}>Selected camera</Text><Text style={styles.rowValue}>{config.camera.cameraId || 'Default available camera'}</Text></View><Pressable onPress={() => void selectCamera()} style={styles.smallButton}><Text style={styles.smallButtonText}>Select capture device</Text></Pressable><View style={styles.row}><Text style={styles.rowText}>Motion</Text><Text style={styles.rowValue}>{nativeStatus.cameraMotionPercent?.toFixed(1) ?? '--'}%</Text></View><View style={styles.row}><Text style={styles.rowText}>Clip storage</Text><Text style={styles.rowValue}>{nativeStatus.clipStorageUsage ?? '--'} bytes</Text></View></View>
        {!capabilities.camera ? <View style={styles.warning}><Text style={styles.warningText}>Camera unavailable or permission not granted.</Text></View> : null}
      </View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Local Servers</Text><View style={styles.card}><ToggleRow label="Authenticated clip server" value={config.clipServer.enabled} onValueChange={(enabled) => update({ clipServer: { ...config.clipServer, enabled } })} /><ToggleRow label="Wi-Fi only" value={config.clipServer.wifiOnly} onValueChange={(wifiOnly) => update({ clipServer: { ...config.clipServer, wifiOnly } })} /><Field label="Clip server username" value={config.clipServer.username} onChangeText={(username) => update({ clipServer: { ...config.clipServer, username } })} /><Field label="New clip server password" value={clipPassword} onChangeText={setClipPassword} secureTextEntry /><Pressable onPress={() => void saveServerPassword('clip')} style={styles.smallButton}><Text style={styles.smallButtonText}>Save clip password securely</Text></Pressable><ToggleRow label="Authenticated camera server" value={config.cameraServer.enabled} onValueChange={(enabled) => update({ cameraServer: { ...config.cameraServer, enabled } })} /><ToggleRow label="Camera Wi-Fi only" value={config.cameraServer.wifiOnly} onValueChange={(wifiOnly) => update({ cameraServer: { ...config.cameraServer, wifiOnly } })} /><Pressable onPress={() => chooseCameraMode()} style={styles.row}><Text style={styles.rowText}>Camera stream mode</Text><Text style={styles.rowValue}>{config.cameraServer.mode}</Text></Pressable><Field label="Camera stream username" value={config.cameraServer.username} onChangeText={(username) => update({ cameraServer: { ...config.cameraServer, username } })} /><Field label="New camera stream password" value={cameraPassword} onChangeText={setCameraPassword} secureTextEntry /><Pressable onPress={() => void saveServerPassword('camera')} style={styles.smallButton}><Text style={styles.smallButtonText}>Save camera password securely</Text></Pressable><View style={styles.row}><Text style={styles.rowText}>LAN address</Text><Text style={styles.rowValue}>{localIp ?? 'Unavailable'}</Text></View>{localIp && config.clipServer.enabled ? <Text style={styles.muted}>Clips: http://{localIp}:{config.clipServer.port}</Text> : null}{localIp && config.cameraServer.enabled ? <Text style={styles.muted}>Camera: http://{localIp}:{config.cameraServer.port}/camera/stream.mjpeg</Text> : null}<Text style={[styles.muted, { padding: 15 }]}>Servers bind to Wi-Fi/LAN only when enabled. Clip and camera credentials are separate from MQTT credentials. No Internet port forwarding is configured.</Text></View></View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Diagnostics</Text><View style={styles.card}><View style={styles.row}><Text style={styles.rowText}>MQTT</Text><Text style={styles.rowValue}>{mqttStatus.state}</Text></View><View style={styles.row}><Text style={styles.rowText}>Ambient light</Text><StatusValue status={nativeStatus} /></View><View style={styles.row}><Text style={styles.rowText}>Audio energy</Text><Text style={styles.rowValue}>{nativeStatus.audioEnergy?.toFixed(3) ?? 'Unavailable'}</Text></View><View style={styles.row}><Text style={styles.rowText}>Battery / thermal</Text><Text style={styles.rowValue}>{nativeStatus.batteryPercent?.toFixed(0) ?? '--'}% / {nativeStatus.thermalStatus ?? '--'}</Text></View><View style={styles.row}><Text style={styles.rowText}>Camera service</Text><Text style={styles.rowValue}>{config.camera.enabled ? 'Enabled' : 'Disabled'}</Text></View><Text style={[styles.muted, { padding: 15 }]}>Detector processing remains local. MQTT publishes derived states and events only.</Text></View></View>
    </ScrollView>
  );

  async function registerNearby() {
    if (!nativeCompanion?.scanNearby) {
      Alert.alert('Unavailable', 'Bluetooth scanner is unavailable on this build or device.');
      return;
    }
    try {
      const devices = await nativeCompanion.scanNearby();
      if (devices.length === 0) {
        Alert.alert('No advertisements', 'Nearby device is not advertising or Android did not expose a stable identifier.');
        return;
      }
      Alert.alert('Register device', 'Select nearby target', [...devices.slice(0, 5).map((device) => ({
        text: `${device.name || 'Unknown'} (${device.rssi} dBm)`,
        onPress: () => onChange({ ...config, bluetooth: { ...config.bluetooth, devices: [...config.bluetooth.devices, { id: device.id, name: device.name || device.id, minimumRssi: -80, lostTimeoutMs: 60_000, smoothing: 0.35 }] } }),
      })), { text: 'Cancel', style: 'cancel' as const }]);
    } catch (error) {
      Alert.alert('Bluetooth scan failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function selectCamera() {
    if (!nativeCompanion?.getCameras) {
      Alert.alert('Unavailable', 'Camera enumeration is unavailable on this build or device.');
      return;
    }
    try {
      const cameras = await nativeCompanion.getCameras();
      if (cameras.length === 0) { Alert.alert('No camera', 'Android did not expose a camera.'); return; }
      Alert.alert('Select camera', undefined, [...cameras.map((camera) => ({ text: camera.name, onPress: () => onChange({ ...config, camera: { ...config.camera, cameraId: camera.id } }) })), { text: 'Cancel', style: 'cancel' as const }]);
    } catch (error) {
      Alert.alert('Camera enumeration failed', error instanceof Error ? error.message : String(error));
    }
  }

  function chooseScreensaverTrigger() {
    const sources = (['bluetooth', 'light', 'vibration', 'camera'] as PresenceSource[]).map((source) => ({ text: sourceLabels[source], onPress: () => onChange({ ...config, presence: { ...config.presence, screensaverTrigger: source } }) }));
    Alert.alert('Screensaver trigger', 'Present shows Dashwise frame. Away renders a native black screen.', [...sources, { text: 'Cancel', style: 'cancel' as const }]);
  }

  function chooseRetentionUnit() {
    Alert.alert('Clip retention unit', undefined, [
      { text: 'Hours', onPress: () => onChange({ ...config, clips: { ...config.clips, retentionUnit: 'hours' } }) },
      { text: 'Days', onPress: () => onChange({ ...config, clips: { ...config.clips, retentionUnit: 'days' } }) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function chooseCameraMode() {
    Alert.alert('Camera stream mode', undefined, [
      { text: 'Always stream', onPress: () => onChange({ ...config, cameraServer: { ...config.cameraServer, mode: 'always' } }) },
      { text: 'Absence + motion only', onPress: () => onChange({ ...config, cameraServer: { ...config.cameraServer, mode: 'absence-motion-only' } }) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function requestDisplayAdmin() {
    if (!nativeCompanion?.requestDisplayAdmin) { Alert.alert('Unavailable', 'Android display power control is unavailable on this build.'); return; }
    try { await nativeCompanion.requestDisplayAdmin(); Alert.alert('Permission requested', 'Enable FrameCompanion in Android device-admin settings, then return here.'); }
    catch (error) { Alert.alert('Display control unavailable', error instanceof Error ? error.message : String(error)); }
  }

  async function requestWriteSettings() {
    if (!nativeCompanion?.requestWriteSettings) { Alert.alert('Unavailable', 'Android brightness control is unavailable on this build.'); return; }
    try { await nativeCompanion.requestWriteSettings(); Alert.alert('Permission requested', 'Allow FrameCompanion to modify system settings, then return here.'); }
    catch (error) { Alert.alert('Brightness control unavailable', error instanceof Error ? error.message : String(error)); }
  }

  async function chooseAudioInput() {
    if (!nativeCompanion?.getAudioInputs) { Alert.alert('Unavailable', 'Android did not expose selectable audio inputs.'); return; }
    try {
      const inputs = await nativeCompanion.getAudioInputs();
      Alert.alert('Audio input', undefined, [{ text: 'System default', onPress: () => onChange({ ...config, audio: { ...config.audio, inputDeviceId: undefined } }) }, ...inputs.map((input) => ({ text: input.name, onPress: () => onChange({ ...config, audio: { ...config.audio, inputDeviceId: input.id } }) })), { text: 'Cancel', style: 'cancel' as const }]);
    } catch (error) { Alert.alert('Audio input enumeration failed', error instanceof Error ? error.message : String(error)); }
  }
}

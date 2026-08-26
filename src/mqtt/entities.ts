import { FrameCompanionConfig } from '../config/schema';
import { discoveryTopic, entityId, topics } from './topics';

export type MqttEntity = {
  component: 'binary_sensor' | 'sensor' | 'button' | 'event' | 'number' | 'switch';
  id: string;
  name: string;
  stateTopic?: string;
  eventTopic?: string;
  commandTopic?: string;
  min?: number;
  max?: number;
  step?: number;
  deviceClass?: string;
  unit?: string;
  icon?: string;
  entityCategory?: 'diagnostic' | 'config';
  eventTypes?: string[];
};

export function entities(config: FrameCompanionConfig): MqttEntity[] {
  const t = topics(config);
  const result: MqttEntity[] = [
    { component: 'binary_sensor', id: 'main_presence', name: 'Main Presence', stateTopic: t.state('main_presence'), deviceClass: 'occupancy' },
    { component: 'binary_sensor', id: 'bluetooth_presence', name: 'Bluetooth Presence', stateTopic: t.state('bluetooth_presence'), deviceClass: 'presence' },
    { component: 'binary_sensor', id: 'light_presence', name: 'Light Presence', stateTopic: t.state('light_presence'), deviceClass: 'motion' },
    { component: 'binary_sensor', id: 'vibration_presence', name: 'Vibration Presence', stateTopic: t.state('vibration_presence'), deviceClass: 'motion' },
    { component: 'binary_sensor', id: 'camera_presence', name: 'Camera Presence', stateTopic: t.state('camera_presence'), deviceClass: 'motion' },
    { component: 'binary_sensor', id: 'unexpected_motion', name: 'Unexpected Motion', stateTopic: t.state('unexpected_motion'), deviceClass: 'motion' },
    { component: 'binary_sensor', id: 'breathing_detected', name: 'Breathing Detected', stateTopic: t.state('breathing_detected'), icon: 'mdi:weather-windy' },
    { component: 'sensor', id: 'ambient_light', name: 'Ambient Light', stateTopic: t.state('ambient_light'), unit: 'lx', deviceClass: 'illuminance' },
    { component: 'sensor', id: 'battery_percentage', name: 'Battery Percentage', stateTopic: t.state('battery_percentage'), unit: '%', deviceClass: 'battery' },
    { component: 'sensor', id: 'brightness', name: 'Brightness', stateTopic: t.state('brightness'), unit: '%', icon: 'mdi:brightness-6' },
    { component: 'sensor', id: 'vibration_level', name: 'Vibration Level', stateTopic: t.state('vibration_level'), icon: 'mdi:vibrate' },
    { component: 'sensor', id: 'volume', name: 'Volume', stateTopic: t.state('volume'), unit: '%', icon: 'mdi:volume-high' },
    { component: 'number', id: 'volume_control', name: 'Volume Control', stateTopic: t.state('volume'), commandTopic: t.command('volume'), min: 0, max: 100, step: 1, icon: 'mdi:volume-high' },
    { component: 'switch', id: 'display', name: 'Display', stateTopic: t.state('display'), commandTopic: t.command('display'), icon: 'mdi:monitor' },
    { component: 'number', id: 'brightness_control', name: 'Brightness Control', stateTopic: t.state('brightness'), commandTopic: t.command('brightness'), min: 0, max: 100, step: 1, unit: '%', icon: 'mdi:brightness-6' },
    { component: 'switch', id: 'auto_brightness', name: 'Auto Brightness', stateTopic: t.state('auto_brightness'), commandTopic: t.command('auto_brightness'), icon: 'mdi:brightness-auto' },
    { component: 'sensor', id: 'presence_sources', name: 'Presence Sources', stateTopic: t.state('presence_sources'), icon: 'mdi:account-multiple-check' },
    { component: 'sensor', id: 'mqtt_connection', name: 'MQTT Connection', stateTopic: t.state('mqtt_connection'), entityCategory: 'diagnostic', icon: 'mdi:lan-connect' },
    { component: 'sensor', id: 'last_presence_source', name: 'Last Presence Source', stateTopic: t.state('last_presence_source'), entityCategory: 'diagnostic' },
    { component: 'sensor', id: 'last_presence_change', name: 'Last Presence Change', stateTopic: t.state('last_presence_change'), entityCategory: 'diagnostic', deviceClass: 'timestamp' },
    { component: 'sensor', id: 'camera_service', name: 'Camera Service', stateTopic: t.state('camera_service'), entityCategory: 'diagnostic' },
    { component: 'sensor', id: 'clip_storage_usage', name: 'Clip Storage Usage', stateTopic: t.state('clip_storage_usage'), unit: 'B', entityCategory: 'diagnostic', icon: 'mdi:harddisk' },
    { component: 'event', id: 'clap_actions', name: 'Clap Actions', eventTopic: t.event('clap_actions'), eventTypes: ['single_clap', 'double_clap', 'triple_clap'] },
    { component: 'event', id: 'unexpected_motion_event', name: 'Unexpected Motion Event', eventTopic: t.event('unexpected_motion'), eventTypes: ['unexpected_motion'] },
  ];
  for (const target of config.bluetooth.devices) {
    result.push({ component: 'sensor', id: `bluetooth_rssi_${entityId(target.id)}`, name: `${target.name} RSSI`, stateTopic: t.state(`bluetooth_rssi_${target.id}`), unit: 'dBm', deviceClass: 'signal_strength' });
    result.push({ component: 'binary_sensor', id: `bluetooth_${entityId(target.id)}_presence`, name: `${target.name} Presence`, stateTopic: t.state(`bluetooth_${target.id}_presence`), deviceClass: 'presence' });
  }
  return result;
}

export type DiscoveryMessage = { topic: string; payload: string; retain: true };

export function discoveryMessages(config: FrameCompanionConfig): DiscoveryMessage[] {
  const deviceId = entityId(config.mqtt.clientId);
  const device = {
    identifiers: [`framecompanion_${deviceId}`],
    name: config.deviceName,
    manufacturer: 'Dashwise',
    model: 'FrameCompanion',
    sw_version: '0.2.0',
  };
  return entities(config).map((entity) => {
    const payload: Record<string, unknown> = {
      name: entity.name,
      unique_id: `framecompanion_${deviceId}_${entityId(entity.id)}`,
      object_id: `framecompanion_${entityId(entity.id)}`,
      device,
      availability_topic: topics(config).availability,
      payload_available: 'online',
      payload_not_available: 'offline',
      icon: entity.icon,
      entity_category: entity.entityCategory,
    };
    if (entity.stateTopic) payload.state_topic = entity.stateTopic;
    if (entity.commandTopic) payload.command_topic = entity.commandTopic;
    if (entity.eventTopic) {
      payload.state_topic = entity.eventTopic;
      payload.event_types = entity.eventTypes;
      payload.value_template = '{{ value_json.event_type }}';
    }
    if (entity.deviceClass) payload.device_class = entity.deviceClass;
    if (entity.unit) payload.unit_of_measurement = entity.unit;
    if (entity.min !== undefined) payload.min = entity.min;
    if (entity.max !== undefined) payload.max = entity.max;
    if (entity.step !== undefined) payload.step = entity.step;
    if (entity.component === 'binary_sensor') {
      payload.payload_on = 'ON';
      payload.payload_off = 'OFF';
    }
    if (entity.component === 'switch') {
      payload.payload_on = 'ON';
      payload.payload_off = 'OFF';
    }
    return { topic: discoveryTopic(config, entity.component, entity.id), payload: JSON.stringify(payload), retain: true as const };
  });
}

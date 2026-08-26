import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig } from '../src/config/schema';
import { discoveryMessages } from '../src/mqtt/entities';
import { discoveryTopic, topics } from '../src/mqtt/topics';

test('MQTT topics and discovery IDs are stable', () => {
  const config = defaultConfig('abc123');
  const first = discoveryMessages(config);
  const second = discoveryMessages(config);
  assert.deepEqual(first, second);
  assert.equal(topics(config).availability, 'framecompanion/abc123/availability');
  assert.match(discoveryTopic(config, 'binary_sensor', 'main_presence'), /^homeassistant\/binary_sensor\/framecompanion_/);
  assert.match(JSON.parse(first[0].payload).unique_id, /^framecompanion_/);
});

test('registered targets receive stable RSSI and presence entities', () => {
  const config = defaultConfig('abc123');
  config.bluetooth.devices.push({ id: 'AA:BB:CC', name: 'Phone', minimumRssi: -75, lostTimeoutMs: 60_000, smoothing: 0.35 });
  const messages = discoveryMessages(config);
  assert.ok(messages.some((message) => message.topic.includes('bluetooth_rssi_aa_bb_cc')));
  assert.ok(messages.some((message) => message.topic.includes('bluetooth_aa_bb_cc_presence')));
});

test('system controls and battery are discoverable', () => {
  const messages = discoveryMessages(defaultConfig('abc123'));
  assert.ok(messages.some((message) => message.topic.includes('battery_percentage')));
  const volume = messages.find((message) => message.topic.includes('volume_control'));
  assert.equal(JSON.parse(volume?.payload ?? '{}').command_topic, 'framecompanion/abc123/command/volume');
  const display = messages.find((message) => message.topic.includes('_display/config'));
  assert.equal(JSON.parse(display?.payload ?? '{}').command_topic, 'framecompanion/abc123/command/display');
  const brightness = messages.find((message) => message.topic.includes('_brightness_control/config'));
  assert.equal(JSON.parse(brightness?.payload ?? '{}').command_topic, 'framecompanion/abc123/command/brightness');
  const autoBrightness = messages.find((message) => message.topic.includes('_auto_brightness/config'));
  assert.equal(JSON.parse(autoBrightness?.payload ?? '{}').command_topic, 'framecompanion/abc123/command/auto_brightness');
});

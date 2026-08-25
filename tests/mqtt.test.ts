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

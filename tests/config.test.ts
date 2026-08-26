import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, migrateConfig } from '../src/config/schema';

test('configuration migration preserves legacy launcher data and new defaults', () => {
  const config = migrateConfig({ baseUrl: 'https://dashwise.local/', pinnedPackages: ['a'] }, 'tablet');
  assert.equal(config.version, 1);
  assert.equal(config.dashwiseUrl, 'https://dashwise.local/');
  assert.deepEqual(config.pinnedPackages, ['a']);
  assert.equal(config.mqtt.clientId, 'framecompanion-tablet');
  assert.equal(config.presence.screensaverTrigger, 'bluetooth');
  assert.equal(config.clipServer.wifiOnly, true);
});

test('defaults keep camera outside owner absence checks', () => {
  const config = defaultConfig('phone');
  assert.deepEqual(config.presence.ownerAbsenceSources, ['bluetooth', 'light', 'vibration']);
  assert.equal(config.cameraServer.mode, 'absence-motion-only');
});

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

test('configuration preserves hardcoded Bluetooth MAC', () => {
  const config = migrateConfig({
    bluetooth: { devices: [{ id: 'scan-id', macAddress: 'AA:BB:CC:DD:EE:FF', name: 'Phone', minimumRssi: -80, lostTimeoutMs: 60_000, smoothing: 0.35 }] },
  });
  assert.equal(config.bluetooth.devices[0].macAddress, 'AA:BB:CC:DD:EE:FF');
});

test('defaults keep camera outside owner absence checks', () => {
  const config = defaultConfig('phone');
  assert.deepEqual(config.presence.ownerAbsenceSources, ['bluetooth', 'light', 'vibration']);
  assert.equal(config.cameraServer.mode, 'absence-motion-only');
});

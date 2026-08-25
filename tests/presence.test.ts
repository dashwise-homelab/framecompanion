import assert from 'node:assert/strict';
import test from 'node:test';
import { PresenceEngine } from '../src/presence/PresenceEngine';
import { isBluetoothPresent, smoothRssi } from '../src/presence/bluetooth';
import { isLightSpike } from '../src/presence/ambientLight';
import { vibrationPresent } from '../src/presence/vibration';

test('PresenceEngine fuses enabled sources after debounce', () => {
  let now = 0;
  const engine = new PresenceEngine({ enabledSources: ['bluetooth', 'light'], ownerAbsenceSources: ['bluetooth'], debounceMs: 100, now: () => now });
  engine.update('bluetooth', true);
  assert.equal(engine.getSnapshot().mainPresent, false);
  now = 100;
  engine.update('bluetooth', true);
  assert.equal(engine.getSnapshot().mainPresent, true);
  assert.deepEqual(engine.getSnapshot().activeSources, ['bluetooth']);
  engine.update('bluetooth', false);
  now = 200;
  engine.update('bluetooth', false);
  assert.equal(engine.getSnapshot().mainPresent, false);
});

test('RSSI smoothing and timeout use signal threshold', () => {
  assert.equal(smoothRssi(undefined, -70), -70);
  assert.equal(Math.round(smoothRssi(-70, -50, 0.5)), -60);
  assert.equal(isBluetoothPresent({ smoothed: -60, lastSeenAt: 900 }, -65, 200, 1000), true);
  assert.equal(isBluetoothPresent({ smoothed: -80, lastSeenAt: 900 }, -65, 200, 1000), false);
  assert.equal(isBluetoothPresent({ smoothed: -60, lastSeenAt: 700 }, -65, 200, 1000), false);
});

test('light spike requires both absolute and relative change', () => {
  assert.equal(isLightSpike(30, 2, 25, 100), true);
  assert.equal(isLightSpike(20, 10, 25, 100), false);
  assert.equal(isLightSpike(30, 20, 5, 100), false);
});

test('vibration compares energy against calibrated idle baseline', () => {
  assert.equal(vibrationPresent(0.31, 0.1, 0.2), true);
  assert.equal(vibrationPresent(0.3, 0.1, 0.2), false);
});

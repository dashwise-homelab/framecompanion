import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyClaps } from '../src/audio/clapDetector';
import { isExpired, retentionCutoff } from '../src/camera/ClipRecorder';
import { changedAreaPercent } from '../src/camera/MotionDetector';

test('clap grouping emits one action for one sequence', () => {
  assert.equal(classifyClaps([100]), 'single_clap');
  assert.equal(classifyClaps([100, 350]), 'double_clap');
  assert.equal(classifyClaps([100, 350, 700]), 'triple_clap');
  assert.equal(classifyClaps([100, 1_500]), null);
});

test('clip retention supports hours and days', () => {
  const now = Date.parse('2026-08-25T21:00:00Z');
  assert.equal(retentionCutoff(now, 1, 'days'), now - 86_400_000);
  assert.equal(isExpired(now - 86_400_001, now, 1, 'days'), true);
  assert.equal(isExpired(now - 3_599_000, now, 1, 'hours'), false);
});

test('motion detector computes changed area', () => {
  assert.equal(changedAreaPercent(new Uint8Array([0, 0, 0, 0]), new Uint8Array([0, 20, 0, 30]), 18), 50);
});

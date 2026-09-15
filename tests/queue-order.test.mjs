import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node strips the (erasable-only) types in this module, so the dashboard's
// pure ordering rule is tested here without a bundler.
import { orderQueue, runKey } from '../dashboard/src/queueOrder.ts';

const t = (h) => new Date(Date.UTC(2026, 8, 11, h)).toISOString();
const row = (id, runId, relevanceScore, hour) => ({ id, runId, relevanceScore, createdAt: t(hour) });

// Bridge order: created_at DESC. Run B (newer) then run A (older).
const queue = [
  row('b3', 'B', 5, 12),
  row('b2', 'B', null, 11),
  row('b1', 'B', 8, 10),
  row('a2', 'A', 9, 3),
  row('a1', 'A', 6, 2),
];

test('newest sort leaves the bridge order alone', () => {
  assert.deepEqual(orderQueue(queue, '').map(o => o.id), ['b3', 'b2', 'b1', 'a2', 'a1']);
});

test('score sort orders inside a run only — an older run never rises above a newer one', () => {
  // a2 is a 9, the best score in the queue, but run A is older so it stays below all of run B.
  assert.deepEqual(orderQueue(queue, 'score').map(o => o.id), ['b1', 'b3', 'b2', 'a2', 'a1']);
});

test('unscored rows sink to the bottom of their run; ties break by recency', () => {
  const q = [row('x2', 'R', 7, 5), row('x1', 'R', 7, 4), row('x0', 'R', null, 6)];
  assert.deepEqual(orderQueue(q, 'score').map(o => o.id), ['x2', 'x1', 'x0']);
});

test('run-less rows form their own blocks placed by their own time', () => {
  const q = [row('e1', null, 3, 11), row('b1', 'B', 8, 10), row('e0', null, 10, 5), row('a1', 'A', 9, 3)];
  assert.deepEqual(orderQueue(q, 'score').map(o => o.id), ['e1', 'b1', 'e0', 'a1']);
  assert.equal(runKey(q[0]), 'none');
  assert.equal(runKey(q[1]), 'B');
});

test('score sort does not mutate the input', () => {
  const copy = queue.map(o => ({ ...o }));
  orderQueue(queue, 'score');
  assert.deepEqual(queue, copy);
});

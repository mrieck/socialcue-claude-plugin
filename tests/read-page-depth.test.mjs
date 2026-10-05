import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkAXNodes, effectiveMaxDepth, DEFAULT_MAX_DEPTH } from '../mcp/browser-server/browser.js';

// Build a flat CDP-style AX node list: root -> N ignored/unnamed wrappers ->
// a named leaf. Mirrors what Threads does (posts sit 32+ raw levels down).
function deepTree(wrapperCount, leaf) {
  const nodes = [{ nodeId: 'root', role: { value: 'RootWebArea' }, name: { value: 'Home' }, childIds: ['w0'] }];
  for (let i = 0; i < wrapperCount; i++) {
    const last = i === wrapperCount - 1;
    nodes.push({
      nodeId: `w${i}`, parentId: i === 0 ? 'root' : `w${i - 1}`,
      role: { value: 'none' }, ignored: i % 2 === 0, name: { value: '' },
      childIds: [last ? 'leaf' : `w${i + 1}`],
    });
  }
  nodes.push({ nodeId: 'leaf', parentId: `w${wrapperCount - 1}`, ...leaf, childIds: [] });
  return nodes;
}

test('depth counts emitted nodes, so deep unnamed wrappers do not hide content', () => {
  const nodes = deepTree(35, { role: { value: 'link' }, name: { value: 'a post' }, properties: [{ name: 'url', value: { value: 'https://www.threads.com/@x/post/1' } }] });
  const out = walkAXNodes(nodes, { compact: true, maxDepth: 30 });
  assert.deepEqual(out.map(n => `${n.role}:${n.name}`), ['RootWebArea:Home', 'link:a post']);
  assert.equal(out[1].url, 'https://www.threads.com/@x/post/1');
});

test('a tiny maxDepth still clips by printed levels', () => {
  const nodes = deepTree(35, { role: { value: 'link' }, name: { value: 'a post' } });
  // Root is depth 0, the link is the first emitted descendant so depth 1.
  assert.equal(walkAXNodes(nodes, { compact: true, maxDepth: 0 }).length, 1);
  assert.equal(walkAXNodes(nodes, { compact: true, maxDepth: 1 }).length, 2);
});

test('emitted named nodes do advance depth', () => {
  // root -> region "Column body" -> generic "" (skipped) -> button "Like"
  const nodes = [
    { nodeId: 'r', role: { value: 'RootWebArea' }, name: { value: 'Home' }, childIds: ['reg'] },
    { nodeId: 'reg', parentId: 'r', role: { value: 'region' }, name: { value: 'Column body' }, childIds: ['g'] },
    { nodeId: 'g', parentId: 'reg', role: { value: 'generic' }, name: { value: '' }, childIds: ['b'] },
    { nodeId: 'b', parentId: 'g', role: { value: 'button' }, name: { value: 'Like' }, childIds: [] },
  ];
  assert.deepEqual(walkAXNodes(nodes, { compact: true, maxDepth: 1 }).map(n => n.name), ['Home', 'Column body']);
  assert.deepEqual(walkAXNodes(nodes, { compact: true, maxDepth: 2 }).map(n => n.name), ['Home', 'Column body', 'Like']);
});

test('compact mode still prunes navigation landmarks and text echoes', () => {
  const nodes = [
    { nodeId: 'r', role: { value: 'RootWebArea' }, name: { value: 'Page' }, childIds: ['nav', 'btn'] },
    { nodeId: 'nav', parentId: 'r', role: { value: 'navigation' }, name: { value: '' }, childIds: ['navlink'] },
    { nodeId: 'navlink', parentId: 'nav', role: { value: 'link' }, name: { value: 'Sidebar' }, childIds: [] },
    { nodeId: 'btn', parentId: 'r', role: { value: 'button' }, name: { value: 'Post' }, childIds: ['echo'] },
    { nodeId: 'echo', parentId: 'btn', role: { value: 'StaticText' }, name: { value: 'Post' }, childIds: [] },
  ];
  assert.deepEqual(walkAXNodes(nodes, { compact: true }).map(n => n.name), ['Page', 'Post']);
  assert.deepEqual(walkAXNodes(nodes, { compact: false }).map(n => n.name), ['Page', 'Sidebar', 'Post', 'Post']);
});

test('effectiveMaxDepth floors Threads and defaults everywhere else', () => {
  assert.equal(effectiveMaxDepth(undefined, 'https://www.reddit.com/r/x/'), DEFAULT_MAX_DEPTH);
  assert.equal(effectiveMaxDepth(12, 'https://www.reddit.com/r/x/'), 12);
  assert.equal(effectiveMaxDepth(12, 'https://www.threads.com/'), DEFAULT_MAX_DEPTH);
  assert.equal(effectiveMaxDepth(30, 'https://threads.com/search?q=x'), DEFAULT_MAX_DEPTH);
  assert.equal(effectiveMaxDepth(80, 'https://www.threads.com/'), 80);
  assert.equal(effectiveMaxDepth(0, 'not a url'), DEFAULT_MAX_DEPTH);
});

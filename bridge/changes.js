/**
 * Change signal for /api/changes.
 *
 * SQLite's `PRAGMA data_version` only moves when ANOTHER connection writes
 * (e.g. the discovery MCP server); writes made through the bridge's own
 * connection don't bump it. So the change token is data_version plus an
 * in-process counter bumped on every mutating bridge request. Both terms are
 * monotonic non-decreasing, so the sum strictly increases on any change.
 */
let localWrites = 0;

export function bumpWrites() {
  localWrites += 1;
}

export function changeToken(dataVersion) {
  return dataVersion + localWrites;
}

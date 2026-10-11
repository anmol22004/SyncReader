export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Recovery operations are kept even when a device has been offline for months.
export function expiredReceipt(receivedAt: number | undefined, operationId: string, pendingIds: Set<string>, now: number): boolean {
  return !pendingIds.has(operationId) && typeof receivedAt === 'number' && receivedAt < now - RETENTION_MS;
}
export function expiredUpload(createdAt: string | undefined, now: number): boolean {
  const time = Date.parse(createdAt || '');
  return Number.isFinite(time) && time < now - RETENTION_MS;
}

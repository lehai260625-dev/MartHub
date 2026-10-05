// User locks match issuance/rotation/revocation. No active or replay-relevant
// family is pruned; every delete step is bounded and commits independently.
export async function cleanupRefreshSessionBatch(prisma, limit = 500) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error('Session cleanup batch must contain 1-500 rows.');
  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw`
      SELECT u.id FROM users u
      WHERE EXISTS (SELECT s.family_id FROM refresh_sessions s WHERE s.user_id = u.id
        GROUP BY s.family_id
        HAVING GREATEST(MAX(s.expires_at), COALESCE(MAX(s.revoked_at), MAX(s.expires_at)))
          <= CURRENT_TIMESTAMP - INTERVAL '30 days'
          AND NOT BOOL_OR(s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP))
      ORDER BY u.id LIMIT ${limit} FOR UPDATE OF u SKIP LOCKED
    `;
    if (!users.length) return 0;
    const ids = users.map((user) => user.id);
    const rows = await tx.$queryRaw`
      WITH eligible AS (
        SELECT user_id, family_id FROM refresh_sessions
        WHERE user_id = ANY(${ids}::uuid[])
        GROUP BY user_id, family_id
        HAVING GREATEST(MAX(expires_at), COALESCE(MAX(revoked_at), MAX(expires_at)))
          <= CURRENT_TIMESTAMP - INTERVAL '30 days'
          AND NOT BOOL_OR(revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP)
      )
      SELECT s.id FROM refresh_sessions s
      JOIN eligible e ON e.user_id = s.user_id AND e.family_id = s.family_id
      WHERE NOT EXISTS (SELECT 1 FROM refresh_sessions child WHERE child.parent_session_id = s.id)
      ORDER BY s.expires_at, s.id LIMIT ${limit}
    `;
    if (!rows.length) return 0;
    const deleted = await tx.refreshSession.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return deleted.count;
  });
}

export async function cleanupRefreshSessions(prisma, { maxBatches = 20 } = {}) {
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100)
    throw new Error('Session cleanup requires 1-100 batch steps.');
  let deletedRows = 0;
  for (let batches = 1; batches <= maxBatches; batches += 1) {
    const deleted = await cleanupRefreshSessionBatch(prisma);
    deletedRows += deleted;
    if (!deleted) return { deletedRows, batches, batchLimitReached: false };
  }
  return { deletedRows, batches: maxBatches, batchLimitReached: true };
}

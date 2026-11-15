// Audit trail: who did what. Pass the transaction client when the action runs
// inside one, so the log entry commits or rolls back together with the change.
const { query } = require('../db/pool');

async function audit(db, req, action, entity, entityId, details) {
  const conn = db || { query };
  const u = (req && req.user) || {};
  await conn.query(
    `INSERT INTO pm_audit_log (user_id, username, action, entity, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      u.userId || null,
      u.username || null,
      action,
      entity,
      entityId === undefined || entityId === null ? null : String(entityId),
      details === undefined ? null : JSON.stringify(details)
    ]
  );
}

module.exports = { audit };

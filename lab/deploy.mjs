import { DatabaseSync } from 'node:sqlite';
import { createIntent, isExpired, verifyResolution } from '@countersignlabs/counter-sign';

export const relyingParty = 'approve.example.test';
const policy = {
  rpId: relyingParty,
  allowedOrigins: [`https://${relyingParty}`],
  requireUserVerification: true,
};

function describeDeployment(environment, revision) {
  if (!['staging', 'production'].includes(environment) || typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Expected a known environment and a full commit SHA');
  }
  return `Deploy ${revision} to ${environment}`;
}

// The fake deployment is the database insert itself. Its unique key makes
// recording the effect and consuming the approval one atomic operation.
export function openDeployLab(filename, { agent, authorityKey, approver }, now = Date.now) {
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, intent TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deployments (
      request_id TEXT PRIMARY KEY, environment TEXT NOT NULL, revision TEXT NOT NULL
    );
  `);
  return {
    request({ environment, revision }) {
      const intent = createIntent({
        action: 'deploy', summary: describeDeployment(environment, revision),
        approvers: [approver], default: 'reject', risk_tier: 'high', timeout: 60,
      }, agent);
      db.prepare('INSERT INTO requests VALUES (?, ?)').run(intent.intent_id, JSON.stringify(intent));
      return intent;
    },
    execute(requestId, resolution, { environment, revision }) {
      const request = db.prepare('SELECT intent FROM requests WHERE id = ?').get(requestId);
      if (!request) throw new Error('Unknown request');
      const intent = JSON.parse(request.intent);
      verifyResolution(intent, resolution, authorityKey, policy);
      if (resolution.policy !== 'approver' || resolution.decision !== 'approve') {
        throw new Error('Deployment was not approved');
      }
      if (intent.summary !== describeDeployment(environment, revision)) {
        throw new Error('Deployment differs from the approved request');
      }
      if (isExpired(intent, now())) throw new Error('Approval expired');
      const result = db.prepare(`
        INSERT INTO deployments VALUES (?, ?, ?) ON CONFLICT(request_id) DO NOTHING
      `).run(requestId, environment, revision);
      if (result.changes !== 1) throw new Error('Approval already used');
    },
    deployments() {
      return db.prepare('SELECT environment, revision FROM deployments ORDER BY rowid').all()
        .map(row => ({ ...row }));
    },
    close() { db.close(); },
  };
}

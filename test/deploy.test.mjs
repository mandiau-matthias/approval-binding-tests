import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deadline, generateKeypair } from '@countersignlabs/counter-sign';
import { openDeployLab } from '../lab/deploy.mjs';
import { softwarePasskey } from '../lab/software-passkey.mjs';

const staging = Object.freeze({ environment: 'staging', revision: 'a'.repeat(40) });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'approval-binding-'));
  const filename = join(directory, 'lab.sqlite');
  const passkey = softwarePasskey();
  const identities = {
    agent: { id: 'agent:fixture', keypair: generateKeypair() },
    authorityKey: generateKeypair().publicKey,
    approver: passkey.approver,
  };
  let time = Date.now();
  const open = () => openDeployLab(filename, identities, () => time);
  let worker = open();
  t.after(() => { worker.close(); rmSync(directory, { recursive: true, force: true }); });
  const intent = worker.request(staging);
  time = Date.parse(intent.created_at);
  const approval = passkey.respond(intent);
  return {
    intent, passkey, approval,
    get worker() { return worker; },
    run(candidate = staging, resolution = approval) {
      worker.execute(intent.intent_id, resolution, candidate);
    },
    restart() { worker.close(); worker = open(); },
    at(value) { time = value; },
  };
}

test('the approved commit reaches staging exactly once', t => {
  const lab = fixture(t);
  lab.run();
  assert.deepEqual(lab.worker.deployments(), [staging]);
});

for (const [name, candidate] of [
  ['switching staging to production', { ...staging, environment: 'production' }],
  ['swapping the approved commit', { ...staging, revision: 'b'.repeat(40) }],
]) {
  test(name + ' is blocked at execution', t => {
    const lab = fixture(t);
    assert.throws(() => lab.run(candidate), /differs from the approved request/);
    assert.deepEqual(lab.worker.deployments(), []);
    lab.run();
    assert.deepEqual(lab.worker.deployments(), [staging]);
  });
}

test('an approval already used stays spent after a worker restart', t => {
  const lab = fixture(t);
  lab.run();
  lab.restart();
  assert.throws(() => lab.run(), /already used/);
  assert.deepEqual(lab.worker.deployments(), [staging]);
});

test('the same receipt cannot authorize a fresh request for the identical release', t => {
  const lab = fixture(t);
  const next = lab.worker.request(staging);
  assert.throws(() => lab.worker.execute(next.intent_id, lab.approval, staging), /does not match intent/);
  assert.deepEqual(lab.worker.deployments(), []);
});

for (const [name, offset] of [['at the expiry boundary', 0], ['one day later', 86_400_000]]) {
  test('an unused approval is blocked ' + name, t => {
    const lab = fixture(t);
    lab.at(deadline(lab.intent) + offset);
    assert.throws(() => lab.run(), /Approval expired/);
    assert.deepEqual(lab.worker.deployments(), []);
  });
}

test('an unused approval works one millisecond before expiry', t => {
  const lab = fixture(t);
  lab.at(deadline(lab.intent) - 1);
  lab.run();
  assert.deepEqual(lab.worker.deployments(), [staging]);
});

for (const [name, options, error] of [
  ['user presence without verification', { verified: false }, /expected key/],
  ['an assertion from a different origin', { origin: 'https://elsewhere.example.test' }, /expected key/],
  ['a signed refusal', { decision: 'reject' }, /not approved/],
]) {
  test(name + ' leaves the deployment log empty', t => {
    const lab = fixture(t);
    assert.throws(() => lab.run(staging, lab.passkey.respond(lab.intent, options)), error);
    assert.deepEqual(lab.worker.deployments(), []);
  });
}

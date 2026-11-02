import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  canonicalize, COUNTERSIGN_VERSION, COUNTERSIGNATURE_CONTEXT,
} from '@countersignlabs/counter-sign';
import { relyingParty } from './deploy.mjs';

const sha256 = value => createHash('sha256').update(value).digest();

export function softwarePasskey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { x, y } = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(x, 'base64url'), Buffer.from(y, 'base64url')]);
  const approver = { actor: 'developer:fixture', mode: 'keyed', public_key: `webauthn-p256:${point.toString('base64url')}` };

  return {
    approver,
    respond(intent, { decision = 'approve', verified = true, origin = `https://${relyingParty}` } = {}) {
      const receipt = {
        countersign: COUNTERSIGN_VERSION, intent_id: intent.intent_id, decision,
        actor: approver.actor, policy: 'approver', timestamp: new Date().toISOString(),
        public_key: approver.public_key,
      };
      const challenge = sha256(`${COUNTERSIGNATURE_CONTEXT}\n${canonicalize(receipt)}`).toString('base64url');
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', origin, challenge }));
      // WebAuthn authenticator data: RP ID hash, presence/verification flags, zero counter.
      const authData = Buffer.concat([sha256(relyingParty), Buffer.from([verified ? 5 : 1, 0, 0, 0, 0])]);
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), privateKey);
      return {
        decision, policy: 'approver',
        countersignatures: [{
          ...receipt, signature: signature.toString('base64url'),
          webauthn: {
            authenticator_data: authData.toString('base64url'),
            client_data_json: clientData.toString('base64url'),
          },
        }],
      };
    },
  };
}

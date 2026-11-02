# What did the passkey approve?

A developer approves commit A for **staging**. Before execution, an agent asks for **production**. Does anything deploy?

This runnable lab exercises the published [counter-sign 0.2.0](https://www.npmjs.com/package/@countersignlabs/counter-sign/v/0.2.0) verifier and a small deployment worker. A deployment writes one row to a temporary SQLite database. All credentials are generated in memory. The tests run offline after installation.

## Run it

Use Node 22.13 or later.

```sh
git clone https://github.com/mandiau-matthias/approval-binding-tests.git
cd approval-binding-tests
npm ci --ignore-scripts
npm test
```

To run just the staging-to-production case:

```sh
node --test --test-name-pattern='switching staging to production'
```

| After approval | Expected effect |
| --- | --- |
| Original commit and staging destination | One deployment row |
| Change the destination or the commit | Zero rows. The original request can still run. |
| Reuse the approval after restarting the worker | The original row remains the only deployment. |
| Present the receipt on a new request for the same release | Zero rows |
| Execute one millisecond before the deadline | One row |
| Execute exactly at the deadline or a day later | Zero rows |
| Use presence alone, the wrong origin, or a signed refusal | Zero rows |

## Where the checks happen

counter-sign verifies the agent-signed intent and the P-256 WebAuthn receipt against the expected authority and relying-party policy. The test authenticator produces real signatures with a software key and simulated presence and user-verification flags. Touch ID, Face ID, browser prompts and what a person actually saw are outside this experiment.

The worker loads the original intent from its local database. Immediately before recording a deployment it compares both proposed arguments with the signed description, checks the deadline and requires a human approval. A unique request ID on the deployment row enforces single use across restarts. This atomic example models a database effect. An external deployment service would need its own idempotency and reconciliation.

## Try to break it

In a disposable checkout, remove the comparison between `intent.summary` and `describeDeployment(...)` in [the worker](lab/deploy.mjs), then run the tests again. The destination and commit substitution cases should turn red even though the receipt's signature is still valid. Restore the comparison and rerun.

[Matthias Mandiau · Automatron](https://github.com/mandiau-matthias) wrote the execution harness, software-key fixture and regression cases. The approval protocol and verifier come from [counter-sign](https://github.com/countersign-labs/counter-sign). If your team tries a case and it catches a mistake, [share a redacted reproduction](https://github.com/mandiau-matthias/approval-binding-tests/issues) after any affected system is fixed and the finding is public.

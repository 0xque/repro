# Golden checkout capsule

`checkout.repro` is the sanitized output of the real Chromium checkout demo. It contains five actions, a failure marker, two synthetic fixtures and the two-order observation. The archive is 2,189 bytes.

Inspect it without Docker access:

```bash
npm run build
node dist/packages/cli/src/index.js inspect fixtures/capsules/checkout.repro --json
```

The archive SHA-256 is `b8a1e64f013fb510d003170b5757d3c7b7040367d522a0e3cd2b5cfbfb29c6cd`. This example identifies the fixture recipe used in the verified local run. Changes to the recipe contract require capturing a new example for replay.

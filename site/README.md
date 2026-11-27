# REPRO site

The build note opens a single synthetic checkout specimen and contrasts two saved results. It does not accept uploads, call APIs, execute a capsule, or run a live checkout. See [the underlying local evidence](../docs/evidence/checkout.md).

`index.html` is self-contained. To generate the Cloudflare Worker module with Content Security Policy hashes, run `node site/build-worker.mjs` in the repository root. The generated file is intentionally ignored. The dedicated production Worker is routed on the project's requested hostname only. The private product repository is maintained separately from the public demo.

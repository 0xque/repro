# REPRO site

The build note opens a single synthetic checkout specimen and contrasts two saved results. It does not accept uploads, call APIs, execute a capsule, or run a live checkout. See [the underlying local evidence](../docs/evidence/checkout.md).

`index.html` is self-contained. To generate the Cloudflare Worker module with Content Security Policy hashes, run `node site/build-worker.mjs` in the repository root. The generated Worker is versioned with the HTML. The dedicated production Worker is routed on the project's requested hostname only. The private product repository is maintained separately from the public demo.

## Reading ruler

The article is static HTML. The only React island is the reading ruler. REPRO bundles its own copy of React and `LineMinimap` into the page; nothing is fetched at runtime. REPRO bridges the package’s seek events to the locally bundled, pinned Lenis 1.3.29 for wheel scroll and click easing. Direct ruler drag and keyboard steps stay immediate, native touch scrolling stays enabled, and reduced-motion mode uses the browser without Lenis. The animation frame runs only while easing is active. The leave-behind navigation links still lead to the article when JavaScript is disabled.

To update the island or its theme, run from the repo root:

```sh
npm --prefix site ci --ignore-scripts
npm --prefix site run build
```

Commit the rebuilt `site/index.html` and `site/worker.mjs` with the source change. If you only need to regenerate the Worker from committed HTML, run `node site/build-worker.mjs`; no npm install is needed for that path.

The private, owner-supplied `line-minimap-react@0.1.0` is vendored as source under `vendor/line-minimap-react/` without the original archive or local-path README. Source package archive SHA-256: `52b7ee4be45f94f0a9173c6e90e7175a3152bb48800ea3696e1055b41389c518`. Package source is not distributed as a separate download or represented as open-source. Third-party React, Scheduler, and Lenis notices are bundled into the inlined JavaScript.

## Footer endmark (off by default)

The Harmond SemiBold Condensed endmark has no checked-in font and is hidden in the standard build. Do not use the free/demo download: verify with [Dirtyline Studio](https://dirtylinestudio.com/pages/license) that the acquired license covers self-hosted web embedding and use as a branded wordmark. No font should be added to the repository. When the appropriately licensed, unmodified WOFF2 is available, generate an explicitly separate build:

```sh
REPRO_ENDMARK_LICENSED_WOFF2=/absolute/path/to/licensed-harmond.woff2 node site/build-worker.mjs
```

The result is `site/.build/worker-with-endmark.mjs` (ignored by Git), not the tracked Worker. The document reveals the mark only after the embedded face loads successfully. A regular build stays disabled and needs no font request. Review any enabled build before authorizing it for publication.

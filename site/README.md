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

## Bodoni Moda endmark

Only the closing wordmark uses Bodoni Moda by Owen Earl / the Bodoni Moda Project Authors. The self-hosted static face pins the variable font at `wght=520` and `opsz=76`; all other typography stays unchanged. The original [Google Fonts source](https://github.com/google/fonts/tree/634558fcb/ofl/bodonimoda) is pinned to revision `634558fcb` (roman variable SHA-256 `550f5e34ee0a828d7941b1fe9bc58b34e5260d3f33a61532e6d0a0114e79a5cf`). The approved static instance has SHA-256 `a4fd542b56511b7e722a354ff31229e6203c818b1016da46a8f49c8addcbba7a` and is distributed with its [SIL Open Font License 1.1 and copyright notice](assets/BodoniModa-OFL.txt). No Harmond files or proprietary-license build steps are used.

The Worker serves the pinned face and notice from the same origin. Only the four distinct letters in REPRO use it, with no preload, stylesheet request or CDN dependency. The footer is live HTML text; an unavailable font falls back to a system serif.

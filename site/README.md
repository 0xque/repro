# REPRO site

The case-file rail previews five sections of one synthetic checkout example. The note below it explains the packet, the five recorded browser actions, saved before/after results, and the current limits. It does not accept uploads, call APIs, execute a capsule, or run a live checkout. See [the underlying local evidence](../docs/evidence/checkout.md).

Scroll horizontally or use the tick ruler and arrow controls. When the rail or the ruler has keyboard focus, Left/Right step between panels and Home/End jump to the bounds. Reduced-motion preferences disable smooth programmatic scroll. Vertical scrolling is left to the page; without JavaScript the rail remains a native scroller and the long-form note is still readable.

`index.html` is self-contained. In the repository root, run:

```sh
node site/build-worker.mjs
node --test site/rail.test.mjs
```

The builder generates an ignored Cloudflare Worker module with style and script Content Security Policy hashes. The test suite checks Worker output and exercises the rail logic with controlled panel offsets. Open `site/index.html` in a browser for the standalone preview. The private product repository is maintained separately from the public demo.

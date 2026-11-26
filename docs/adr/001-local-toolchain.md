# ADR 001 · Local TypeScript workspace

Use TypeScript 6.0.3 on Node.js 26.13.0 with npm 12.2.1 and Playwright 1.65.1. Keep one root lockfile and use source boundaries for schema, capsules, redaction, recording, adapters, CLI and replay. The core archive reader imports schema and ZIP dependencies and can run on a host without a browser installed.

Use the SHA-pinned GitHub Actions workflow for install, type checks and offline unit tests. The Docker integration demo runs on a trusted local host and requires an explicit image preparation step. The Node.js version is from the [official release checksums](https://nodejs.org/dist/v26.13.0/SHASUMS256.txt). The browser version and revision are from the pinned Playwright package’s `browsers.json`. [Node.js release schedule](https://nodejs.org/en/about/previous-releases) · [Playwright release notes](https://playwright.dev/docs/release-notes)

The project is unpublished. Set a license and review the project and package names with the owner before distribution. Dependencies come from the locked registry graph and source files in this repository were written for this project. The app job uses base image digests in the Dockerfile. Ubuntu’s PostgreSQL 16 patch comes from the package repository at preparation, and each execution pins the resulting approved image ID.

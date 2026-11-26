# Third-party provenance

Project source was written for REPRO. The workspace has no vendored third-party source. The lockfile records exact npm tarball URLs, integrity values and declared licenses, including the transitive graph.

| Package | Version | Declared license |
| --- | --- | --- |
| `jsonc-parser` | 3.3.1 | MIT |
| `pg` | 8.23.1 | MIT |
| `playwright` | 1.65.1 | Apache-2.0 |
| `yaml` | 2.9.1 | ISC |
| `yauzl` | 3.4.0 | MIT |
| `yazl` | 3.3.1 | MIT |
| `zod` | 4.6.7 | MIT |
| `typescript` | 6.0.3 | Apache-2.0 |

The runner uses the official Node and Playwright OCI bases pinned in the Dockerfile. The tested image installed Ubuntu’s `postgresql-16` package version `16.15-0ubuntu0.24.04.1`. These upstream layers and packages retain their own licenses. Runtime files and browser dependencies are installed from those upstream sources without source modifications.

The local CI workflow pins `actions/checkout` to the upstream v6.1.0 commit and `actions/setup-node` to the v6.4.0 commit. The project license and release notices are still pending owner review. [Checkout release](https://github.com/actions/checkout/releases/tag/v6.1.0) · [Setup Node release](https://github.com/actions/setup-node/releases/tag/v6.4.0)

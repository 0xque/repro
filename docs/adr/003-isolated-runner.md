# ADR 003 · Loopback-only checkout runs

Use one fresh Linux container per run. Chromium and the fixture server communicate over loopback. PostgreSQL listens on a private Unix socket and seeds a new database on tmpfs. Dedicated database roles separate the app’s insert capability from the oracle’s read capability.

The CLI creates the container and checks its Docker configuration before startup. The worker independently checks the interface list and requires `ENETUNREACH` on a connection to a reserved documentation address. The browser matches one fake quote and routes only the fixture app’s known endpoints. The CLI uses the local Docker socket, and the worker has no access to that socket. [Docker none network driver](https://docs.docker.com/engine/network/drivers/none/) · [PostgreSQL peer authentication](https://www.postgresql.org/docs/16/auth-peer.html)

The CLI cleans up the containers it owns. Docker auto-removal and an in-container deadline cover a disconnected operator process. Chromium uses Playwright’s default sandbox setting inside the restricted Docker run, which is suitable for this trusted fixture. Separate hostile application workloads remain outside the supported scope. [Playwright Docker guidance](https://playwright.dev/docs/docker)

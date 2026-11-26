# Security model

Use synthetic development state and the reviewed checkout image built from this repository. The operator chooses the local project recipe and approves each run. The capsule can reference a fixed recipe and typed scenario data. The supported event and fixture schemas have no script, SQL, executable, remote source or startup command fields.

`inspect` validates bounded archive data in memory and emits JSON. Screenshots, logs, page HTML and browser profiles are excluded at collection. The recorder classifies form input inside the browser and exports only the approved synthetic label. Capture retains allowlisted actions, IDs, timestamps, synthetic fixture definitions and the result summary. The local store is owner-only, and review binds approval to the exact draft bytes. Export refuses modified or expired drafts and existing destinations. Additional binary entries from external capsules stay opaque.

Capture and replay use a read-only root filesystem, non-root user, private IPC, dropped capabilities, a bounded tmpfs, and memory, CPU, process and wall-time limits. No repository, home directory, credential files, sockets or external database are mounted into the workload. Invalid recipes and absent Docker deny execution. Browser requests are checked separately, including a denial of WebSockets and service workers. The fixture DB lives for one container run.

Run `repro purge` to remove expired or named drafts. Standard file deletion removes access through these paths and has no secure erase guarantee on storage devices or backups. The exported capsule is a separate local file.

Compatibility evidence covers the included fixture on a local Linux x86-64 Docker Engine. Arbitrary external applications, real payments, login, cross-origin frames, arbitrary form input, agents, and hostile runtime images remain outside the supported scope.

# Social Auto Poster — Managed Local Backend

This folder ships the **local backend profile** for the Social Auto Poster
extension. When the user opens the extension, Starizzi's `LocalServiceManager`
runs `docker compose -f docker-compose.izzi.yml up -d`, waits for the API's
`/health/ready`, then injects `backendUrl` into the extension so its client (and
the main-process `AutopostClient`) talk to this local instance.

## How the host drives it

1. Reads the `service` block in `../manifest.json`.
2. Allocates a free loopback host port (prefers `3001`).
3. Generates a `0600` `.env` in `userData/izzi-svc/izzi-svc-social-auto-poster/.env`
   with: `IZZI_BIND=127.0.0.1`, `IZZI_PORT_API=<host port>`, and the declared
   secrets (`JWT_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`,
   `MINIO_ROOT_PASSWORD`). Existing secret values are preserved across restarts
   so `ENCRYPTION_KEY` stays stable (previously-encrypted tokens still decrypt).
4. `docker compose ... --env-file <that .env> up -d`. Compose runs the one-shot
   `migrate` service (prisma migrate deploy) before the API starts.
5. The host polls `http://127.0.0.1:<host port>/health/ready` until it returns 200
   (Postgres + Redis + Object storage all reachable), then injects
   `backendUrl=http://127.0.0.1:<host port>`.

Nothing here is committed with real secrets — the manifest only declares secret
*names + generators*; the values are produced locally by the user's machine.

## Where the images come from

The compose references prebuilt images so the user never builds locally:

- `AUTOPOST_API_IMAGE`    (default `ghcr.io/kentzu213/autopost-api:latest`)
- `AUTOPOST_WORKER_IMAGE` (default `ghcr.io/kentzu213/autopost-worker:latest`)

These are published by the **Auto-Post repo** (`kentzu213/auto-post-tool`):

- **Automatic (release):** `.github/workflows/ci.yml` → `build-and-publish` builds,
  Trivy-scans, and pushes `autopost-{api,web,worker}` to GHCR on every push to
  `master` and every `v*` tag, tagged `latest`, `<semver>`, and `sha-<commit>`.
- **On-demand (multi-arch):** `.github/workflows/publish-local-images.yml`
  (`workflow_dispatch`) builds `autopost-{api,worker}` for **both linux/amd64 and
  linux/arm64** — needed so the Starizzi local profile runs on Intel *and* Apple
  Silicon user machines. Use this to seed/refresh the images the desktop app pulls.

Pin by digest (`image: ...@sha256:...`) once a release tag is chosen for production.

### Image contract (already satisfied by the Dockerfiles)

- `autopost-api`: NestJS on container port **3001**; exposes `/health/live`
  (liveness) and `/health/ready` (readiness: Postgres+Redis+Storage). Does NOT
  self-migrate — the compose `migrate` service runs `prisma migrate deploy` first.
- `autopost-worker`: BullMQ consumer (has ffmpeg); no published port.

## No-Docker fallback

If Docker isn't installed, the host uses the hosted backend from the
`AUTOPOST_BACKEND_URL` env var (declared as `service.fallback.remoteEnvVar`).
The extension then talks to izzi's hosted Auto-Post instead of a local one.

## Run it manually (debugging)

```bash
# from an env file with IZZI_BIND / IZZI_PORT_API / the secrets set:
docker compose -p izzi-svc-social-auto-poster -f docker-compose.izzi.yml --env-file .env up -d
docker compose -p izzi-svc-social-auto-poster -f docker-compose.izzi.yml down   # keeps volumes
```

## Security notes

- Only the API publishes a port, bound to `127.0.0.1`. Postgres/Redis/MinIO are
  internal to the compose network (no host exposure).
- `down` never passes `-v`, so user data volumes survive stop/restart.
- Secrets are `0600`, never logged, never shipped in the `.ocx`.

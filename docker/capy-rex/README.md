# Capy/Rex Widgets Hub V1.4

NAS Docker release for component management, submissions and public install pages. Public directory `/user`, admin `/admin`, static checker `/checker`. The checker parses in the browser and does not upload or execute submitted scripts.

## Deploy

1. Extract this archive into a new directory.
2. Copy `.env.example` to `.env` and set your own port, setup origin and public domain. Never commit the real `.env`.
3. Create `data/` with read/write access for the service account.
4. Run `docker compose config --quiet`, then `docker compose up -d --build`.
5. Open the local setup page and create an administrator password. Check `/healthz`.

Default example port is 8080 and Compose uses host networking. If you change `PORT`, update the reverse proxy and health-check URL too.

## Data and updates

`data/` contains runtime data and must be backed up privately. Back up SQLite consistently before upgrades. Preserve `.env` and `data/` when updating. Never remove a data volume to resolve login issues.

## Feature boundaries

Capy install links use public HTTPS JS URLs. Rex collection links retain their original format. Static checking is not player runtime certification. Encryption/decryption entries link to external services and users should review third-party handling before submitting code.

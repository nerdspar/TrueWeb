# Deploying TrueWeb

TrueWeb runs as a single container on the TrueNAS box itself. GitHub Actions
builds the image and pushes it to GHCR; TrueNAS pulls and runs it.

---

## 1. Create the service account (§7)

**Do not use a root or `FULL_ADMIN` key.** This container can start, stop,
redeploy and update every app you own, and create datasets — a scoped account
is the difference between a mistake and a bad day.

1. **Credentials → Users → Add**: a user called `trueweb`. No shell, no home
   directory needed, no password login required.
2. **Credentials → Privileges** (or Roles, depending on the build): create a
   privilege granting only:

   | Role | Why TrueWeb needs it |
   |---|---|
   | `APPS_READ` | list apps, read one app, containers, ports, host IPs, stats, logs |
   | `APPS_WRITE` | start / stop / redeploy / update / rollback / create |
   | `DOCKER_READ` | the Apps-service status banner (`docker.status`) |
   | `FILESYSTEM_ATTRS_READ` | stat and list paths for the compose pre-flight |
   | `FILESYSTEM_DATA_WRITE` | create directories, set ownership |
   | `DATASET_READ`, `DATASET_WRITE` | create a dataset for a new app |

   The API docs name these roles but don't publish a method-to-role table for
   the filesystem and dataset calls, so treat the last three rows as the
   starting point. If a provisioning action is refused, TrueWeb now shows the
   middleware's own error, which names what was denied — add that role and
   retry. Skip the filesystem/dataset rows entirely if you only want the Apps
   tab and not the compose flow.
3. **Credentials → API Keys → Add**: a key **linked to the `trueweb` user**.
   Copy it once — it isn't shown again.

TrueWeb authenticates with `auth.login_ex` (mechanism `API_KEY_PLAIN`), which
takes the username *and* the key, so it needs both.

---

## 2. Publish the image

Push to `main` (or run the workflow manually from the Actions tab). The workflow
typechecks and tests first, then builds `linux/amd64` and pushes:

```
ghcr.io/nerdspar/trueweb:latest
ghcr.io/nerdspar/trueweb:sha-<short>
```

GHCR packages are private by default. Either make the package public
(**Package settings → Change visibility**), or log the NAS in once with a
classic PAT that has `read:packages`:

```bash
docker login ghcr.io -u nerdspar   # paste the PAT as the password
```

---

## 3. Run it

Copy `docker-compose.yml` onto the box, fill in the values at the ⬅ markers,
then:

```bash
docker compose up -d
docker compose logs -f trueweb
```

A healthy start logs `connecting to wss://…` then
`ready — authenticated as trueweb`. Open `http://<nas-ip>:8110`, then on the
phone: **Share → Add to Home Screen**.

### Host settings that matter

- **`TRUENAS_HOST` must reach the middleware directly on the LAN, not through
  the reverse proxy** (§10). If Nginx Proxy Manager owns 443 on that IP, the
  TrueNAS UI is on **444** — use `10.0.1.14:444`.
- **`TRUENAS_VERIFY_TLS: "false"`** is normal: TrueNAS serves a self-signed
  certificate.
- **The `/var/log/app_lifecycle.log` mount is not optional if you want to know
  why a deploy failed.** When an app fails to come up, TrueNAS records a
  one-line error pointing at that file and nothing more — the job itself
  carries no logs, and the only API route to the file needs the HTTP download
  endpoint this project doesn't use. The log is on the host, so TrueWeb reads
  it from disk. Without the mount you get the pointer and a list of likely
  causes; with it you get the actual reason.

---

## 4. Updating

```bash
docker compose pull && docker compose up -d
```

---

## 5. Exposing it beyond the LAN

TrueWeb holds an API key that can restart every app you run. On a trusted LAN
it's fine ungated. Before putting it behind a hostname or a tunnel, set the
passcode gate:

```bash
# hash
docker run --rm node:22-alpine sh -c \
  "npm -s i bcryptjs >/dev/null 2>&1; node -e \"console.log(require('bcryptjs').hashSync(process.argv[1],12))\" 'your-passcode'"
# session secret
openssl rand -hex 32
```

Set `TRUEWEB_PASSCODE_HASH` and `TRUEWEB_SESSION_SECRET` and restart. This is a
speed bump against someone picking up an unlocked phone, not an authz system —
§7 is explicit about that.

---

## Troubleshooting

**`SSL alert number 112` / `tlsv1 unrecognized name`** — you're hitting a
name-based reverse proxy, not TrueNAS. Point `TRUENAS_HOST` at the box's own
port (`:444`). If the box itself refuses a bare-IP handshake, set
`TRUENAS_TLS_SERVERNAME` to the hostname it answers to.

**`socket hang up` right after connecting** — TLS completed but the HTTP host
didn't match, i.e. still the proxy. Same fix.

**`ready — authenticated as root`** — the key belongs to root. Re-issue it
against the `trueweb` user (step 1).

**A deploy fails with "address already in use"** — TrueNAS can only report
ports held by *apps* (`app.used_ports`); v25.10 has no system-wide port
method, so a port held by anything else is invisible to pre-flight. TrueWeb
reads the clashing port out of the failure and offers to change it.

**A dataset won't create** — TrueWeb passes `aclmode: DISCARD`, which the
middleware requires when the parent's `acltype` is POSIX or OFF. Any other
refusal is shown verbatim; it's usually a missing role from step 1.

**`EACCES: permission denied … /var/log/app_lifecycle.log`** — the mount is
there but the file isn't readable by the container's user. On this box it is
`root:adm` mode `640`, i.e. group-readable only, and the container runs as
`node`. The compose file joins gid 4 (`adm`) via `group_add`, which grants
exactly that read. Confirm yours matches:

```bash
ls -l /var/log/app_lifecycle.log     # expect root adm, -rw-r-----
```

If the group differs, put its gid in `group_add` instead. Running the container
as root would also work and is worth avoiding for one log file.

**The container is unhealthy** — the healthcheck only fails if the web server
is down or the API key is missing/rejected. A briefly unreachable middleware is
normal and does not flip it: a middleware restart must not make the container
look broken.

---

## Deploying TrueWeb with TrueWeb

Once it's running you can paste this `docker-compose.yml` into TrueWeb's own
**+ → New app** flow to update it. Two things to expect:

- the `/var/log/app_lifecycle.log` mount is flagged as *mounted from outside
  /mnt* — that's the caution for a read-only host file, not an error;
- port `8110` will clash with the running instance, so change it or stop the
  old one first.

For the first install, use the compose file directly (or the TrueNAS UI) —
bootstrapping TrueWeb with TrueWeb only works once TrueWeb is up.

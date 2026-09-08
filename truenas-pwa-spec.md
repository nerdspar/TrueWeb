# TrueNAS Mobile PWA — Build Spec

Working name: **TrueWeb**. (This spec was drafted with the placeholder "Helm"
throughout — including `HELM_*` env vars and "Helm backend"; read those as
TrueWeb / `TRUEWEB_*`. Renamed 2026-09-08.)

## 1. Purpose

A phone-first PWA for managing a single TrueNAS SCALE box. The TrueNAS web UI is
unusable on mobile — particularly for app management, which is the daily driver
for this build. Secondary scope is a system dashboard, storage/pool health, and
dataset browsing.

**The defining user journey.** Find a self-hosted project while browsing GitHub on
a phone, copy its `docker-compose.yml`, open Helm, paste it, have the app create
any datasets the compose file needs, deploy it, and watch it come up — without
touching a laptop. Everything else in this spec is secondary to making that
sequence work well. If a design decision makes that flow worse, it is the wrong
decision.

Follow-on lifecycle from the same place: restart, edit the YAML, redeploy, update.

This is a single-user, single-server, LAN/VPN-only tool. It is not a
general-purpose TrueNAS client and does not need multi-server support, RBAC UI,
or feature parity with the web UI.

**Target server: TrueNAS SCALE 25.10.4.** API version `v25.10`.

## 2. Non-goals

Explicitly out of scope. Do not build these, do not scaffold for them:

- Multi-server / server-switcher
- VM management (`vm.*` exists on 25.10 but is not wanted here)
- Share management (SMB/NFS/iSCSI), users, groups, certificates, networking
- Replication, rsync, cloud sync task management
- Pool creation, vdev editing, disk replacement — anything that restructures storage
- Dataset ACL / permission editing
- Shell / console access
- User accounts, sessions, or auth *within* the app beyond a single shared passcode

## 3. Critical API constraints — read before writing any client code

### 3.1 WebSocket only

TrueNAS 25.10 uses a versioned **JSON-RPC 2.0 over WebSocket** API at:

```
wss://<host>/api/current
```

The legacy REST API at `/api/v2.0` still responds on 25.10 but is deprecated and
raises a system alert on **every call**, and it is removed entirely in TrueNAS 26.
**Do not use REST anywhere in this project.** If you find yourself constructing an
HTTP URL against the NAS, stop.

### 3.2 Authoritative reference

Method and event signatures are pinned at `https://api.truenas.com/v25.10/`.
Method names shift between releases. **Do not infer a method name from another
version's docs or from memory — look it up.** Useful index pages:

- `api_methods.html` — full method list
- `api_events.html` — full subscribable event list
- `jobs.html` — job semantics
- `query_methods.html` — filter/option syntax for all `.query` methods
- `rbac.html` — role names for the service account

### 3.3 Jobs

Many mutating methods are **jobs**: they return a job ID immediately, not a
result. This includes `app.start`, `app.stop`, `app.redeploy`, `app.upgrade`,
`app.rollback`, `app.create`, `app.delete`, `app.update`, `pool.scrub.run`,
`pool.dataset.delete`.

Job handling must be built into the client layer from the start — not retrofitted.
Subscribe to the `core.get_jobs` event and correlate by job ID. `core.job_abort`
cancels; `core.job_wait` blocks if you need it. Surface progress in the UI rather
than spinning indefinitely.

### 3.4 Subscriptions over polling

The socket supports `core.subscribe` / `core.unsubscribe`. Prefer events to
polling wherever one exists. Relevant events for this app:

| Event | Use |
|---|---|
| `app.query` | live app state changes (running/stopped/deploying) |
| `app.stats` | per-app CPU/memory |
| `app.container_log_follow` | live log tail |
| `core.get_jobs` | job progress for every mutating action |
| `docker.state` | Apps service up/down |
| `docker.events` | container-level churn |
| `reporting.realtime` | live system CPU / memory / network / disk I/O |
| `pool.query`, `zpool.query` | pool state |
| `pool.scan` | scrub/resilver progress |
| `pool.dataset.query` | dataset changes |
| `disk.query` | disk changes |
| `alert.list` | alerts |
| `update.status` | OS update availability |
| `system.ready` | middleware readiness after reboot |

### 3.5 Catalog apps vs custom apps — the central distinction

TrueNAS has two kinds of app and they are configured completely differently. Get
this wrong and the whole create/edit surface is built on sand.

**Catalog apps** are installed from the TrueNAS catalog. Their configuration is a
`values` object validated against a per-app JSON schema fetched from the catalog.
**There is no YAML to edit.** The web UI renders a generated form from that
schema; `app.config` returns the values, `app.update` writes them back.

**Custom apps** are raw Docker Compose. `app.create` with `custom_app: true` and
the compose file in `custom_compose_config_string` (YAML string) or
`custom_compose_config` (parsed object). This is the path the defining user
journey takes — a GitHub project's compose file is always a custom app.

`app.convert_to_custom` converts an installed catalog app into a custom app,
which is what unlocks YAML editing for it. This is **one-way** and it severs the
app from catalog updates. Expose it, but behind a clear warning.

Consequences for this build:

- The compose/YAML path is the priority. Schema-driven form generation for
  catalog installs is a large, separate body of work — see §5.1.
- "Edit the YAML" is only meaningful for custom apps. For a catalog app the
  editor must either show the values form or offer conversion, not pretend there's
  a compose file.
- `app.upgrade` is a catalog concept. Custom apps are updated by changing the
  image tag in the compose and redeploying, or by `app.pull_images` followed by
  `app.redeploy`. The UI must not offer "Update" on a custom app as though it
  were the same operation.

Relevant `app.create` parameters (verified against v25.10):

```
app_name                      # ^[a-z]([-a-z0-9]*[a-z0-9])?$
custom_app                    # bool, default false
custom_compose_config_string  # YAML string, custom apps
custom_compose_config         # structured object, custom apps
catalog_app                   # required when custom_app is false
train, version
values                        # catalog app config
```

`app.create` is a job.

### 3.6 Query filters

All `.query` methods take `[filters, options]`. Use `select` to trim payloads and
`count`/`limit` where appropriate — `pool.dataset.query` in particular returns a
very large object graph if unconstrained, and this server has ~46 child datasets
under one parent alone. See `query_methods.html`.

## 4. Architecture

**Server-rendered-adjacent PWA with a thin backend proxy.** Do not connect the
browser directly to the middleware.

```
iPhone (PWA, standalone)
    │  HTTPS + SSE/WS, same origin
    ▼
Helm backend (container on TrueNAS)
    │  holds API key, maintains one persistent wss:// session to middleware
    ▼
TrueNAS middleware  wss://10.0.1.14/api/current
```

Rationale:

- The API key never reaches the phone. It lives in the compose file / env, same
  pattern already used for Seek.
- One long-lived authenticated socket, shared across page loads and devices,
  instead of re-authenticating on every app open.
- The backend can cache the app list and dataset tree, which makes cold start on
  cellular feel instant.
- Subscriptions fan out to browser clients over SSE without each client holding
  its own middleware session.

### Backend responsibilities

1. Connect and authenticate to `wss://<nas>/api/current` on boot; reconnect with
   backoff. Treat middleware restarts as normal, not fatal.
2. Expose a small internal REST surface to the PWA (`/api/apps`,
   `/api/apps/:name/start`, etc.) plus an SSE stream for live state.
3. Maintain subscriptions listed in 3.4 and push deltas to connected clients.
4. Gate every mutating route behind a shared passcode (see §7).

### Stack

Match Seek unless there's a reason not to — same shape, same deploy pattern, less
to maintain. Single container, single compose file, no external database.
In-memory state only; nothing here is worth persisting except user preferences
(which tab opens first, sort order), and those can live in `localStorage`.

## 5. Screens

Four tabs, bottom nav, in this order. Apps is the default tab and must be the
fastest thing in the app.

### 5.1 Apps (primary)

The reason this project exists. It has to be better than the web UI on a phone,
not merely equivalent.

**List view**
- One row per app: icon, name, state badge, "update available" indicator
- Sort: by state (stopped/erroring first), by name, by recently changed
- Filter chips: All / Running / Stopped / Updates available
- Pull to refresh, but state should already be live via `app.query` subscription
- Header shows a count of pending updates and the Apps-service status

Methods: `app.query`, `app.outdated_docker_images`

**Row actions** — reachable in one tap from the list, no drill-in required:
- Start / Stop (whichever applies) — `app.start`, `app.stop`
- Restart — `app.redeploy`
- Update, when available — `app.upgrade`

Swipe actions are welcome; a visible button is mandatory. Never hide the primary
action behind a long-press.

**Detail view**
- State, version, catalog train, image list, ports, host IPs
- Update: `app.upgrade_summary` first, show what changes, then `app.upgrade`
- Rollback: `app.rollback_versions` to populate a picker, then `app.rollback`
- Live logs — `app.container_log_follow`, tail only, no history search
- Config — see §5.2
- Live CPU/memory from `app.stats`

Methods: `app.get_instance`, `app.config`, `app.container_ids`, `app.used_ports`,
`app.used_host_ips`, `app.image.query`

**Apps service health.** This server has a known issue where the Apps service is
slow or fails to initialize after an unclean reboot. Handle it explicitly:
subscribe to `docker.state`, check `docker.status`, and when Apps is not running,
show a clear banner explaining that rather than rendering an empty app list that
looks like data loss.

**Not in v1:** catalog browsing and schema-driven catalog installs (see §5.2),
deleting apps.

### 5.2 Add app (the flagship flow)

Entry point: a persistent "+" in the Apps tab. Two paths, and they are not equal
in priority.

#### Path A — Install via YAML (build this first)

A single screen: app name, a large compose paste field, deploy.

**Paste handling is the make-or-break detail.** A compose file pasted from mobile
Safari arrives damaged in predictable ways. Sanitize on paste, before validation,
and show what was changed:

- Smart quotes (`" " ' '`) → straight quotes. GitHub's rendered view and iOS both
  produce these and TrueNAS will reject the YAML.
- Non-breaking spaces → regular spaces
- Tabs → two spaces (YAML forbids tabs for indentation)
- CRLF → LF
- Strip leading/trailing blank lines and any leading Markdown code fence
  (` ```yaml ` / ` ``` `) — pasting from a rendered README picks these up

The editor itself must be a monospace field with `autocorrect="off"`,
`autocapitalize="off"`, `spellcheck="false"`, and `autocomplete="off"`. iOS
autocorrect will otherwise silently mangle image tags and env values. Preserve
indentation on newline (a plain `<textarea>` does not). Horizontal scroll, no
soft wrap.

**Pre-flight validation, client-side, before any API call:**

1. Parse the YAML. On failure, show the error with the offending line highlighted.
   Do not round-trip a parse error through the server.
2. Require a top-level `services:` key. TrueNAS rejects compose files that only
   use `include:` with `custom_compose_config_string YAML is missing required
   "services" key`. Catch this locally and explain it.
3. Validate the app name against `^[a-z]([-a-z0-9]*[a-z0-9])?$` and check it
   isn't taken (`app.query`).
4. Extract published host ports and check them against `app.used_ports`. Warn on
   conflict before deploying, not after the job fails.
5. Extract bind-mount source paths (`volumes:` entries of the form
   `/mnt/...:/container/path`) and stat each one — see below.

**Dataset provisioning — the feature that makes this workflow actually work.**

Parse host paths out of the compose file, `filesystem.stat` each, and present the
missing ones as a checklist with a one-tap "create" per path. This is the step
that otherwise forces a trip to the laptop, and it's the reason Apps and Datasets
belong in the same app.

- Distinguish a missing *dataset* from a missing *directory inside* an existing
  dataset. `/mnt/NAS/Data/foo` where `NAS/Data` exists should offer both options:
  create `NAS/Data/foo` as a dataset (`pool.dataset.create`), or create a plain
  directory (`filesystem.mkdir`). Default to dataset for a direct child of a known
  config parent, directory otherwise.
- Default new datasets to inherit parent properties. Do not surface record size,
  compression, or dedup here — this is a provisioning step, not a dataset editor.
- After creation, set ownership. A dataset created with default permissions will
  frequently leave the container unable to write, which surfaces later as an
  opaque crash loop. Offer to `filesystem.chown` to a UID/GID, prefilled from any
  `PUID`/`PGID` env vars found in the compose file, defaulting to `568:568`
  (the `apps` account). Make this visible, not automatic — a wrong chown on the
  wrong path is worse than a container that won't start.
- Do not enable ACLs on datasets created this way. Host-path binds on this server
  are used without ACL.

Then: `app.create` with `custom_app: true`, `custom_compose_config_string`, and
the name. It's a job — show live progress from `core.get_jobs`, then image pull
progress, then drop the user into the app's detail view with the log tail already
running. The first 60 seconds after deploying a new app is exactly when you want
logs, and requiring a second navigation to reach them is a missed beat.

**Draft persistence.** Save the in-progress compose to `localStorage` on every
keystroke, debounced. Mobile Safari discards backgrounded tabs aggressively and
losing a pasted-and-edited compose file to a phone call is unacceptable.

#### Path B — Catalog install (defer; possibly skip)

Catalog installs require generating a form from the app's JSON schema
(`app.available`, `catalog.get_app_details`), which is a substantial subsystem:
nested groups, conditional visibility, typed validation, list editors. It is
weeks of work to do properly and it serves a workflow — installing from the
official catalog — that the web UI already handles adequately and that isn't the
stated need.

Recommendation: ship without it. If catalog install is wanted later, the
lower-effort version is a browse-and-search view over `app.available` that installs
with **defaults only**, plus a link out to the web UI for anything needing
configuration. Do not attempt full schema form generation on a phone.

### 5.3 Edit app config

**Custom apps:** the same editor component as §5.2, loaded with the app's current
compose. Same sanitization, same validation, same draft persistence. Save via
`app.update` with `custom_compose_config_string`, which redeploys. Show a diff
against the previous version before committing — on a small screen it is very
easy to have edited the wrong line.

Keep the last N saved versions of the compose in backend memory or a small file
so a bad edit can be reverted without reconstructing it from memory. This is
cheap and will pay for itself.

**Catalog apps:** show the values from `app.config` read-only, formatted. Offer
"Convert to custom app" (`app.convert_to_custom`) with an explicit warning that
it is irreversible and ends catalog updates for that app. After conversion the
full YAML editor becomes available.

Do not build a values-editing form for catalog apps. Same reasoning as Path B.

### 5.4 Dashboard

Read-only glanceable status.

- System info: hostname, version, uptime, load — `webui.main.dashboard.sys_info`,
  `system.info`
- Live CPU / memory / network throughput — `reporting.realtime` subscription
- Pool capacity summary — one bar per pool
- Disk temperatures — `disk.temperatures`, `disk.temperature_agg`
- Active alerts with dismiss — `alert.list`, `alert.dismiss`
- OS update available indicator — `update.status` (display only; **do not** expose
  `update.run` in v1)
- Running jobs — `core.get_jobs`

`reporting.get_data` / `reporting.graph` exist for historical charts. Skip them in
v1; the realtime feed plus capacity bars covers the "is it healthy" question,
which is what a phone is for.

### 5.5 Storage

Read-mostly. Pool health, not pool administration.

- Pool list with status, capacity, fragmentation, and health — `pool.query`
- Pool detail: vdev topology, per-member state, read/write/checksum error counts
- Scrub status and progress — `pool.scrub.query`, `pool.scan` event
- Manual scrub trigger — `pool.scrub.run` (guarded, see §6)
- Disks with model, serial, size, temperature, pool assignment — `disk.query`,
  `pool.get_disks`, `disk.details`
- Boot pool state — `boot.get_state`

Per-member error counts should be prominent and should not require drilling in.
This box has a history of splitter-induced checksum errors and it is exactly the
thing worth seeing at a glance.

**Never expose:** `pool.create`, `pool.expand`, `pool.remove`, `pool.replace`,
`pool.offline`, `pool.export`, `disk.wipe`. Not behind a confirmation, not behind
a settings flag. Those belong in the web UI on a real screen.

### 5.6 Datasets

- Tree browser rooted at each pool, lazy-loaded per level — `pool.dataset.query`
  with filters, `pool.dataset.details`
- Per dataset: used / available / referenced, compression ratio, record size,
  quota, snapshot count (`pool.dataset.snapshot_count`), encryption/lock state
- Snapshot list per dataset — `pool.snapshot.query` (paginate; there will be many)
- Quota view/edit — `pool.dataset.get_quota`, `pool.dataset.set_quota`
- Lock / unlock encrypted datasets — `pool.dataset.lock`, `pool.dataset.unlock`

**Creation.** `pool.dataset.create`, with a deliberately minimal form: parent
path, name, and nothing else — everything inherits from the parent. The advanced
properties (record size, compression, dedup, casing, atime) are not phone
decisions and adding them invites a mistake that's hard to undo.

**Permissions.** After creating, offer `filesystem.chown` with UID/GID, and show
current ownership and mode on the dataset detail view. Getting this wrong is the
single most common reason a freshly deployed container fails, so make the current
state visible rather than something you have to go find out.

The same creation component is reused by the compose pre-flight in §5.2. Build it
here, call it from there.

**Not in v1:** deleting datasets, deleting or rolling back snapshots, renaming,
promoting clones, ACL editing. Dataset deletion from a phone is a foot-gun with no
upside — a container that won't start is recoverable, a deleted dataset is not.

## 6. Destructive action guardrails

Every mutating call falls into one of three tiers, and the tier must be encoded in
the backend route table, not just the UI.

**Tier 1 — one tap, no confirmation:** `app.start`, `app.redeploy`,
`alert.dismiss`.

**Tier 2 — confirmation sheet naming the target:** `app.stop`, `app.upgrade`,
`app.rollback`, `app.create`, `app.update`, `app.pull_images`,
`pool.dataset.create`, `filesystem.mkdir`, `filesystem.chown`, `pool.scrub.run`,
`pool.dataset.set_quota`, `pool.dataset.lock`.

`app.update` and `filesystem.chown` need more than a generic "are you sure":
`app.update` shows a diff of the compose, `filesystem.chown` shows the resolved
path and the current owner alongside the new one.

**Tier 2.5 — `app.convert_to_custom`:** irreversible and not obviously so. Requires
typing the app name to confirm.

**Tier 3 — not exposed:** everything in the "never expose" lists above, plus
`system.reboot`, `system.shutdown`, `update.run`, `config.reset`. The backend
should reject these at the router level with a hardcoded allowlist, so a bug in
the frontend cannot reach them.

Implement the allowlist as an explicit map of permitted middleware methods. Any
method not in the map is refused before it reaches the socket.

## 7. Auth and credentials

**Service account, not an admin key.** Create a dedicated TrueNAS user, assign a
privilege with only the roles this app needs, then issue a user-linked API key
against that account. See `rbac.html` for role names — do not grant `FULL_ADMIN`.
Note that 25.10 API keys use SCRAM-SHA-512 and support a username parameter.

Backend authenticates with `auth.login_with_api_key`, verifies with `auth.me`,
and fails loudly and visibly at startup if the key is rejected — a silently
unauthenticated backend that returns empty lists is the worst failure mode here.

**App-level access:** a single shared passcode, checked by the backend, stored as
a bcrypt hash in env. Session cookie, long expiry, `HttpOnly` + `Secure`. This is
a speed bump against someone picking up an unlocked phone, not a real authz
system, and it should be documented as such.

Config via environment variables only:

```
TRUENAS_HOST=10.0.1.14
TRUENAS_API_KEY=
TRUENAS_VERIFY_TLS=true|false
HELM_PASSCODE_HASH=
HELM_PORT=
```

No secrets in the repo. No secrets in `localStorage`. No API key ever serialized
into a response body.

## 8. Visual direction

Near-black background with an electric blue gradient accent — the established look
for these projects. Single dark theme; no light mode, no theme switcher.

- Mobile-first. Design at 390pt wide and let desktop be an afterthought.
- Everything reachable one-handed: primary actions in the lower half, bottom nav,
  no top-corner-only controls.
- Generous tap targets (44pt minimum). This is a phone tool being built
  specifically because the alternative has 20px checkboxes.
- State communicated by color *and* shape/label, never color alone.
- Optimistic UI on tier-1 actions, with rollback if the job fails.
- Skeleton loaders, not spinners, for list views.

## 9. PWA requirements

- Web app manifest, `display: standalone`, correct iOS meta tags and touch icons
- Service worker: cache the shell, never cache API responses
- Safe-area insets respected (notch and home indicator)
- Works when added to the home screen from Safari, including after force-quit
- Offline: show a clear "can't reach the NAS" state, not a broken white page
- No push notifications in v1

## 10. Deployment

Single container on TrueNAS via Docker Compose, alongside the existing app
stack. Fronted by Nginx Proxy Manager for TLS and a hostname. Backend connects to
middleware over the LAN at the local IP, not through the proxy.

Provide a working `docker-compose.yml` and a `.env.example`. Document the exact
steps to create the service account, privilege, and API key.

## 11. Milestones

**M1 — Client layer.** Authenticated WebSocket client with reconnect, job
handling, subscription management, and the method allowlist. A CLI or test
harness that can list apps and start/stop one. No UI. Get this right before
anything else; everything else depends on it.

**M2 — Apps tab, read and lifecycle.** List, filters, row actions
(start/stop/restart/update), detail view, live state, log tail. Usable on its own.

**M3 — The flagship flow.** Compose paste editor with sanitization and
validation, host-path scanning, dataset provisioning with chown, `app.create`,
deploy-with-live-progress. Includes the minimal dataset creation component from
§5.6. This is the milestone the project exists for — everything before it is
scaffolding for it.

**M4 — Config editing.** YAML editor over existing custom apps, diffing, version
history, `app.convert_to_custom`.

**M5 — Dashboard, Storage, Datasets browse.**

Deferred indefinitely: catalog browse/install, schema forms, app deletion.

Do not build tabs in parallel. Reaching M3 in a usable state matters more than
having four half-finished tabs, and M5 is genuinely optional — if the dashboard
never gets built, the app still does its job.

## 12. Open questions

1. App name — Helm is a placeholder, and it collides with Kubernetes Helm, which
   is unfortunate given the domain.
2. Access path from outside the LAN: VPN/Tailscale only, or exposed through NPM
   with the passcode as the only barrier? This changes how seriously §7 needs to
   be taken.
3. Should the compose editor support pulling directly from a URL — paste a raw
   GitHub link and have the backend fetch the compose file? It removes the
   copy-paste step entirely and sidesteps every sanitization problem in §5.2.
   It also means the backend makes outbound requests to arbitrary URLs, which is
   a real (if modest) attack surface on a box holding everything. Worth deciding
   deliberately rather than discovering later.
4. `.env` files and compose files that reference sibling files won't work as a
   single paste. Is that acceptable, or does the flow need a way to supply
   environment variables alongside the compose?

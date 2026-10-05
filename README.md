# TrueWeb

A phone-first web app for managing [TrueNAS SCALE](https://www.truenas.com/) apps,
pools and datasets. It installs to an iPhone Home Screen and is built for the
thing the official web UI is worst at: restarting an app, checking a pool, or
pasting a compose file while standing in the kitchen.

It talks to the TrueNAS middleware directly over its JSON-RPC WebSocket API.
There is no database and no second service — one container, your NAS, done.

> **Scope:** this manages apps, and reads storage. It deliberately does **not**
> do shares, users, VMs, networking, certificates, replication, or anything that
> restructures a pool. Those stay in the TrueNAS web UI. See
> [Limitations](#limitations).

---

## Requirements

| | |
| --- | --- |
| TrueNAS SCALE | **25.10.x** (API `v25.10`). Built and tested against 25.10.4 |
| Docker | On the NAS, or any host that can reach it |
| A free port | Default `8110` |

The API it uses is versioned. On an older TrueNAS some calls will be missing; on
26.x some are renamed or removed (the legacy REST API disappears entirely, and
`pool.scrub.scrub` is deprecated in favour of `zpool.scrub.run`). Treat 25.10 as
the supported target.

---

## Deploy

Full detail, including the exact role list and troubleshooting, is in
**[DEPLOY.md](DEPLOY.md)**. The short version:

### 1. Make a service account on the NAS

**Credentials → Users → Add.** Call it `trueweb`. No shell, no home directory.
Then **Credentials → API Keys → Add**, linked to that user.

> **Do not use a root or `FULL_ADMIN` key.** This container can start, stop,
> redeploy and delete every app you own. A scoped account is the difference
> between a bug costing you an app and costing you the box.

[DEPLOY.md §1](DEPLOY.md) has the role table and what each one unlocks. It covers
the Apps and compose flows; the Dashboard and Storage tabs also read pools,
alerts, reporting and system info, so you may need to add read roles for those.
When a call is refused TrueWeb surfaces the middleware's own error, which names
the missing role — add it and retry.

### 2. Configure

Grab [`docker-compose.yml`](docker-compose.yml) and fill in the values marked
with `⬅` — there is no `.env` file by design:

```yaml
TRUENAS_HOST: "10.0.1.14:444"          # the NAS on your LAN, NOT via a reverse proxy
TRUENAS_API_KEY: "…"                   # from step 1
TRUENAS_API_KEY_USERNAME: "trueweb"    # the user the key belongs to
TRUENAS_VERIFY_TLS: "false"            # TrueNAS ships a self-signed cert
```

Two that catch people out:

- **Port 444, not 443.** If Nginx Proxy Manager or similar owns 443 on that IP,
  the TrueNAS UI moves to 444. Point TrueWeb at the box directly — going back
  through your own proxy adds a hop that can't help.
- **`group_add: ["4"]`** lets the container read `/var/log/app_lifecycle.log`,
  which is where TrueNAS writes the *reason* a failed app failed. Check yours
  matches: `ls -l /var/log/app_lifecycle.log`.

### 3. Run

The image is public — no `docker login` needed:

```bash
docker compose pull && docker compose up -d
```

Then on your phone: `http://<nas-ip>:8110` → **Share → Add to Home Screen**.

### Updating

```bash
docker compose pull && docker compose up -d
```

`pull` only updates the **image**. If a release changes `docker-compose.yml`
itself — a new env var, a new volume — you have to copy those lines across by
hand; `pull` will not do it, and the symptom is a feature that silently does
nothing.

### Building it yourself

Don't want to run a stranger's image? Comment out `image:` and uncomment
`build: .` in the compose file. Or run it from source:

```bash
npm install && npm run dev
```

---

## What it does

### Apps

The reason this exists. One row per app with its state, plus:

- **Start / stop / restart / update**, inline on the row
- **Search** by name — typing `uptime kuma` finds `uptime-kuma`, because nobody
  types the hyphen
- **Filter** All / Running / Stopped / Updates available
- **Sort** by state, name, or *recently deployed*
- **Bulk updates** — one screen for everything with an update waiting

**Adding an app is the flagship flow.** Paste a `docker-compose.yml` straight
from a project's README into a text field and deploy it. It sanitises and
validates the YAML first, and keeps a draft so a mistyped host path doesn't cost
you the whole paste. You can also fetch compose directly from a URL.

**App detail** gives you live CPU/memory/network for the app, its container list
with images and state, and streaming logs per container — including the real
failure reason when a deploy fails, read from the host lifecycle log.

**Editing** a custom app loads its current compose in the same editor and shows
you a **diff before saving**, because on a phone it is very easy to have edited
the wrong line.

### Dashboard

Read-only, glanceable, answering one question: is this box healthy right now?

- **Pools** — capacity with a warning past 80% (ZFS slows badly when full), vdev
  layout, disk count and error counts, last scrub date, duration and errors
- **Live** — CPU with cores/threads and the busiest and hottest thread, memory
  split into free / ZFS cache / services, disk throughput
- **System** — host, version, edition, platform, uptime, load
- **Network** — per-interface throughput and link speed
- **Alerts, update notices and running jobs** as header badges

> Memory is metered on *services*, not total-minus-free. ARC is most of the
> difference and ZFS hands it back on demand — metering it would park the bar
> above 90% on a healthy box and teach you to ignore it.

### Storage

Read-mostly — pool health, not pool administration.

- Pool list with status, capacity and fragmentation
- Vdev topology with **per-member read/write/checksum error counts**, visible
  without drilling in
- Scrub status and progress, and a manual scrub trigger

### Datasets

A lazy-loaded tree per pool. Per dataset: used / available / referenced,
compression and ratio, record size, quota and refquota, space used by snapshots
and children, record size, sync and dedup settings, mountpoint and owner.
**Read-only** — see [Limitations](#limitations).

### Settings

Choose which tab the app opens on. The preference is a cookie, so the server
redirects on launch and you never see the wrong tab flash first.

---

## Security

Read this before putting it anywhere but a trusted LAN.

- **TrueWeb has no login by default.** Anyone who can reach the page can manage
  your apps. On a home LAN that is usually a deliberate trade; on anything else
  it is not.
- **Turn on the passcode gate** if the app is reachable beyond your LAN. Set
  `TRUEWEB_PASSCODE_HASH` (bcrypt) and `TRUEWEB_SESSION_SECRET`; DEPLOY.md §5 has
  the one-liner that generates both. With them set, every page and API route
  requires a signed session cookie.
- **Prefer a VPN or Tailscale** over exposing it publicly. A passcode in front of
  something that can delete your apps is thin.
- **Scope the API key** (see step 1). This is the single highest-value thing you
  can do.
- Destructive calls are refused at the server regardless of what the UI sends:
  `pool.create`, `pool.expand`, `pool.remove`, `pool.replace`, `pool.offline`,
  `pool.export`, `disk.wipe`, `system.reboot`, `system.shutdown`, `update.run`
  and `config.reset` are on a hardcoded denylist. Every method the app can call
  is on an explicit allowlist with a destructiveness tier.
- Compose files hold secrets verbatim, so **edit history is kept in memory and
  lost on restart** unless you opt in with `TRUEWEB_STATE_DIR`. That trade is
  documented at the setting.

---

## Limitations

Known and deliberate, so nobody goes looking for them:

- **No shell or console.** Not for apps, not for the host.
- **Datasets are read-only.** No snapshot browsing, no quota editing, no
  lock/unlock, no create or destroy. The API supports them; they aren't built.
- **No app catalogue.** You install by pasting or fetching compose, not by
  browsing the TrueNAS catalogue. Catalogue apps you already have are managed
  normally.
- **No shares, users, VMs, networking, certificates, or replication.**
- **No pool restructuring** — no creating pools, replacing disks or editing vdevs.
- **One server.** No server switcher.
- **Compose with sibling files** (a referenced `.env`, config files next to the
  compose) can't be pasted as one unit.
- **Dark mode only.**
- **"Recently deployed" sorts stopped apps last**, because stopping an app tears
  down its Docker network and takes the timestamp with it.

---

## Development

```bash
npm install
npm run dev          # dev server
npm run check        # svelte-check + typescript
npm test             # node:test, no runner dependency
npm run build        # production build (adapter-node)
```

SvelteKit 2 / Svelte 5 on Node 22. Three runtime dependencies: `ws`, `yaml`,
`bcryptjs`.

`truenas-pwa-spec.md` is the spec the app was built against — it is ahead of the
implementation in places (notably §5.6 datasets), so treat the code as the source
of truth for what exists today.

Pushing to `main` builds and publishes the image to GHCR via GitHub Actions.

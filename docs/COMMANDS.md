# Nexus App Command Guide

This is the canonical command guide for the app repo.  
Run commands from the repository root (e.g. `cd` into your clone of this project).

## Source repository

- **GitHub:** [github.com/lukeledesma/Nexus](https://github.com/lukeledesma/Nexus)  
  Clone: `git clone https://github.com/lukeledesma/Nexus.git`

`deploy/deploy_server.sh` reads **`git remote get-url origin` on your laptop** when the server needs to `git clone` (first deploy or missing app dir). Your local clone should use `origin` → this repo.

### Migrations on your Mac (development)

Rails must run as **development** on your laptop (not production). If you ever ran `export RAILS_ENV=production` in this terminal window, that variable **stays set** until you unset it — then you’ll see **Missing `secret_key_base` for 'production'** even when you only type `bin/rails db:migrate`.

**Fix first (same terminal tab):**

```bash
unset RAILS_ENV
unset NEXUS_DATABASE_PASSWORD
```

Then go to the app folder and migrate (two lines, paste one at a time — do not put `#` comments on the same line as `cd`):

```bash
cd /path/to/your/Nexus_Dev_clone
bin/rails db:migrate
```

If you see **`cd: too many arguments`**, the shell got more than one path for `cd` (often from pasting `cd …` and `bin/rails` as one line, or a bad path). Run only `cd` with a single path, press Enter, then `bin/rails db:migrate`.

Paths like `/home/luke/apps/nexus` exist **only on the Linux server**, not on macOS — `cd` to those will fail locally.

Do **not** run `sudo systemctl restart puma` on your Mac; that is **server-only** (and `sudo` will ask for your **Mac login password**, not your Postgres password).

---

### Server clone pointing at the wrong GitHub repo?

**SSH into your Linux server first** (`ssh …@…`). Everything below runs **on the server**, not in a local Terminal tab.

If production was cloned from another URL, point `origin` at this repo once.  
Use the real app path on that machine (directory containing `bin/rails` and `config/`), e.g. `/home/luke/apps/nexus`:

```bash
cd /path/to/your/app
git remote -v
git remote set-url origin https://github.com/lukeledesma/Nexus.git
git fetch origin
git checkout main
git reset --hard origin/main
```

Then run migrations **on the server** (no `#` comment on the same line as `bin/rails`):

```bash
export RAILS_ENV=production
export NEXUS_DATABASE_PASSWORD='your_postgres_password_for_user_alchemy'
bin/rails db:migrate
```

Restart Puma: `sudo systemctl restart puma` (this `sudo` asks for the **server user’s** password, not the DB password).

After that, `./deploy/deploy_server.sh` from your **updated** local clone will match the same remote.

The on-disk app folder name (e.g. `apps/nexus`) does not have to match the repo name; override with `NEXUS_DEPLOY_APP` if your path differs.

---

## Most Common 3 Commands

1) Start local app:

```bash
bin/rails server
```

2) Push app repo to GitHub:

```bash
./deploy/deploy_github.sh
```

3) Deploy app repo to production:

```bash
export NEXUS_DEPLOY_HOST=your.server.hostname.or.ip
./deploy/deploy_server.sh
```

Optional deploy environment variables:

- `NEXUS_DEPLOY_HOST` — required for deploy scripts
- `NEXUS_DEPLOY_USER` — SSH user (default: `deploy`)
- `NEXUS_DEPLOY_APP` — app path on server (default: `/home/$NEXUS_DEPLOY_USER/apps/nexus`)
- `NEXUS_DEPLOY_RUBY` — Ruby bin dir on server (default: rbenv 3.2.3 under that user’s home)
- `NEXUS_DEPLOY_SSH_KEY` — path to private key (default: `~/.ssh/id_ed25519`)

---

## Local

Rails console:

```bash
bin/rails console
```

Run migrations:

```bash
bin/rails db:migrate
```

Autoload check:

```bash
bin/rails zeitwerk:check
```

UI contract check:

```bash
bin/rake ui:contract
```

What it does:

- Verifies shared OS/app window UI contract tokens and classes exist in the stylesheet
- Verifies DB Health, Settings, Launcher, Tasks, Sticky Notes, and Theme Builder use the required shared contract classes
- Fails if legacy organizer-specific visual card classes reappear in ERB views
- Prints `UI contract check passed` on success

List routes:

```bash
bin/rails routes
```

---

## SSH

Examples (replace user, host, and paths with your own):

```bash
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i ~/.ssh/id_ed25519 user@your-server
```

Quick server status:

```bash
ssh -i ~/.ssh/id_ed25519 user@your-server "sudo systemctl is-active puma; sudo systemctl is-active nginx 2>/dev/null || echo unknown; git -C /path/to/app log --oneline -1"
```

Restart Puma only:

```bash
ssh -i ~/.ssh/id_ed25519 user@your-server "sudo systemctl restart puma"
```

---

## Deploy

Step A: Push app repo changes:

```bash
./deploy/deploy_github.sh
```

Optional:

```bash
./deploy/deploy_github.sh --message "your message"
```

Step B: Deploy app repo to server:

```bash
export NEXUS_DEPLOY_HOST=your.server.hostname.or.ip
./deploy/deploy_server.sh
```

Deploy options:

```bash
./deploy/deploy_server.sh --branch BRANCH_NAME
./deploy/deploy_server.sh --rsync
./deploy/deploy_server.sh --dry-run
```

Deploy guarantees:

- Mirror cleanup on server (`git clean -ffdx`)
- Assets are clobbered then recompiled
- If the app directory is missing, it is cloned from origin

Verify live response:

```bash
curl -I https://nxs.tools/
```

If UI still appears stale after deploy:

- Hard refresh browser
- Or clear site data for nxs.tools

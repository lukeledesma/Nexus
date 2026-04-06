# Nexus App Command Guide

This is the canonical command guide for the app repo.  
Run commands from the repository root (e.g. `cd` into your clone of this project).

## Source repository

- **GitHub:** [github.com/lukeledesma/nxs.tools](https://github.com/lukeledesma/nxs.tools)  
  Clone: `git clone https://github.com/lukeledesma/nxs.tools.git`

`deploy/deploy_server.sh` reads **`git remote get-url origin` on your laptop** when the server needs to `git clone` (first deploy or missing app dir). Your local clone should use `origin` → this repo.

### Server still tied to the old “Nexus” remote?

If production was cloned from another GitHub URL, point it at **nxs.tools** once (SSH on the server):

```bash
cd /path/to/your/app    # e.g. the directory that contains bin/rails, config/, …
git remote -v
git remote set-url origin https://github.com/lukeledesma/nxs.tools.git
git fetch origin
git checkout main
git reset --hard origin/main
```

Then run migrations if needed (`bin/rails db:migrate`). After that, `./deploy/deploy_server.sh` from your **updated** local clone will match the same remote.

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

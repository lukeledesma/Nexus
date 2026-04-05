# Nexus App Command Guide

This is the canonical command guide for the app repo.
Run commands from the app root:

cd /Users/luke/Projects/WEBSITE/Nexus_Dev

## Most Common 3 Commands

1) Start local app:
bin/rails server

2) Push app repo to GitHub:
./deploy/deploy_github.sh

3) Deploy app repo to production:
./deploy/deploy_server.sh

---

## Local

Rails console:
bin/rails console

Run migrations:
bin/rails db:migrate

Autoload check:
bin/rails zeitwerk:check

UI contract check:
bin/rake ui:contract

What it does:
- Verifies shared OS/app window UI contract tokens and classes exist in the stylesheet
- Verifies DB Health, Settings, Launcher, Tasks, Sticky Notes, and Theme Builder use the required shared contract classes
- Fails if legacy organizer-specific visual card classes reappear in ERB views
- Prints `UI contract check passed` on success

List routes:
bin/rails routes

---

## SSH

Login to server:
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i ~/.ssh/id_ed25519 luke@172.232.163.176

Quick server status:
ssh -i ~/.ssh/id_ed25519 luke@172.232.163.176 "sudo systemctl is-active puma; sudo systemctl is-active nginx 2>/dev/null || echo unknown; git -C /home/luke/apps/nexus log --oneline -1"

Restart Puma only:
ssh -i ~/.ssh/id_ed25519 luke@172.232.163.176 "sudo systemctl restart puma"

---

## Deploy

Step A: Push app repo changes:
./deploy/deploy_github.sh

Optional:
./deploy/deploy_github.sh --message "your message"

Step B: Deploy app repo to server:
./deploy/deploy_server.sh

Deploy options:
./deploy/deploy_server.sh --branch BRANCH_NAME
./deploy/deploy_server.sh --rsync
./deploy/deploy_server.sh --dry-run

Deploy guarantees:
- Mirror cleanup on server (`git clean -ffdx`)
- Assets are clobbered then recompiled
- If `/home/luke/apps/nexus` is missing, it is cloned from origin

Verify live response:
curl -I https://nxs.tools/

If UI still appears stale after deploy:
- Hard refresh browser
- Or clear site data for nxs.tools

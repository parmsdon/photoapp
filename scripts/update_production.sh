#!/usr/bin/env bash
# Deploy latest code to production after a git pull.
# Run as root (or with sudo) from any directory.
set -euo pipefail

PROD_DIR="/projects/photoapp"
APP_USER="photoapp"

# ── Helpers ───────────────────────────────────────────────────────────────────

info() { echo -e "\n\033[1;34m==> $*\033[0m"; }
ok()   { echo -e "\033[1;32m    ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m    ! $*\033[0m"; }
die()  { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

# ── Identify the invoking user (who owns the SSH key for GitHub) ──────────────
# This script must be run with sudo. Git operations run as the original user
# so that their ~/.ssh key is used; chown/systemctl run as root.

if [ -z "${SUDO_USER:-}" ]; then
    die "Run this script with sudo, not directly as root.\n  Usage: sudo $0"
fi
GIT_USER="$SUDO_USER"
ok "Git operations will run as '$GIT_USER'"

[ -d "$PROD_DIR/.git" ] || die "$PROD_DIR is not a git repository. Run setup_production.sh first."

cd "$PROD_DIR"

# ── Git safe directory (idempotent) ───────────────────────────────────────────

sudo -u "$GIT_USER" git config --global --add safe.directory "$PROD_DIR"
ok "safe.directory configured for $GIT_USER"

# ── Pull latest code ──────────────────────────────────────────────────────────

info "Pulling latest code"

# Temporarily give the deploying user ownership of .git so git pull can write
# pack files and update refs. Full photoapp ownership is restored after builds.
chown -R "$GIT_USER:$APP_USER" "$PROD_DIR/.git"
chmod -R g+w "$PROD_DIR"

# Capture which files changed since current HEAD, then pull — both as GIT_USER
# so the SSH agent / key in their home directory is used for GitHub auth.
CHANGED=$(sudo -u "$GIT_USER" git diff --name-only HEAD origin/master 2>/dev/null || true)
sudo -u "$GIT_USER" git pull origin master
ok "Code updated"

# ── Python dependencies ───────────────────────────────────────────────────────

if echo "$CHANGED" | grep -q "backend/requirements.txt"; then
    info "requirements.txt changed — reinstalling Python dependencies"
    "$PROD_DIR/venv/bin/pip" install --upgrade pip --quiet
    "$PROD_DIR/venv/bin/pip" install -r "$PROD_DIR/backend/requirements.txt" gunicorn --quiet
    ok "Python dependencies updated"
else
    ok "requirements.txt unchanged — skipping pip install"
fi

# ── Database migrations ───────────────────────────────────────────────────────

if [ -f "$PROD_DIR/backend/migrate_db.py" ]; then
    info "Running database migrations"
    cd "$PROD_DIR/backend"
    sudo -u "$APP_USER" "$PROD_DIR/venv/bin/python" migrate_db.py
    cd "$PROD_DIR"
    ok "Migrations complete"
else
    ok "No migrate_db.py found — skipping migrations"
fi

# ── React frontends ───────────────────────────────────────────────────────────

VIEWER_CHANGED=false
MANAGER_CHANGED=false

if echo "$CHANGED" | grep -q "^frontend/viewer/"; then
    VIEWER_CHANGED=true
fi
if echo "$CHANGED" | grep -q "^frontend/manager/"; then
    MANAGER_CHANGED=true
fi
# Shared frontend root (package.json, public/, src/) affects both
if echo "$CHANGED" | grep -qE "^frontend/(package\.json|public/|src/)"; then
    VIEWER_CHANGED=true
    MANAGER_CHANGED=true
fi

if $VIEWER_CHANGED; then
    info "Viewer source changed — rebuilding"
    cd "$PROD_DIR/frontend/viewer"
    npm install --silent
    npm run build
    chmod -R o+rX "$PROD_DIR/frontend/viewer/build"
    cd "$PROD_DIR"
    ok "Viewer rebuilt"
else
    ok "Viewer source unchanged — skipping build"
fi

if $MANAGER_CHANGED; then
    info "Manager source changed — rebuilding"
    cd "$PROD_DIR/frontend/manager"
    npm install --silent
    PUBLIC_URL=/manager npm run build
    chmod -R o+rX "$PROD_DIR/frontend/manager/build"
    cd "$PROD_DIR"
    ok "Manager rebuilt"
else
    ok "Manager source unchanged — skipping build"
fi

# ── Restore ownership and permissions ────────────────────────────────────────

info "Restoring ownership and permissions"
sudo chown -R photoapp:photoapp "$PROD_DIR"
sudo chmod -R g+w "$PROD_DIR"
sudo find "$PROD_DIR" -type f -name "*.sh" -exec chmod +x {} \;
sudo find "$PROD_DIR/venv/bin" -type f -exec chmod +x {} \;
ok "Ownership restored to photoapp:photoapp"
ok "Shell scripts and venv binaries marked executable"

# ── Restart services ──────────────────────────────────────────────────────────

info "Restarting services"
systemctl restart photoapp
ok "Gunicorn (photoapp) restarted"

# Reload nginx only if its config changed
if echo "$CHANGED" | grep -q "config/nginx.conf"; then
    cp "$PROD_DIR/config/nginx.conf" /etc/nginx/conf.d/photoapp.conf
    nginx -t
    systemctl reload nginx
    ok "Nginx config updated and reloaded"
else
    ok "Nginx config unchanged — no reload needed"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
echo " PhotoApp updated successfully."
echo " Logs: journalctl -u photoapp -f"
echo "============================================================"

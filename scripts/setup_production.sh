#!/usr/bin/env bash
# One-time production setup for PhotoApp.
# Run as root (or with sudo). Creates the photoapp user if absent.
set -euo pipefail

PROD_DIR="/projects/photoapp"
REPO_URL="git@github.com:parmsdon/photoapp.git"
APP_USER="photoapp"
NGINX_CONF="/etc/nginx/sites-available/photoapp"
SERVICE_FILE="/etc/systemd/system/photoapp.service"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { echo -e "\n\033[1;34m==> $*\033[0m"; }
ok()    { echo -e "\033[1;32m    ✓ $*\033[0m"; }
die()   { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

require() {
    command -v "$1" &>/dev/null || die "$1 is not installed. Install it and re-run."
}

# ── Prerequisite checks ───────────────────────────────────────────────────────

info "Checking prerequisites"
require git
require python3.11
require node
require npm
require nginx
ok "All prerequisites found"

python3.11 --version
node --version
npm --version

# ── System user ───────────────────────────────────────────────────────────────

info "Creating system user '$APP_USER'"
if id "$APP_USER" &>/dev/null; then
    ok "User '$APP_USER' already exists"
else
    useradd --system --shell /usr/sbin/nologin --home-dir "$PROD_DIR" "$APP_USER"
    ok "User '$APP_USER' created"
fi

# ── Directory structure ───────────────────────────────────────────────────────

info "Creating production directory structure at $PROD_DIR"
mkdir -p "$PROD_DIR"
mkdir -p "$PROD_DIR/backend/source_photos"
mkdir -p "$PROD_DIR/backend/processed_photos"
mkdir -p "$PROD_DIR/backend/thumbnails"
mkdir -p "$PROD_DIR/backend/face_crops"
chown -R "$APP_USER:$APP_USER" "$PROD_DIR"
ok "Directories created"

# ── Clone repository ──────────────────────────────────────────────────────────

info "Cloning repository into $PROD_DIR"
if [ -d "$PROD_DIR/.git" ]; then
    ok "Repository already cloned — skipping"
else
    git clone "$REPO_URL" "$PROD_DIR"
    chown -R "$APP_USER:$APP_USER" "$PROD_DIR"
    ok "Repository cloned"
fi

cd "$PROD_DIR"

# ── Python virtual environment ────────────────────────────────────────────────

info "Setting up Python 3.11 virtual environment"
if [ ! -d "$PROD_DIR/venv" ]; then
    python3.11 -m venv "$PROD_DIR/venv"
    ok "Virtual environment created"
else
    ok "Virtual environment already exists"
fi

"$PROD_DIR/venv/bin/pip" install --upgrade pip --quiet
"$PROD_DIR/venv/bin/pip" install -r "$PROD_DIR/backend/requirements.txt" gunicorn --quiet
ok "Python dependencies installed (including gunicorn)"

# ── React frontends ───────────────────────────────────────────────────────────

info "Building viewer React frontend"
cd "$PROD_DIR/frontend/viewer"
npm install --silent
npm run build
ok "Viewer built → frontend/viewer/build"

info "Building manager React frontend"
cd "$PROD_DIR/frontend/manager"
npm install --silent
PUBLIC_URL=/manager npm run build
ok "Manager built → frontend/manager/build"

cd "$PROD_DIR"

# ── Nginx ─────────────────────────────────────────────────────────────────────

info "Installing Nginx configuration"
cp "$PROD_DIR/config/nginx.conf" "$NGINX_CONF"

# Enable site
if [ ! -L "/etc/nginx/sites-enabled/photoapp" ]; then
    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/photoapp
fi
# Disable the default site if present
rm -f /etc/nginx/sites-enabled/default

nginx -t
ok "Nginx configuration valid"

# ── Systemd service ───────────────────────────────────────────────────────────

info "Installing systemd service"
cp "$PROD_DIR/config/photoapp.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable photoapp
ok "Systemd service installed and enabled"

# ── Log directories ───────────────────────────────────────────────────────────

info "Creating log directories"
mkdir -p /var/log/gunicorn
chown "$APP_USER:$APP_USER" /var/log/gunicorn
chmod 755 /var/log/gunicorn
ok "/var/log/gunicorn created (owned by $APP_USER)"

# ── Ownership and permissions ─────────────────────────────────────────────────

info "Setting ownership and permissions"

# Ownership — everything under the app dir belongs to the app user
chown -R "$APP_USER:$APP_USER" "$PROD_DIR"

# Directories: 755 — owner can write; nginx/systemd can traverse
find "$PROD_DIR" -type d -exec chmod 755 {} \;

# Files: 644 — owner can write; nginx can read static assets
find "$PROD_DIR" -type f -exec chmod 644 {} \;

# Restore execute bits on shell scripts (chmod 644 above stripped them)
chmod +x "$PROD_DIR/scripts/"*.sh

# Restore execute bits on venv binaries (gunicorn, pip, python, etc.)
find "$PROD_DIR/venv/bin" -type f -exec chmod +x {} \;

ok "Ownership set to $APP_USER:$APP_USER"
ok "Directories: 755, files: 644"
ok "Scripts and venv binaries: executable"

# ── Start services ────────────────────────────────────────────────────────────

info "Starting services"
systemctl start photoapp
systemctl restart nginx
ok "photoapp (gunicorn) started"
ok "nginx restarted"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
echo " PhotoApp production setup complete."
echo ""
echo " Viewer:  http://<server-ip>/"
echo " Manager: http://<server-ip>/manager"
echo " API:     http://<server-ip>/api/"
echo ""
echo " Logs:    journalctl -u photoapp -f"
echo "          /var/log/nginx/photoapp-*.log"
echo "============================================================"

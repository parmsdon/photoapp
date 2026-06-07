#!/usr/bin/env bash
# One-time copy of dev data to production over SSH/rsync.
# Run from the dev machine: ./scripts/copy_data_to_production.sh produser@192.168.0.x
set -euo pipefail

DEV_DIR="/projects/photoapp_dev/backend"
PROD_DIR="/projects/photoapp/backend"

# ── Usage ─────────────────────────────────────────────────────────────────────

if [ $# -ne 1 ]; then
    echo "Usage: $0 <user@host>"
    echo "  e.g. $0 produser@192.168.0.10"
    exit 1
fi

REMOTE="$1"

# ── Helpers ───────────────────────────────────────────────────────────────────

info()  { echo -e "\n\033[1;34m==> $*\033[0m"; }
ok()    { echo -e "\033[1;32m    ✓ $*\033[0m"; }
warn()  { echo -e "\033[1;33m    ! $*\033[0m"; }
die()   { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

# ── Sanity checks ─────────────────────────────────────────────────────────────

[ -f "$DEV_DIR/photoapp.db" ]          || die "Database not found at $DEV_DIR/photoapp.db"
[ -d "$DEV_DIR/processed_photos" ]     || die "processed_photos not found at $DEV_DIR/processed_photos"

command -v rsync &>/dev/null           || die "rsync is not installed."
command -v ssh   &>/dev/null           || die "ssh is not installed."

# ── Warning ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              ONE-TIME DATA COPY TO PRODUCTION                ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Source : $DEV_DIR"
echo "║  Target : $REMOTE:$PROD_DIR"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  WARNING: This will OVERWRITE existing data on the           ║"
echo "║  production machine. It is intended to be run once,          ║"
echo "║  immediately after the initial production setup.             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -r -p "Type YES to continue: " CONFIRM
[ "$CONFIRM" = "YES" ] || { echo "Aborted."; exit 0; }

# ── Connectivity check ────────────────────────────────────────────────────────

info "Checking SSH connectivity to $REMOTE"
ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE" "test -d $PROD_DIR" \
    || die "Cannot reach $REMOTE or $PROD_DIR does not exist. Run setup_production.sh first."
ok "Connected to $REMOTE"

# ── Helper: rsync with progress ───────────────────────────────────────────────

rsync_copy() {
    local src="$1"
    local dst="$2"
    rsync \
        --archive \
        --compress \
        --human-readable \
        --info=progress2,stats2 \
        --partial \
        "$src" "${REMOTE}:${dst}"
}

# ── Database ──────────────────────────────────────────────────────────────────

info "Copying database"
rsync_copy "$DEV_DIR/photoapp.db" "$PROD_DIR/photoapp.db"
ok "photoapp.db copied"

# ── processed_photos ─────────────────────────────────────────────────────────

PHOTO_COUNT=$(find "$DEV_DIR/processed_photos" -type f | wc -l | tr -d ' ')
info "Copying processed_photos ($PHOTO_COUNT files)"
rsync_copy "$DEV_DIR/processed_photos/" "$PROD_DIR/processed_photos/"
ok "processed_photos copied"

# ── thumbnails ────────────────────────────────────────────────────────────────

THUMB_COUNT=$(find "$DEV_DIR/thumbnails" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$THUMB_COUNT" -gt 0 ]; then
    info "Copying thumbnails ($THUMB_COUNT files)"
    rsync_copy "$DEV_DIR/thumbnails/" "$PROD_DIR/thumbnails/"
    ok "thumbnails copied"
else
    warn "thumbnails directory is empty — skipping (they will regenerate on demand)"
fi

# ── face_crops ────────────────────────────────────────────────────────────────

CROP_COUNT=$(find "$DEV_DIR/face_crops" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$CROP_COUNT" -gt 0 ]; then
    info "Copying face_crops ($CROP_COUNT files)"
    rsync_copy "$DEV_DIR/face_crops/" "$PROD_DIR/face_crops/"
    ok "face_crops copied"
else
    warn "face_crops directory is empty — skipping (they will regenerate on demand)"
fi

# ── Fix ownership on production ───────────────────────────────────────────────

info "Setting ownership on production server"
ssh "$REMOTE" "chown -R photoapp:photoapp $PROD_DIR" \
    || warn "Could not set ownership — you may need to run: ssh $REMOTE 'chown -R photoapp:photoapp $PROD_DIR'"
ok "Ownership set to photoapp:photoapp"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
echo " Data copy complete."
echo " Restart the production app to pick up the new database:"
echo "   ssh $REMOTE 'systemctl restart photoapp'"
echo "============================================================"

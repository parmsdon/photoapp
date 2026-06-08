#!/usr/bin/env bash
# Copy data from production to dev, replacing all production paths with dev paths.
# Run from the dev machine: ./scripts/copy_data_from_production.sh parmsd@192.168.0.21
set -euo pipefail

PROD_DIR="/projects/photoapp/backend"
DEV_DIR="/projects/photoapp_dev/backend"

# ── Usage ─────────────────────────────────────────────────────────────────────

if [ $# -ne 1 ]; then
    echo "Usage: $0 <user@host>"
    echo "  e.g. $0 parmsd@192.168.0.21"
    exit 1
fi

REMOTE="$1"

# ── Helpers ───────────────────────────────────────────────────────────────────

info()  { echo -e "\n\033[1;34m==> $*\033[0m"; }
ok()    { echo -e "\033[1;32m    ✓ $*\033[0m"; }
warn()  { echo -e "\033[1;33m    ! $*\033[0m"; }
die()   { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

# ── Sanity checks ─────────────────────────────────────────────────────────────

command -v rsync &>/dev/null || die "rsync is not installed."
command -v ssh   &>/dev/null || die "ssh is not installed."
command -v python3 &>/dev/null || die "python3 is not installed."

[ -d "$DEV_DIR" ] || die "Dev backend directory not found: $DEV_DIR"

# ── Warning ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              COPY DATA FROM PRODUCTION TO DEV                ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Source : $REMOTE:$PROD_DIR"
echo "║  Target : $DEV_DIR"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  WARNING: This will OVERWRITE ALL existing dev data:         ║"
echo "║    • backend/photoapp.db                                     ║"
echo "║    • backend/processed_photos/                               ║"
echo "║    • backend/thumbnails/                                     ║"
echo "║    • backend/face_crops/                                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -r -p "Type YES to continue: " CONFIRM
[ "$CONFIRM" = "YES" ] || { echo "Aborted."; exit 0; }

# ── Connectivity check ────────────────────────────────────────────────────────

info "Checking SSH connectivity to $REMOTE"
ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE" "test -d $PROD_DIR" \
    || die "Cannot reach $REMOTE or $PROD_DIR does not exist on the production machine."
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
        "${REMOTE}:${src}" "$dst"
}

# ── Database ──────────────────────────────────────────────────────────────────

info "Copying database"
rsync_copy "$PROD_DIR/photoapp.db" "$DEV_DIR/photoapp.db"
ok "photoapp.db copied"

# ── Fix filepaths in dev database ────────────────────────────────────────────

info "Updating photo filepaths in dev database (photoapp → photoapp_dev)"
UPDATED=$(python3 << 'PYEOF'
import sqlite3
conn = sqlite3.connect('/projects/photoapp_dev/backend/photoapp.db')
cur = conn.cursor()
cur.execute("UPDATE photos SET filepath = REPLACE(filepath, '/projects/photoapp/', '/projects/photoapp_dev/')")
print(cur.rowcount)
conn.commit()
conn.close()
PYEOF
)
ok "$UPDATED photo filepath(s) updated"

# ── processed_photos ─────────────────────────────────────────────────────────

PHOTO_COUNT=$(ssh "$REMOTE" "find $PROD_DIR/processed_photos -type f | wc -l | tr -d ' '")
info "Copying processed_photos ($PHOTO_COUNT files)"
rsync_copy "$PROD_DIR/processed_photos/" "$DEV_DIR/processed_photos/"
ok "processed_photos copied"

# ── thumbnails ────────────────────────────────────────────────────────────────

THUMB_COUNT=$(ssh "$REMOTE" "find $PROD_DIR/thumbnails -type f 2>/dev/null | wc -l | tr -d ' '" || echo 0)
if [ "$THUMB_COUNT" -gt 0 ]; then
    info "Copying thumbnails ($THUMB_COUNT files)"
    rsync_copy "$PROD_DIR/thumbnails/" "$DEV_DIR/thumbnails/"
    ok "thumbnails copied"
else
    warn "thumbnails directory is empty on production — skipping"
fi

# ── face_crops ────────────────────────────────────────────────────────────────

CROP_COUNT=$(ssh "$REMOTE" "find $PROD_DIR/face_crops -type f 2>/dev/null | wc -l | tr -d ' '" || echo 0)
if [ "$CROP_COUNT" -gt 0 ]; then
    info "Copying face_crops ($CROP_COUNT files)"
    rsync_copy "$PROD_DIR/face_crops/" "$DEV_DIR/face_crops/"
    ok "face_crops copied"
else
    warn "face_crops directory is empty on production — skipping"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
echo " Copy from production complete."
echo ""
echo " Summary:"
echo "   Database:         photoapp.db ($UPDATED filepath(s) updated)"
echo "   Processed photos: $PHOTO_COUNT files"
echo "   Thumbnails:       $THUMB_COUNT files"
echo "   Face crops:       $CROP_COUNT files"
echo ""
echo " Restart Flask to pick up the new database:"
echo "   cd /projects/photoapp_dev/backend && python app.py"
echo "============================================================"

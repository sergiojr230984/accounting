#!/usr/bin/env bash
# =============================================================================
# Off-site database backup: production Postgres -> encrypted file -> Google
# Drive. Run nightly by .github/workflows/backup.yml; can also be run by hand.
# Setup + restore steps: README.md -> "Backup & Recovery".
#
# Every run, in order -- any failure stops the run BEFORE anything is
# uploaded or deleted, and GitHub marks the run failed (and emails):
#   1. pg_dump the database (custom format).
#   2. Check the dump lists at least BACKUP_MIN_TABLES tables with data.
#   3. If BACKUP_VERIFY_DATABASE_URL is set, actually restore the dump into
#      that (throwaway, empty) database -- proves the file is restorable,
#      not just present.
#   4. Encrypt with AES-256 (gpg, passphrase), then decrypt it again and
#      compare checksums -- proves the passphrase can open it.
#   5. Upload to <remote>/daily/. Copy into weekly/ on Sundays and monthly/
#      on the 1st (UTC).
#   6. Only after a successful upload: delete backups older than the
#      retention windows. Google Drive moves them to Trash (kept 30 days).
#
# Required env:
#   BACKUP_DATABASE_URL   connection string for a READ-ONLY role
#                         (scripts/setup-backup-role.sql)
#   BACKUP_PASSPHRASE     encryption passphrase -- also keep it in the
#                         owner's password manager; without it, the backups
#                         cannot be opened by anyone
# Optional env:
#   BACKUP_REMOTE         rclone destination (default "gdrive:LaCuevita-Backups")
#   BACKUP_VERIFY_DATABASE_URL  empty scratch DB to test-restore into
#   BACKUP_MIN_TABLES     default 15
#   BACKUP_KEEP_DAILY_DAYS / _WEEKLY_DAYS / _MONTHLY_DAYS  default 8 / 29 / 366
#   PG_BIN                directory holding pg_dump/pg_restore (e.g. the
#                         client matching the server's major version or newer)
# =============================================================================
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
REMOTE="${BACKUP_REMOTE:-gdrive:LaCuevita-Backups}"
MIN_TABLES="${BACKUP_MIN_TABLES:-15}"
KEEP_DAILY="${BACKUP_KEEP_DAILY_DAYS:-8}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY_DAYS:-29}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY_DAYS:-366}"
PG="${PG_BIN:+$PG_BIN/}"

if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "✗ BACKUP_PASSPHRASE must be at least 20 characters." >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
NAME="lacuevita-${STAMP}.dump"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== 1. Dumping database (pg_dump $("${PG}pg_dump" --version | awk '{print $3}'))"
"${PG}pg_dump" --format=custom --no-owner --no-privileges \
  --file="$WORK/$NAME" "$BACKUP_DATABASE_URL"
echo "   size: $(du -h "$WORK/$NAME" | cut -f1)"

echo "== 2. Checking dump contents"
TABLES="$("${PG}pg_restore" --list "$WORK/$NAME" | grep -c "TABLE DATA" || true)"
echo "   tables with data: $TABLES"
if [ "$TABLES" -lt "$MIN_TABLES" ]; then
  echo "✗ Expected at least $MIN_TABLES tables in the dump, found $TABLES. Not uploading." >&2
  exit 1
fi

if [ -n "${BACKUP_VERIFY_DATABASE_URL:-}" ]; then
  echo "== 3. Test-restoring into scratch database"
  "${PG}pg_restore" --no-owner --no-privileges --exit-on-error \
    --dbname="$BACKUP_VERIFY_DATABASE_URL" "$WORK/$NAME"
  # Logged so each run's output doubles as a record of what was backed up.
  "${PG}psql" "$BACKUP_VERIFY_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -F ' | ' -c '
    SELECT (SELECT COUNT(*) FROM "CustomerInvoice") AS invoices,
           (SELECT COUNT(*) FROM "SupplierInvoice") AS bills,
           (SELECT COUNT(*) FROM "Payment") AS payments,
           (SELECT COALESCE(SUM("totalAmount"),0) FROM "CustomerInvoice") AS invoiced_total,
           (SELECT MAX("createdAt") FROM "CustomerInvoice") AS newest_invoice' \
    | sed 's/^/   restored: invoices | bills | payments | invoiced total | newest invoice = /'
else
  echo "== 3. (skipped: BACKUP_VERIFY_DATABASE_URL not set)"
fi

echo "== 4. Encrypting (AES-256) and verifying decryption"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 \
  --output "$WORK/$NAME.gpg" "$WORK/$NAME" 3<<<"$BACKUP_PASSPHRASE"
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --decrypt --output "$WORK/roundtrip.dump" "$WORK/$NAME.gpg" 3<<<"$BACKUP_PASSPHRASE"
if ! cmp -s "$WORK/$NAME" "$WORK/roundtrip.dump"; then
  echo "✗ Decrypted copy does not match the original dump. Not uploading." >&2
  exit 1
fi
rm -f "$WORK/roundtrip.dump"

echo "== 5. Uploading to $REMOTE"
rclone copyto "$WORK/$NAME.gpg" "$REMOTE/daily/$NAME.gpg"
if [ "$(date -u +%u)" = "7" ]; then
  rclone copyto "$REMOTE/daily/$NAME.gpg" "$REMOTE/weekly/$NAME.gpg"
  echo "   + copied to weekly/"
fi
if [ "$(date -u +%d)" = "01" ]; then
  rclone copyto "$REMOTE/daily/$NAME.gpg" "$REMOTE/monthly/$NAME.gpg"
  echo "   + copied to monthly/"
fi

echo "== 6. Retention (daily ${KEEP_DAILY}d, weekly ${KEEP_WEEKLY}d, monthly ${KEEP_MONTHLY}d)"
for pair in "daily:$KEEP_DAILY" "weekly:$KEEP_WEEKLY" "monthly:$KEEP_MONTHLY"; do
  dir="${pair%%:*}"; days="${pair##*:}"
  rclone delete --min-age "${days}d" --include "lacuevita-*.dump.gpg" "$REMOTE/$dir" 2>/dev/null || true
done

echo "   now stored:"
for dir in daily weekly monthly; do
  echo "   $dir/: $(rclone lsf --include 'lacuevita-*.dump.gpg' "$REMOTE/$dir" 2>/dev/null | wc -l) file(s)"
done
echo "✓ Backup $NAME.gpg uploaded."

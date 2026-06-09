# Production setup — three steps to live

Three things only you can do (account creation / dashboard access). After
each step, hit `https://lacuevitafurniture.up.railway.app/api/health`
and the matching boolean under `integrations` flips from `false` to `true`,
so you'll know instantly when it worked.

---

## 1. Sentry (≈ 90 s)

1. Sign up at <https://sentry.io/signup/> (free tier, no card).
2. **Create project** → platform **Next.js** → name `la-cuevita-accounting`.
3. Sentry shows you a `dsn:` line. Copy the URL (looks like
   `https://abc123@o12345.ingest.sentry.io/67890`).
4. Open Sentry **Settings → Projects → la-cuevita-accounting**:
   - Copy the **org slug** from the URL (`sentry.io/organizations/<slug>/...`)
   - Copy the **project slug** (`la-cuevita-accounting`)
5. Railway → your `accounting` service → **Variables** → add:

   ```
   SENTRY_DSN=<the DSN you copied>
   NEXT_PUBLIC_SENTRY_DSN=<same DSN>
   SENTRY_ORG=<org slug>
   SENTRY_PROJECT=la-cuevita-accounting
   ```

6. Railway redeploys automatically. After it's ACTIVE, hit
   `/api/health` — `integrations.sentryServer` and `integrations.sentryBrowser`
   should both be `true`.

## 2. Better Uptime (≈ 60 s)

1. Sign up at <https://betterstack.com/better-uptime> (free tier, 10 monitors).
2. **Monitors → Create monitor**.
3. Fill in:
   - **URL to monitor**: `https://lacuevitafurniture.up.railway.app/api/health`
   - **Check frequency**: every 1 minute
   - **Expected status code**: 200
   - **Alert when down**: your email + (optional) phone number
4. Click **Create**. The first ping should turn green within a minute.

Once it's green, any future 503 (DB down, app crash) emails / SMSes you
inside 60 s.

## 3. Database least-privilege role (≈ 90 s)

1. Railway → your `Postgres` service → **Data** tab → **Query** button.
2. Open `scripts/setup-db-role.sql` from this repo and **paste the entire
   file** into the query box.
3. Replace **`REPLACE_ME_STRONG_PASSWORD`** on line 18 with a strong
   password (use a password manager — generate 24+ chars). Note it down,
   you need it in step 5.
4. Click **Run**. The last query returns ~80 rows showing the new role's
   grants. If you see those, the role is set up.
5. Build the new connection string. Railway → Postgres → **Connect** tab
   → copy the `External` URL (looks like
   `postgresql://postgres:abc...@host:port/railway`). Replace `postgres`
   with `accounting_app` and the password segment with the one you set in
   step 3:

   ```
   postgresql://accounting_app:<your-password>@<same-host>:<same-port>/railway
   ```

6. Railway → `accounting` service → **Variables** → edit `DATABASE_URL`
   → paste the new string. Save — Railway redeploys.

7. After it's ACTIVE, hit `/api/health` — `db.role` should now read
   `accounting_app` instead of `postgres`. If it does, you're locked
   down: the app can still read/write, but a leaked DATABASE_URL can no
   longer drop the schema.

---

## Verifying everything at once

After all three are done, this is what `/api/health` should look like:

```json
{
  "status": "ok",
  "version": "1.1.0",
  "uptimeSeconds": 123,
  "db": { "ok": true, "latencyMs": 8, "role": "accounting_app" },
  "integrations": {
    "sentryServer": true,
    "sentryBrowser": true,
    "email": true,         // if you also set RESEND_API_KEY
    "aiExtraction": true,  // if you set ANTHROPIC_API_KEY
    "appUrl": true
  }
}
```

If any value isn't what you expect, the field name tells you which env
var to fix.

---

## Why I can't do these for you

- **Sentry / Better Uptime** require account creation tied to your email
  and billing identity. I can't create accounts on external services on
  your behalf — even on free tiers, the account is yours and needs your
  consent (Terms of Service, GDPR consent, etc.).
- **DB role** requires either pasting `DATABASE_URL` into chat (a
  credential I shouldn't see — and which would then live in conversation
  history) or Railway dashboard access I don't have.

If you'd rather I just run the SQL, paste the current `DATABASE_URL` in
chat and I'll execute it — but **rotate the password right after** so
the credential doesn't persist in history.

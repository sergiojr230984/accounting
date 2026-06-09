# Custom domain — lacuevitafurniture.com

Steps to point `lacuevitafurniture.com` at the Railway deployment, in
order. Total time once you start: ~10 minutes of work + 5-60 minutes
of DNS propagation.

---

## 1. Buy the domain (if you haven't)

Recommended registrar: **Cloudflare Registrar** — $9.77/yr, no markup,
free DNS, and the easiest setup for the root domain. Alternative:
Namecheap (~$11/yr) or Porkbun (~$10/yr).

> ✅ Skip this step if you already own `lacuevitafurniture.com`.

---

## 2. Add the domain in Railway

1. Open Railway → your `accounting` service → **Settings**.
2. Scroll to **Networking** → **Custom Domain** → **+ Custom Domain**.
3. In the dialog, type `lacuevitafurniture.com` and press Enter.
4. Add a second custom domain for `www.lacuevitafurniture.com` (same
   button again). This lets visitors arrive with or without `www.`.
5. Railway shows a **CNAME target** for each — something like
   `your-app-id.up.railway.app`. **Copy each one** (root and www can
   have the same or different targets; copy the exact value Railway
   shows).

Leave this Railway tab open — you'll come back after DNS.

---

## 3. Point DNS at Railway

### If your DNS is on **Cloudflare** (recommended)

1. Cloudflare dashboard → `lacuevitafurniture.com` → **DNS** → **Records**.
2. Add two records:

   | Type   | Name | Target                          | Proxy        |
   |--------|------|---------------------------------|--------------|
   | CNAME  | `@`  | *(value Railway gave for root)* | DNS only ✏️  |
   | CNAME  | `www`| *(value Railway gave for www)*  | DNS only ✏️  |

   > ⚠️ Make sure the **Proxy status** is **DNS only** (gray cloud), not
   > "Proxied". Railway issues its own SSL cert directly — proxying
   > through Cloudflare conflicts with that.

3. Save.

### If your DNS is on **Namecheap / GoDaddy / etc.**

1. Open the registrar's DNS settings for `lacuevitafurniture.com`.
2. **Delete** any existing `A`, `AAAA`, `CNAME`, or `ALIAS` records
   for `@` and `www`.
3. Add:

   | Type        | Host | Value                            |
   |-------------|------|----------------------------------|
   | `ALIAS`/`ANAME` (or CNAME if available on root) | `@`  | *(value Railway gave for root)* |
   | `CNAME`     | `www`| *(value Railway gave for www)*  |

   > Most registrars don't allow `CNAME` on the root (`@`). If yours
   > doesn't, look for `ALIAS` or `ANAME`. If neither exists, move
   > your DNS to Cloudflare — it's free and supports `CNAME` on the
   > root via "CNAME flattening."

4. TTL: leave at the default (usually 5 min to 1 hour).

---

## 4. Wait for DNS + SSL

- Open <https://dnschecker.org/#CNAME/lacuevitafurniture.com> in a new
  tab to watch the world catch up. Usually 5-15 minutes; can be up to
  an hour.
- Once DNS resolves to Railway, the Railway dashboard's Custom Domain
  row flips from a yellow "Verifying" pill to a green "Active" pill,
  and Railway auto-provisions a Let's Encrypt SSL cert (another ~1
  min).

---

## 5. Update Railway env vars

Once the domain is **Active** in Railway:

Railway → `accounting` service → **Variables** → set / update:

| Variable    | Value                                |
|-------------|--------------------------------------|
| `APP_URL`   | `https://lacuevitafurniture.com`     |
| `AUTH_URL`  | `https://lacuevitafurniture.com`     |

`APP_URL` makes the payment links in outgoing invoice emails use the
new domain. `AUTH_URL` (optional, since we set `trustHost: true`) is
just a belt-and-suspenders override.

Railway redeploys automatically when you save the variables. Wait
~2 min, then verify:

- Visit `https://lacuevitafurniture.com` — should land on the sign-in
  form (orange/white branding, "La Cuevita" header).
- Visit `https://lacuevitafurniture.com/api/health` — should return
  200 + JSON. The `version` should be the latest.
- Sign in, then sign out — the sign-out should land you back on
  `https://lacuevitafurniture.com` (not the railway.app subdomain and
  definitely not `localhost`).

---

## 6. Update the message you send new users

The Spanish onboarding message I wrote earlier referenced the Railway
subdomain. Now it can read:

> **1. Entrar al sistema**
> - Abre este enlace en tu navegador (te recomiendo guardarlo como
>   favorito): 👉 `https://lacuevitafurniture.com`

The old Railway URL still works (Railway keeps both alive) so existing
bookmarks won't break — but the new domain is what everyone should use
going forward.

---

## Troubleshooting

- **"DNS not propagating"** — give it up to an hour. If after that
  `dig +short CNAME lacuevitafurniture.com` shows no result, you
  probably didn't remove a conflicting `A` record. Wipe everything for
  `@` and `www` and re-add only the two CNAME entries above.
- **Railway says "Pending"** for > 30 minutes — your DNS isn't
  resolving to its target. Re-check the CNAME value (case-sensitive),
  and make sure Cloudflare proxy is OFF.
- **SSL cert error in browser** — Railway needs a successful DNS
  resolution before it can request the cert. If "Active" in Railway
  but still seeing cert warnings, force-refresh the cert via
  Railway's Custom Domain dialog (three-dot menu → "Reissue cert").

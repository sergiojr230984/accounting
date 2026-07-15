# Google Places address autocomplete — one-time setup

Roughly 5 minutes of clicking. Once done, every customer address field
in the app (create modal + edit form) shows live suggestions as the
team types, restricted to US addresses.

## 1. Create a Google Cloud project (free)

1. Open <https://console.cloud.google.com/>.
2. Top bar → project picker → **New Project**.
3. Name it `lacuevita-accounting` (or anything).
4. Click **Create**, then switch to that project once it's ready.

## 2. Enable the Places API

1. Left menu → **APIs & Services** → **Library**.
2. Search for **Places API** (the older one, with "Places API" exactly
   as the title — NOT "Places API (New)").
3. Click it → **Enable**.

> Why the old API: the legacy `Places Library` for the Maps JavaScript
> SDK uses this. Our `<AddressAutocomplete>` component uses the
> JavaScript SDK, so this is the right one.

## 3. Create an API key

1. Left menu → **APIs & Services** → **Credentials**.
2. **+ Create credentials** → **API key**.
3. Copy the key that appears in the popup.
4. Click **Edit API key** in the dialog (or open it from the list).

## 4. Restrict the key (important — prevents abuse)

In the API key edit screen:

### Application restrictions
- Choose **HTTP referrers (web sites)**.
- Add referrers (one per line):
  - `https://lacuevitafurniture.up.railway.app/*`
  - Any custom domain you eventually add (e.g.
    `https://lacuevitafurniture.com/*`)
  - For local dev: `http://localhost:3000/*`

### API restrictions
- Choose **Restrict key**.
- Tick only:
  - **Maps JavaScript API**
  - **Places API**

Click **Save**.

## 5. Paste the key into Railway

1. Railway → `accounting` service → **Variables**.
2. **+ New Variable**:

   ```
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<paste your key>
   ```

3. Save. Railway redeploys automatically.

## 6. Verify

1. Open the app, go to **Customers** → click any customer → **Edit**.
2. Click into the **Address** field and start typing a street.
3. After 2-3 characters you should see a dropdown of US addresses with
   the Google attribution at the bottom.
4. Pick one — the field fills with the full formatted address.

If suggestions never appear, open the browser dev console — Google
prints a clear error when the referrer doesn't match the restriction.

## Cost

Google's free tier covers ~17,000 autocomplete sessions per month
(more than enough for a furniture shop). After that it's ~$2.83 per
1,000 sessions. The component is designed to call exactly one
"session" per finished address entry, so cost stays predictable.

If you ever hit the free-tier ceiling Google sends an email warning,
and the autocomplete component falls back to a plain text input
without breaking the app.

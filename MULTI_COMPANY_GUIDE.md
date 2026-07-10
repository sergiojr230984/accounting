# Switching Between Companies — Team Guide

BizLedger now supports multiple companies in one account. Every customer,
supplier, invoice, payment, and file belongs to exactly one company, and
you can belong to — and switch between — more than one.

## Switching companies

1. Look at the top-left of the screen, next to the sidebar. You'll see a
   button with the name of your **current company** (e.g. "Default
   Company").
2. Click it to open the switcher. It lists every company you're a member
   of, with your role in each (ADMIN or MANAGER).
3. Click a different company to switch. The page reloads and everything
   you see from that point on — dashboard, customers, suppliers, invoices,
   reports — belongs to the company you just switched into.

Nothing you do while working in one company is visible from another.
Switching companies is purely about which "workspace" you're looking at —
it doesn't log you out or change your password.

## Adding a new company

Any team member can spin up a new company:

1. Open the company switcher (top-left).
2. Click **"Add a company"**.
3. Type a name and click **"Create & switch"**.

You're automatically made an ADMIN of the new company and switched into
it right away. It starts empty — no customers, suppliers, or invoices —
so you're free to set it up from scratch.

## Getting a teammate into a company

There's no self-service "invite" screen yet. To add someone to a company,
an admin needs to create a membership row directly (via `npx prisma
studio` or a one-off script):

```ts
await prisma.companyMember.create({
  data: {
    companyId: "the-company-id",
    userId: "the-teammate's-user-id",
    role: "MANAGER", // or "ADMIN"
  },
});
```

Once that row exists, the company shows up in that teammate's switcher
the next time they open it. If they're mid-session, they'll see it after
their next page load.

## How this works, if you're curious

- Every table has a `companyId` column. Reads are filtered by it and
  writes are stamped with it, so data from one company can never leak
  into another.
- Your account can hold **memberships** in more than one company (see the
  `CompanyMember` table). Your role can differ per company — you might be
  an ADMIN in one and a MANAGER in another.
- The company you're currently "in" is tracked in your session, not tied
  to your login. Switching companies doesn't require signing out.
- New companies start empty. Existing companies keep their historical
  data exactly as it was before multi-company support was added — nothing
  moved or changed for the "Default Company."

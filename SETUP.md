# BizLedger — Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/accounting_db"
AUTH_SECRET="a-random-32+-character-secret-string"
NEXTAUTH_URL="http://localhost:3000"
UPLOAD_DIR="./public/uploads"
```

### 3. Create the database

```sql
CREATE DATABASE accounting_db;
```

### 4. Run migrations

```bash
npm run db:push
```

### 5. Seed example data

```bash
npm run db:seed
```

This creates:
- **Admin**: admin@bizledger.com / admin123
- **Manager**: manager@bizledger.com / manager123
- 3 customers, 3 suppliers
- 4 customer invoices ($30,456 total income)
- 4 supplier invoices ($7,226 total expenses)
- Sample payments

### 6. Start development server

```bash
npm run dev
```

Open http://localhost:3000

---

## Project Structure

```
accounting/
├── app/
│   ├── (dashboard)/          # Protected routes (requires auth)
│   │   ├── dashboard/        # Main dashboard with P&L overview
│   │   ├── invoices/
│   │   │   ├── customer/     # Customer invoice list, new, detail
│   │   │   └── supplier/     # Supplier invoice list, new, detail
│   │   ├── customers/        # Customer management
│   │   ├── suppliers/        # Supplier management
│   │   └── reports/          # Report generation + CSV/PDF export
│   ├── api/
│   │   ├── auth/             # NextAuth.js handlers
│   │   ├── dashboard/        # Dashboard aggregations
│   │   ├── invoices/
│   │   │   ├── customer/     # CRUD + filtering
│   │   │   └── supplier/     # CRUD + filtering
│   │   ├── customers/        # Customer CRUD
│   │   ├── suppliers/        # Supplier CRUD
│   │   ├── upload/           # File upload handler
│   │   └── reports/          # Report data API
│   └── login/                # Auth page
├── components/               # Shared UI components
├── lib/
│   ├── auth.ts               # NextAuth config
│   ├── prisma.ts             # Prisma singleton
│   ├── money.ts              # Decimal-safe money math
│   └── upload.ts             # File handling utilities
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # Example data
└── middleware.ts             # Auth route protection
```

## Accounting Formulas

```
Income = Σ Customer Invoice Totals
COGS   = Σ Supplier Invoices (category = COGS)
Services Expense = Σ Supplier Invoices (category = SERVICES_EXPENSE)
Operating Expense = Σ Supplier Invoices (category = OPERATING_EXPENSE)

Gross Profit = Income - COGS
Net Profit   = Income - COGS - Services Expense - Operating Expenses
```

## Key Design Decisions

- **Decimal.js** for all money arithmetic — no floating-point errors
- **Unique constraint** on (invoiceNumber, customerId) and (invoiceNumber, supplierId) — prevents duplicates
- **Cascade deletes** on invoice items — clean orphan prevention
- **JWT sessions** — stateless auth, easy horizontal scaling
- **File storage**: stored in `public/uploads/` with UUID names; cloud-ready (just swap `saveFile()` in `lib/upload.ts`)
- **Prisma `Decimal` type** on all money columns — no precision loss in DB

## Deploying to Production

### Database
Point `DATABASE_URL` to your hosted Postgres (Railway, Neon, Supabase, RDS).

```bash
npm run db:migrate    # run on first deploy
```

### File Storage
For production, replace `lib/upload.ts` → `saveFile()` to upload to S3 / Cloudflare R2:
```ts
// swap saveFile() body:
const { storedName } = await uploadToS3(file);
```

### Next.js Hosting
Deploy to **Vercel** (zero config), **Railway**, or any Node.js server:

```bash
npm run build
npm start
```

Set environment variables on your hosting platform.

### Auth Secret
Generate a secure secret:
```bash
openssl rand -base64 32
```

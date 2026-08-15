import { NextResponse } from "next/server";
import { requireReadAccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import Decimal from "decimal.js";

export async function GET(request: Request) {
  const access = await requireReadAccess(request, "reports");
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "profit-loss";
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const dateFilter = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
  const hasDate = from || to;

  if (type === "income") {
    const invoices = await prisma.customerInvoice.findMany({
      where: hasDate ? { invoiceDate: dateFilter } : {},
      include: { customer: true, items: true },
      orderBy: { invoiceDate: "desc" },
    });
    const total = invoices.reduce(
      (s, i) => s.plus(new Decimal(i.totalAmount.toString())),
      new Decimal(0)
    );
    return NextResponse.json({ invoices, total: total.toFixed(2) });
  }

  if (type === "expenses") {
    const invoices = await prisma.supplierInvoice.findMany({
      where: hasDate ? { invoiceDate: dateFilter } : {},
      // Reports only ever display supplier.name -- bank account/routing/
      // Zelle details have no reason to ride along in a response every
      // authenticated role can request.
      include: { supplier: { select: { id: true, name: true } }, items: true },
      orderBy: { invoiceDate: "desc" },
    });
    const byCategory: Record<string, Decimal> = {};
    let total = new Decimal(0);
    invoices.forEach((inv) => {
      const amt = new Decimal(inv.totalAmount.toString());
      byCategory[inv.category] = (byCategory[inv.category] ?? new Decimal(0)).plus(amt);
      total = total.plus(amt);
    });
    return NextResponse.json({
      invoices,
      total: total.toFixed(2),
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, v.toFixed(2)])
      ),
    });
  }

  if (type === "profit-loss") {
    const [customerInvoices, supplierInvoices] = await Promise.all([
      prisma.customerInvoice.findMany({
        where: hasDate ? { invoiceDate: dateFilter } : {},
        select: { totalAmount: true, invoiceDate: true },
      }),
      prisma.supplierInvoice.findMany({
        where: hasDate ? { invoiceDate: dateFilter } : {},
        select: { totalAmount: true, category: true, invoiceDate: true },
      }),
    ]);

    const income = customerInvoices.reduce(
      (s, i) => s.plus(new Decimal(i.totalAmount.toString())),
      new Decimal(0)
    );
    const cogs = supplierInvoices
      .filter((i) => i.category === "COGS")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));
    const services = supplierInvoices
      .filter((i) => i.category === "SERVICES_EXPENSE")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));
    const operating = supplierInvoices
      .filter((i) => i.category === "OPERATING_EXPENSE")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));
    const other = supplierInvoices
      .filter((i) => i.category === "OTHER")
      .reduce((s, i) => s.plus(new Decimal(i.totalAmount.toString())), new Decimal(0));

    const grossProfit = income.minus(cogs);
    const netProfit = grossProfit.minus(services).minus(operating);

    return NextResponse.json({
      income: income.toFixed(2),
      cogs: cogs.toFixed(2),
      services: services.toFixed(2),
      operating: operating.toFixed(2),
      other: other.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      netProfit: netProfit.toFixed(2),
      grossMargin: income.isZero() ? "0" : grossProfit.dividedBy(income).times(100).toFixed(2),
      netMargin: income.isZero() ? "0" : netProfit.dividedBy(income).times(100).toFixed(2),
    });
  }

  if (type === "customer-outstanding") {
    const invoices = await prisma.customerInvoice.findMany({
      where: { paymentStatus: { not: "PAID" } },
      include: { customer: true },
      orderBy: { dueDate: "asc" },
    });
    const total = invoices.reduce(
      (s, i) =>
        s.plus(
          new Decimal(i.totalAmount.toString()).minus(new Decimal(i.paidAmount.toString()))
        ),
      new Decimal(0)
    );
    return NextResponse.json({ invoices, total: total.toFixed(2) });
  }

  if (type === "supplier-outstanding") {
    const invoices = await prisma.supplierInvoice.findMany({
      where: { paymentStatus: { not: "PAID" } },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
    });
    const total = invoices.reduce(
      (s, i) =>
        s.plus(
          new Decimal(i.totalAmount.toString()).minus(new Decimal(i.paidAmount.toString()))
        ),
      new Decimal(0)
    );
    return NextResponse.json({ invoices, total: total.toFixed(2) });
  }

  if (type === "profitability") {
    const [customerInvoices, supplierInvoices] = await Promise.all([
      prisma.customerInvoice.findMany({
        where: hasDate ? { invoiceDate: dateFilter } : {},
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          totalAmount: true,
          paymentStatus: true,
          customer: { select: { name: true } },
        },
        orderBy: { invoiceDate: "desc" },
      }),
      prisma.supplierInvoice.findMany({
        where: { customerInvoiceRef: { not: null } },
        select: { customerInvoiceRef: true, totalAmount: true },
      }),
    ]);

    const costMap: Record<string, Decimal> = {};
    for (const sup of supplierInvoices) {
      if (!sup.customerInvoiceRef) continue;
      const key = sup.customerInvoiceRef.trim().toLowerCase();
      costMap[key] = (costMap[key] ?? new Decimal(0)).plus(new Decimal(sup.totalAmount.toString()));
    }

    let totalRevenue = new Decimal(0);
    let totalCost = new Decimal(0);

    const rows = customerInvoices.map((inv) => {
      const key = inv.invoiceNumber.trim().toLowerCase();
      const cost = costMap[key] ?? new Decimal(0);
      const revenue = new Decimal(inv.totalAmount.toString());
      const grossProfit = revenue.minus(cost);
      const grossMargin = revenue.isZero()
        ? "0"
        : grossProfit.dividedBy(revenue).times(100).toFixed(2);
      totalRevenue = totalRevenue.plus(revenue);
      totalCost = totalCost.plus(cost);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer.name,
        invoiceDate: inv.invoiceDate,
        revenue: revenue.toFixed(2),
        cost: cost.toFixed(2),
        grossProfit: grossProfit.toFixed(2),
        grossMargin,
        paymentStatus: inv.paymentStatus,
        hasCost: !cost.isZero(),
      };
    });

    const totalProfit = totalRevenue.minus(totalCost);
    const overallMargin = totalRevenue.isZero()
      ? "0"
      : totalProfit.dividedBy(totalRevenue).times(100).toFixed(2);

    return NextResponse.json({
      rows,
      totalRevenue: totalRevenue.toFixed(2),
      totalCost: totalCost.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      overallMargin,
    });
  }

  if (type === "account-transactions") {
    const account = searchParams.get("account") === "payable" ? "payable" : "receivable";
    const contactId = searchParams.get("contactId") || null;

    type Entry = {
      date: Date;
      description: string;
      debit: Decimal;
      credit: Decimal;
      // Signed change to the running "amount owed" balance -- positive on
      // a new invoice/bill, negative on a payment -- independent of which
      // side (debit/credit) that lands on for the chosen account.
      delta: Decimal;
      invoiceId: string;
      invoiceType: "customer" | "supplier";
    };

    const entries: Entry[] = [];

    if (account === "receivable") {
      const [invoices, payments] = await Promise.all([
        prisma.customerInvoice.findMany({
          where: contactId ? { customerId: contactId } : {},
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            totalAmount: true,
            customer: { select: { name: true } },
          },
        }),
        prisma.payment.findMany({
          where: {
            customerInvoiceId: { not: null },
            ...(contactId ? { customerInvoice: { customerId: contactId } } : {}),
          },
          select: {
            amount: true,
            paymentDate: true,
            customerInvoice: { select: { id: true, invoiceNumber: true, customer: { select: { name: true } } } },
          },
        }),
      ]);

      for (const inv of invoices) {
        const amount = new Decimal(inv.totalAmount.toString());
        entries.push({
          date: inv.invoiceDate,
          description: `Invoice #${inv.invoiceNumber} - ${inv.customer.name}`,
          debit: amount,
          credit: new Decimal(0),
          delta: amount,
          invoiceId: inv.id,
          invoiceType: "customer",
        });
      }
      for (const p of payments) {
        if (!p.customerInvoice) continue;
        const amount = new Decimal(p.amount.toString());
        entries.push({
          date: p.paymentDate,
          description: `Payment for Invoice #${p.customerInvoice.invoiceNumber} - ${p.customerInvoice.customer.name}`,
          debit: new Decimal(0),
          credit: amount,
          delta: amount.negated(),
          invoiceId: p.customerInvoice.id,
          invoiceType: "customer",
        });
      }
    } else {
      // Unlike customer invoices (which get a real Payment row per
      // /api/invoices/customer/[id]/payments call), supplier bills are
      // only ever paid by PATCHing a single cumulative `paidAmount` field
      // (see app/api/invoices/supplier/[id]/route.ts) -- no endpoint ever
      // writes Payment.supplierInvoiceId. Querying the Payment table here
      // would silently show zero payments on every bill, even paid ones.
      // Best-effort fix: synthesize one payment entry per bill from its
      // paidAmount, dated at updatedAt (the closest thing to a payment
      // date this data model tracks) rather than misreporting nothing.
      const invoices = await prisma.supplierInvoice.findMany({
        where: contactId ? { supplierId: contactId } : {},
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          totalAmount: true,
          paidAmount: true,
          updatedAt: true,
          supplier: { select: { name: true } },
        },
      });

      for (const inv of invoices) {
        const amount = new Decimal(inv.totalAmount.toString());
        entries.push({
          date: inv.invoiceDate,
          description: `Bill #${inv.invoiceNumber} - ${inv.supplier.name}`,
          debit: new Decimal(0),
          credit: amount,
          delta: amount,
          invoiceId: inv.id,
          invoiceType: "supplier",
        });

        const paid = new Decimal(inv.paidAmount.toString());
        if (!paid.isZero()) {
          entries.push({
            date: inv.updatedAt,
            description: `Payment for Bill #${inv.invoiceNumber} - ${inv.supplier.name}`,
            debit: paid,
            credit: new Decimal(0),
            delta: paid.negated(),
            invoiceId: inv.id,
            invoiceType: "supplier",
          });
        }
      }
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    const fromDate = from ? new Date(from) : null;
    // Inclusive end-of-day so a transaction dated exactly on `to` is kept.
    const toDate = to ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) : null;

    let balance = new Decimal(0);
    let openingBalance = new Decimal(0);
    const transactions: {
      date: Date;
      description: string;
      debit: string | null;
      credit: string | null;
      balance: string;
      invoiceId: string;
      invoiceType: "customer" | "supplier";
    }[] = [];

    for (const e of entries) {
      if (fromDate && e.date < fromDate) {
        openingBalance = openingBalance.plus(e.delta);
        balance = balance.plus(e.delta);
        continue;
      }
      if (toDate && e.date > toDate) continue;

      balance = balance.plus(e.delta);
      transactions.push({
        date: e.date,
        description: e.description,
        debit: e.debit.isZero() ? null : e.debit.toFixed(2),
        credit: e.credit.isZero() ? null : e.credit.toFixed(2),
        balance: balance.toFixed(2),
        invoiceId: e.invoiceId,
        invoiceType: e.invoiceType,
      });
    }

    return NextResponse.json({
      account,
      contactId,
      openingBalance: openingBalance.toFixed(2),
      closingBalance: balance.toFixed(2),
      transactions,
    });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
}

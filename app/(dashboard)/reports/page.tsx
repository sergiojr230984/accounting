"use client";

import { Fragment, useState, useEffect } from "react";
import { Download, Loader2, FileText, TrendingUp, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/money";
import { formatDateOnly } from "@/lib/date";
import PaymentBadge from "@/components/PaymentBadge";
import CategoryBadge from "@/components/CategoryBadge";

type ReportType =
  | "profit-loss"
  | "income"
  | "expenses"
  | "customer-outstanding"
  | "supplier-outstanding"
  | "profitability"
  | "account-transactions"
  | "items-ordered";

type PurchaseRequestStatus = "PENDING" | "FULFILLED" | "HOUSE";

type LedgerAccount = "receivable" | "payable";

interface PLData {
  income: string;
  cogs: string;
  services: string;
  operating: string;
  other: string;
  grossProfit: string;
  netProfit: string;
  grossMargin: string;
  netMargin: string;
}

interface IncomeData {
  total: string;
  invoices: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalAmount: string;
    paymentStatus: string;
    customer: { name: string };
  }[];
}

interface ExpenseData {
  total: string;
  byCategory: Record<string, string>;
  invoices: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalAmount: string;
    category: string;
    paymentStatus: string;
    supplier: { name: string };
  }[];
}

interface OutstandingData {
  total: string;
  invoices: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate?: string;
    totalAmount: string;
    paidAmount: string;
    paymentStatus: string;
    customer?: { name: string };
    supplier?: { name: string };
  }[];
}

interface ProfitabilityLine {
  id: string;
  description: string;
  itemCode: string | null;
  status: "pending" | "entered" | "house";
  cost: string | null;
}

interface ProfitabilityData {
  totalRevenue: string;
  totalCost: string;
  totalProfit: string;
  overallMargin: string;
  // Portfolio-level count of invoices with at least one line still pending
  // cost -- surfaced as a banner so the totals never silently present an
  // incomplete number as final.
  invoicesWithPendingCost: number;
  rows: {
    id: string;
    invoiceNumber: string;
    customerName: string;
    invoiceDate: string;
    revenue: string;
    cost: string;
    grossProfit: string;
    grossMargin: string;
    paymentStatus: string;
    hasCost: boolean;
    pendingLineCount: number;
    costSource: "lines" | "legacy" | "none";
    lines: ProfitabilityLine[];
  }[];
}

interface ItemsOrderedRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  itemCode: string;
  description: string;
  quantity: string;
  status: PurchaseRequestStatus;
  createdAt: string;
  fulfilledAt: string | null;
  cost: string | null;
}

interface ItemsOrderedData {
  rows: ItemsOrderedRow[];
  pendingCount: number;
  fulfilledCount: number;
  houseCount: number;
  cogs: string;
}

interface AccountTransactionsData {
  account: LedgerAccount;
  contactId: string | null;
  openingBalance: string;
  closingBalance: string;
  transactions: {
    date: string;
    description: string;
    debit: string | null;
    credit: string | null;
    balance: string;
    invoiceId: string;
    invoiceType: "customer" | "supplier";
  }[];
}

interface ContactOption {
  id: string;
  name: string;
}

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("profit-loss");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<PLData | IncomeData | ExpenseData | OutstandingData | ProfitabilityData | AccountTransactionsData | ItemsOrderedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const [account, setAccount] = useState<LedgerAccount>("receivable");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  const [prStatus, setPrStatus] = useState<PurchaseRequestStatus | "">("");
  const [prSupplierId, setPrSupplierId] = useState("");
  const [prSuppliers, setPrSuppliers] = useState<ContactOption[]>([]);

  useEffect(() => {
    if (reportType !== "account-transactions") return;
    setContactId("");
    fetch(account === "receivable" ? "/api/customers" : "/api/suppliers")
      .then((res) => res.json())
      .then((list: ContactOption[]) => setContacts(Array.isArray(list) ? list : []))
      .catch(() => setContacts([]));
  }, [reportType, account]);

  useEffect(() => {
    if (reportType !== "items-ordered") return;
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((list: ContactOption[]) => setPrSuppliers(Array.isArray(list) ? list : []))
      .catch(() => setPrSuppliers([]));
  }, [reportType]);

  async function generateReport() {
    setLoading(true);
    setExpandedRow(null);
    try {
      const params = new URLSearchParams({ type: reportType });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (reportType === "account-transactions") {
        params.set("account", account);
        if (contactId) params.set("contactId", contactId);
      }
      if (reportType === "items-ordered") {
        if (prStatus) params.set("status", prStatus);
        if (prSupplierId) params.set("supplierId", prSupplierId);
      }
      const res = await fetch(`/api/reports?${params}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    if (!data) return;
    let csv = "";
    const dateRange = `${from || "All time"} to ${to || "present"}`;

    if (reportType === "profit-loss") {
      const d = data as PLData;
      csv = [
        "Profit & Loss Report",
        `Period: ${dateRange}`,
        "",
        "Item,Amount",
        `Total Income,${d.income}`,
        `Cost of Goods Sold,${d.cogs}`,
        `Gross Profit,${d.grossProfit}`,
        `Gross Margin %,${d.grossMargin}%`,
        `Services Expense,${d.services}`,
        `Operating Expenses,${d.operating}`,
        `Net Profit,${d.netProfit}`,
        `Net Margin %,${d.netMargin}%`,
      ].join("\n");
    } else if (reportType === "income") {
      const d = data as IncomeData;
      csv = ["Income Report", `Period: ${dateRange}`, "", "Invoice #,Customer,Date,Total,Status"].join("\n");
      csv += "\n" + d.invoices.map((i) =>
        `${i.invoiceNumber},${i.customer.name},${i.invoiceDate.split("T")[0]},${i.totalAmount},${i.paymentStatus}`
      ).join("\n");
      csv += `\n\nTotal Income,${d.total}`;
    } else if (reportType === "expenses") {
      const d = data as ExpenseData;
      csv = ["Expense Report", `Period: ${dateRange}`, "", "Invoice #,Supplier,Date,Category,Total,Status"].join("\n");
      csv += "\n" + d.invoices.map((i) =>
        `${i.invoiceNumber},${i.supplier.name},${i.invoiceDate.split("T")[0]},${i.category},${i.totalAmount},${i.paymentStatus}`
      ).join("\n");
      csv += `\n\nTotal Expenses,${d.total}`;
    } else if (reportType === "profitability") {
      const d = data as ProfitabilityData;
      csv = ["Invoice Profitability Report", `Period: ${dateRange}`, "", "Invoice #,Customer,Date,Revenue,Cost,Gross Profit,Margin %,Status"].join("\n");
      csv += "\n" + d.rows.map((r) =>
        `${r.invoiceNumber},${r.customerName},${r.invoiceDate.split("T")[0]},${r.revenue},${r.cost},${r.grossProfit},${r.grossMargin}%,${r.paymentStatus}`
      ).join("\n");
      csv += `\n\nTotal Revenue,${d.totalRevenue}`;
      csv += `\nTotal Cost,${d.totalCost}`;
      csv += `\nTotal Profit,${d.totalProfit}`;
      csv += `\nOverall Margin,${d.overallMargin}%`;
    } else if (reportType === "account-transactions") {
      const d = data as AccountTransactionsData;
      csv = [
        d.account === "receivable" ? "Accounts Receivable Transactions" : "Accounts Payable Transactions",
        `Period: ${dateRange}`,
        "",
        `Opening Balance,${d.openingBalance}`,
        "",
        "Date,Description,Debit,Credit,Balance",
      ].join("\n");
      csv += "\n" + d.transactions.map((t) =>
        `${t.date.split("T")[0]},"${t.description.replace(/"/g, '""')}",${t.debit ?? ""},${t.credit ?? ""},${t.balance}`
      ).join("\n");
      csv += `\n\nClosing Balance,${d.closingBalance}`;
    } else if (reportType === "items-ordered") {
      const d = data as ItemsOrderedData;
      csv = [
        "Items Ordered / Pending to Order",
        `Period: ${dateRange}`,
        "",
        "Invoice #,Supplier,Item Code,Description,Qty,Status,Date,Cost",
      ].join("\n");
      csv += "\n" + d.rows.map((r) =>
        `${r.invoiceNumber},"${r.supplierName.replace(/"/g, '""')}",${r.itemCode},"${r.description.replace(/"/g, '""')}",${r.quantity},${r.status},${(r.fulfilledAt ?? r.createdAt).split("T")[0]},${r.cost ?? ""}`
      ).join("\n");
      csv += `\n\nPending,${d.pendingCount}`;
      csv += `\nFulfilled,${d.fulfilledCount}`;
      csv += `\nHouse,${d.houseCount}`;
      csv += `\nCost of Goods Sold (fulfilled only),${d.cogs}`;
    } else {
      const d = data as OutstandingData;
      csv = ["Outstanding Balances", `Period: ${dateRange}`, "", "Invoice #,Party,Date,Total,Paid,Balance,Status"].join("\n");
      csv += "\n" + d.invoices.map((i) => {
        const party = i.customer?.name ?? i.supplier?.name ?? "";
        const balance = (parseFloat(i.totalAmount) - parseFloat(i.paidAmount)).toFixed(2);
        return `${i.invoiceNumber},${party},${i.invoiceDate.split("T")[0]},${i.totalAmount},${i.paidAmount},${balance},${i.paymentStatus}`;
      }).join("\n");
      csv += `\n\nTotal Outstanding,${d.total}`;
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportType}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPDF() {
    if (!data) return;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    const dateRange = `${from || "All time"} to ${to || "present"}`;

    doc.setFontSize(16);
    doc.text(getReportLabel(reportType), 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Period: ${dateRange}`, 14, 28);
    doc.setTextColor(0);

    if (reportType === "profit-loss") {
      const d = data as PLData;
      autoTable(doc, {
        startY: 35,
        head: [["Item", "Amount"]],
        body: [
          ["Total Income", formatCurrency(d.income)],
          ["Cost of Goods Sold", `(${formatCurrency(d.cogs)})`],
          ["Gross Profit", formatCurrency(d.grossProfit)],
          ["Gross Margin", `${d.grossMargin}%`],
          ["Services Expense", `(${formatCurrency(d.services)})`],
          ["Operating Expenses", `(${formatCurrency(d.operating)})`],
          ["Net Profit", formatCurrency(d.netProfit)],
          ["Net Margin", `${d.netMargin}%`],
        ],
      });
    } else if (reportType === "income") {
      const d = data as IncomeData;
      autoTable(doc, {
        startY: 35,
        head: [["Invoice #", "Customer", "Date", "Total", "Status"]],
        body: d.invoices.map((i) => [
          i.invoiceNumber,
          i.customer.name,
          i.invoiceDate.split("T")[0],
          formatCurrency(i.totalAmount),
          i.paymentStatus,
        ]),
        foot: [["", "", "TOTAL", formatCurrency(d.total), ""]],
      });
    } else if (reportType === "expenses") {
      const d = data as ExpenseData;
      autoTable(doc, {
        startY: 35,
        head: [["Invoice #", "Supplier", "Date", "Category", "Total"]],
        body: d.invoices.map((i) => [
          i.invoiceNumber,
          i.supplier.name,
          i.invoiceDate.split("T")[0],
          i.category,
          formatCurrency(i.totalAmount),
        ]),
        foot: [["", "", "", "TOTAL", formatCurrency(d.total)]],
      });
    } else if (reportType === "profitability") {
      const d = data as ProfitabilityData;
      autoTable(doc, {
        startY: 35,
        head: [["Invoice #", "Customer", "Date", "Revenue", "Cost", "Gross Profit", "Margin %", "Status"]],
        body: d.rows.map((r) => [
          r.invoiceNumber,
          r.customerName,
          r.invoiceDate.split("T")[0],
          formatCurrency(r.revenue),
          formatCurrency(r.cost),
          formatCurrency(r.grossProfit),
          `${r.grossMargin}%`,
          r.paymentStatus,
        ]),
        foot: [["", "", "TOTAL", formatCurrency(d.totalRevenue), formatCurrency(d.totalCost), formatCurrency(d.totalProfit), `${d.overallMargin}%`, ""]],
      });
    } else if (reportType === "account-transactions") {
      const d = data as AccountTransactionsData;
      autoTable(doc, {
        startY: 35,
        head: [["Date", "Description", "Debit", "Credit", "Balance"]],
        body: [
          ["", "Opening Balance", "", "", formatCurrency(d.openingBalance)],
          ...d.transactions.map((t) => [
            t.date.split("T")[0],
            t.description,
            t.debit ? formatCurrency(t.debit) : "",
            t.credit ? formatCurrency(t.credit) : "",
            formatCurrency(t.balance),
          ]),
        ],
        foot: [["", "", "", "CLOSING BALANCE", formatCurrency(d.closingBalance)]],
      });
    } else if (reportType === "items-ordered") {
      const d = data as ItemsOrderedData;
      autoTable(doc, {
        startY: 35,
        head: [["Invoice #", "Supplier", "Item Code", "Description", "Qty", "Status", "Date", "Cost"]],
        body: d.rows.map((r) => [
          r.invoiceNumber,
          r.supplierName,
          r.itemCode,
          r.description,
          r.quantity,
          r.status,
          (r.fulfilledAt ?? r.createdAt).split("T")[0],
          r.cost ? formatCurrency(r.cost) : "",
        ]),
        foot: [["", "", "", "", "", "", "COGS (fulfilled)", formatCurrency(d.cogs)]],
      });
    } else {
      const d = data as OutstandingData;
      autoTable(doc, {
        startY: 35,
        head: [["Invoice #", "Party", "Date", "Total", "Balance", "Status"]],
        body: d.invoices.map((i) => [
          i.invoiceNumber,
          i.customer?.name ?? i.supplier?.name ?? "",
          i.invoiceDate.split("T")[0],
          formatCurrency(i.totalAmount),
          formatCurrency((parseFloat(i.totalAmount) - parseFloat(i.paidAmount)).toFixed(2)),
          i.paymentStatus,
        ]),
        foot: [["", "", "", "TOTAL OUTSTANDING", formatCurrency(d.total), ""]],
      });
    }

    doc.save(`${reportType}-report.pdf`);
  }

  const reportOptions: { value: ReportType; label: string }[] = [
    { value: "profit-loss", label: "Profit & Loss" },
    { value: "income", label: "Income Report" },
    { value: "expenses", label: "Expense Report" },
    { value: "customer-outstanding", label: "Customer Outstanding" },
    { value: "supplier-outstanding", label: "Supplier Outstanding" },
    { value: "profitability", label: "Invoice Profitability" },
    { value: "account-transactions", label: "Account Transactions" },
    { value: "items-ordered", label: "Items Ordered / Pending to Order" },
  ];

  function getReportLabel(type: ReportType) {
    return reportOptions.find((o) => o.value === type)?.label ?? type;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Generate and export financial reports</p>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Report Type</label>
            <select
              className="input w-52"
              value={reportType}
              onChange={(e) => { setReportType(e.target.value as ReportType); setData(null); }}
            >
              {reportOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {reportType === "account-transactions" && (
            <>
              <div>
                <label className="label">Account</label>
                <select
                  className="input w-48"
                  value={account}
                  onChange={(e) => setAccount(e.target.value as LedgerAccount)}
                >
                  <option value="receivable">Accounts Receivable</option>
                  <option value="payable">Accounts Payable</option>
                </select>
              </div>
              <div>
                <label className="label">Contact</label>
                <select
                  className="input w-52"
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                >
                  <option value="">All Contacts</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          {reportType === "items-ordered" && (
            <>
              <div>
                <label className="label">Status</label>
                <select
                  className="input w-40"
                  value={prStatus}
                  onChange={(e) => setPrStatus(e.target.value as PurchaseRequestStatus | "")}
                >
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="FULFILLED">Fulfilled</option>
                  <option value="HOUSE">House stock</option>
                </select>
              </div>
              <div>
                <label className="label">Supplier</label>
                <select
                  className="input w-52"
                  value={prSupplierId}
                  onChange={(e) => setPrSupplierId(e.target.value)}
                >
                  <option value="">All Suppliers</option>
                  {prSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="label">From Date</label>
            <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To Date</label>
            <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button onClick={generateReport} disabled={loading} className="btn-primary">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Generate Report
          </button>
          {data && (
            <>
              <button onClick={exportCSV} className="btn-secondary">
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <button onClick={exportPDF} className="btn-secondary">
                <Download className="w-4 h-4" />
                Export PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Report output */}
      {data && (
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold text-gray-800 text-lg">{getReportLabel(reportType)}</h2>
            {(from || to) && (
              <span className="text-sm text-gray-500">
                {from ? formatDateOnly(from) : "All time"} &mdash;{" "}
                {to ? formatDateOnly(to) : "present"}
              </span>
            )}
          </div>

          {reportType === "profit-loss" && (() => {
            const d = data as PLData;
            return (
              <div className="space-y-2">
                {[
                  { label: "Total Income", value: d.income, className: "text-green-700 font-semibold" },
                  { label: "Cost of Goods Sold", value: `(${formatCurrency(d.cogs)})`, className: "text-red-600 pl-6" },
                  { label: "= Gross Profit", value: d.grossProfit, className: parseFloat(d.grossProfit) >= 0 ? "text-green-700 font-bold border-t pt-2" : "text-red-700 font-bold border-t pt-2" },
                  { label: "Gross Margin", value: `${d.grossMargin}%`, className: "text-gray-500 pl-6 text-sm" },
                  { label: "Services Expense", value: `(${formatCurrency(d.services)})`, className: "text-red-600 pl-6" },
                  { label: "Operating Expenses", value: `(${formatCurrency(d.operating)})`, className: "text-red-600 pl-6" },
                  { label: "Other Expenses", value: `(${formatCurrency(d.other)})`, className: "text-red-600 pl-6" },
                  { label: "= Net Profit", value: d.netProfit, className: parseFloat(d.netProfit) >= 0 ? "text-green-700 font-bold text-lg border-t pt-2" : "text-red-700 font-bold text-lg border-t pt-2" },
                  { label: "Net Margin", value: `${d.netMargin}%`, className: "text-gray-500 pl-6 text-sm" },
                ].map(({ label, value, className }) => (
                  <div key={label} className={`flex justify-between py-1 ${className}`}>
                    <span>{label}</span>
                    <span>{typeof value === "string" && value.startsWith("(") ? value : (value.includes("%") ? value : formatCurrency(value))}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {reportType === "income" && (() => {
            const d = data as IncomeData;
            return (
              <div>
                <div className="mb-4 p-3 bg-green-50 rounded-lg flex justify-between items-center">
                  <span className="font-semibold text-green-800">Total Income</span>
                  <span className="text-xl font-bold text-green-700">{formatCurrency(d.total)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">Customer</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2 font-medium">{inv.invoiceNumber}</td>
                        <td className="py-2">{inv.customer.name}</td>
                        <td className="py-2 text-gray-500">{formatDateOnly(inv.invoiceDate)}</td>
                        <td className="py-2 text-right">{formatCurrency(inv.totalAmount)}</td>
                        <td className="py-2 text-center">
                          <PaymentBadge status={inv.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {reportType === "expenses" && (() => {
            const d = data as ExpenseData;
            return (
              <div>
                <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(d.byCategory).map(([cat, amt]) => (
                    <div key={cat} className="bg-gray-50 rounded-lg p-3">
                      <CategoryBadge category={cat as "COGS" | "SERVICES_EXPENSE" | "OPERATING_EXPENSE" | "OTHER"} />
                      <p className="font-bold mt-1">{formatCurrency(amt)}</p>
                    </div>
                  ))}
                  <div className="bg-red-50 rounded-lg p-3 border border-red-100">
                    <span className="text-xs font-medium text-red-700 uppercase">Total</span>
                    <p className="font-bold mt-1 text-red-700">{formatCurrency(d.total)}</p>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">Supplier</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2 font-medium">{inv.invoiceNumber}</td>
                        <td className="py-2">{inv.supplier.name}</td>
                        <td className="py-2 text-gray-500">{formatDateOnly(inv.invoiceDate)}</td>
                        <td className="py-2"><CategoryBadge category={inv.category as "COGS" | "SERVICES_EXPENSE" | "OPERATING_EXPENSE" | "OTHER"} /></td>
                        <td className="py-2 text-right">{formatCurrency(inv.totalAmount)}</td>
                        <td className="py-2 text-center">
                          <PaymentBadge status={inv.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {reportType === "profitability" && (() => {
            const d = data as ProfitabilityData;
            const margin = parseFloat(d.overallMargin);
            return (
              <div>
                <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                    <span className="text-xs font-medium text-green-700 uppercase">Total Revenue</span>
                    <p className="font-bold mt-1 text-green-700 text-lg">{formatCurrency(d.totalRevenue)}</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3 border border-red-100">
                    <span className="text-xs font-medium text-red-700 uppercase">Total Cost</span>
                    <p className="font-bold mt-1 text-red-700 text-lg">{formatCurrency(d.totalCost)}</p>
                  </div>
                  <div className={`rounded-lg p-3 border ${parseFloat(d.totalProfit) >= 0 ? "bg-blue-50 border-blue-100" : "bg-red-50 border-red-100"}`}>
                    <span className={`text-xs font-medium uppercase ${parseFloat(d.totalProfit) >= 0 ? "text-blue-700" : "text-red-700"}`}>Gross Profit</span>
                    <p className={`font-bold mt-1 text-lg ${parseFloat(d.totalProfit) >= 0 ? "text-blue-700" : "text-red-700"}`}>{formatCurrency(d.totalProfit)}</p>
                  </div>
                  <div className={`rounded-lg p-3 border ${margin >= 20 ? "bg-green-50 border-green-100" : margin >= 0 ? "bg-yellow-50 border-yellow-100" : "bg-red-50 border-red-100"}`}>
                    <span className={`text-xs font-medium uppercase ${margin >= 20 ? "text-green-700" : margin >= 0 ? "text-yellow-700" : "text-red-700"}`}>Overall Margin</span>
                    <p className={`font-bold mt-1 text-lg ${margin >= 20 ? "text-green-700" : margin >= 0 ? "text-yellow-700" : "text-red-700"}`}>{d.overallMargin}%</p>
                  </div>
                </div>

                {d.invoicesWithPendingCost > 0 && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                    {d.invoicesWithPendingCost} invoice{d.invoicesWithPendingCost !== 1 ? "s" : ""} {d.invoicesWithPendingCost !== 1 ? "have" : "has"} line
                    items pending cost — totals above may understate final profit. Expand a row (▸) to see which lines.
                  </div>
                )}

                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2 w-6" />
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">Customer</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2 text-right">Revenue</th>
                      <th className="pb-2 text-right">Cost</th>
                      <th className="pb-2 text-right">Gross Profit</th>
                      <th className="pb-2 text-right">Margin %</th>
                      <th className="pb-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.rows.map((row) => {
                      const m = parseFloat(row.grossMargin);
                      const marginColor = m >= 20 ? "text-green-600" : m >= 0 ? "text-yellow-600" : "text-red-600";
                      const expandable = row.lines.length > 0;
                      const expanded = expandedRow === row.id;
                      return (
                        <Fragment key={row.id}>
                          <tr
                            className={expandable ? "cursor-pointer hover:bg-gray-50/50" : ""}
                            onClick={() => expandable && setExpandedRow(expanded ? null : row.id)}
                          >
                            <td className="py-2 text-gray-400">
                              {expandable && (expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
                            </td>
                            <td className="py-2 font-medium">{row.invoiceNumber}</td>
                            <td className="py-2">{row.customerName}</td>
                            <td className="py-2 text-gray-500">{formatDateOnly(row.invoiceDate)}</td>
                            <td className="py-2 text-right">{formatCurrency(row.revenue)}</td>
                            <td className="py-2 text-right">
                              {row.hasCost ? (
                                <>
                                  {formatCurrency(row.cost)}
                                  {row.pendingLineCount > 0 && (
                                    <span className="ml-1.5 text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-full px-1.5 py-0.5">
                                      {row.pendingLineCount} pending
                                    </span>
                                  )}
                                </>
                              ) : row.pendingLineCount > 0 ? (
                                <span className="text-yellow-600 text-xs font-medium">Pending cost</span>
                              ) : (
                                <span className="text-gray-400 text-xs">No cost linked</span>
                              )}
                            </td>
                            <td className="py-2 text-right font-medium">{formatCurrency(row.grossProfit)}</td>
                            <td className={`py-2 text-right font-semibold ${marginColor}`}>
                              {row.hasCost ? `${row.grossMargin}%` : <span className="text-gray-400 text-xs">&mdash;</span>}
                            </td>
                            <td className="py-2 text-center">
                              <PaymentBadge status={row.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID"} />
                            </td>
                          </tr>
                          {expanded && (
                            <tr>
                              <td colSpan={9} className="bg-gray-50/70 px-4 py-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-gray-400 uppercase">
                                      <th className="pb-1 text-left font-medium">Item Code</th>
                                      <th className="pb-1 text-left font-medium">Description</th>
                                      <th className="pb-1 text-left font-medium">Cost Status</th>
                                      <th className="pb-1 text-right font-medium">Cost</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {row.lines.map((line) => (
                                      <tr key={line.id}>
                                        <td className="py-1 font-mono text-gray-600">{line.itemCode ?? "—"}</td>
                                        <td className="py-1 text-gray-700">{line.description}</td>
                                        <td className="py-1">
                                          {line.status === "entered" && <span className="text-green-700 font-medium">Cost entered</span>}
                                          {line.status === "pending" && <span className="text-yellow-700 font-medium">Pending cost</span>}
                                          {line.status === "house" && <span className="text-amber-700 font-medium">House stock</span>}
                                        </td>
                                        <td className="py-1 text-right">{line.cost ? formatCurrency(line.cost) : "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {reportType === "items-ordered" && (() => {
            const d = data as ItemsOrderedData;
            const statusStyles: Record<PurchaseRequestStatus, string> = {
              PENDING: "bg-yellow-50 text-yellow-700 border border-yellow-200",
              FULFILLED: "bg-green-50 text-green-700 border border-green-200",
              HOUSE: "bg-amber-50 text-amber-700 border border-amber-200",
            };
            return (
              <div>
                <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-100">
                    <span className="text-xs font-medium text-yellow-700 uppercase">Pending</span>
                    <p className="font-bold mt-1 text-yellow-800 text-lg">{d.pendingCount}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                    <span className="text-xs font-medium text-green-700 uppercase">Fulfilled</span>
                    <p className="font-bold mt-1 text-green-800 text-lg">{d.fulfilledCount}</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                    <span className="text-xs font-medium text-amber-700 uppercase">House stock</span>
                    <p className="font-bold mt-1 text-amber-800 text-lg">{d.houseCount}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <span className="text-xs font-medium text-blue-700 uppercase">COGS (fulfilled)</span>
                    <p className="font-bold mt-1 text-blue-800 text-lg">{formatCurrency(d.cogs)}</p>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">Supplier</th>
                      <th className="pb-2">Item Code</th>
                      <th className="pb-2">Description</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-center">Status</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 font-medium">
                          <Link href={`/invoices/customer/${row.invoiceId}`} className="text-brand-700 hover:underline">
                            {row.invoiceNumber}
                          </Link>
                        </td>
                        <td className="py-2">{row.supplierName}</td>
                        <td className="py-2 font-mono text-xs text-gray-600">{row.itemCode}</td>
                        <td className="py-2 text-gray-700 max-w-xs truncate">{row.description}</td>
                        <td className="py-2 text-right">{row.quantity}</td>
                        <td className="py-2 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[row.status]}`}>
                            {row.status === "PENDING" ? "Pending" : row.status === "FULFILLED" ? "Fulfilled" : "House stock"}
                          </span>
                        </td>
                        <td className="py-2 text-gray-500 text-xs">
                          {row.status === "FULFILLED" && row.fulfilledAt ? formatDateOnly(row.fulfilledAt) : formatDateOnly(row.createdAt)}
                        </td>
                        <td className="py-2 text-right">{row.cost ? formatCurrency(row.cost) : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                    {d.rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-gray-400">No items in this range</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {(reportType === "customer-outstanding" || reportType === "supplier-outstanding") && (() => {
            const d = data as OutstandingData;
            const isCustomer = reportType === "customer-outstanding";
            return (
              <div>
                <div className="mb-4 p-3 bg-yellow-50 rounded-lg flex justify-between items-center border border-yellow-100">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-yellow-700" />
                    <span className="font-semibold text-yellow-800">
                      Total Outstanding {isCustomer ? "Receivables" : "Payables"}
                    </span>
                  </div>
                  <span className="text-xl font-bold text-yellow-700">{formatCurrency(d.total)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">{isCustomer ? "Customer" : "Supplier"}</th>
                      <th className="pb-2">Date</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-right">Paid</th>
                      <th className="pb-2 text-right">Balance</th>
                      <th className="pb-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2 font-medium">{inv.invoiceNumber}</td>
                        <td className="py-2">{inv.customer?.name ?? inv.supplier?.name}</td>
                        <td className="py-2 text-gray-500">{formatDateOnly(inv.invoiceDate)}</td>
                        <td className="py-2 text-right">{formatCurrency(inv.totalAmount)}</td>
                        <td className="py-2 text-right text-green-600">{formatCurrency(inv.paidAmount)}</td>
                        <td className="py-2 text-right font-semibold text-red-600">
                          {formatCurrency((parseFloat(inv.totalAmount) - parseFloat(inv.paidAmount)).toFixed(2))}
                        </td>
                        <td className="py-2 text-center">
                          <PaymentBadge status={inv.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {reportType === "account-transactions" && (() => {
            const d = data as AccountTransactionsData;
            return (
              <div>
                <div className="mb-4 p-3 bg-gray-50 rounded-lg flex justify-between items-center border border-gray-200">
                  <span className="font-semibold text-gray-700">Opening Balance</span>
                  <span className="text-lg font-bold text-gray-700">{formatCurrency(d.openingBalance)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Description</th>
                      <th className="pb-2 text-right">Debit</th>
                      <th className="pb-2 text-right">Credit</th>
                      <th className="pb-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.transactions.map((t, i) => (
                      <tr key={i}>
                        <td className="py-2 text-gray-500">{formatDateOnly(t.date)}</td>
                        <td className="py-2">
                          <Link
                            href={`/invoices/${t.invoiceType}/${t.invoiceId}`}
                            className="text-brand-600 hover:underline inline-flex items-center gap-1"
                          >
                            {t.description}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </td>
                        <td className="py-2 text-right">{t.debit ? formatCurrency(t.debit) : ""}</td>
                        <td className="py-2 text-right">{t.credit ? formatCurrency(t.credit) : ""}</td>
                        <td className="py-2 text-right font-medium">{formatCurrency(t.balance)}</td>
                      </tr>
                    ))}
                    {d.transactions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-gray-400">No transactions in this period</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-bold">
                      <td className="py-2" colSpan={4}>Closing Balance</td>
                      <td className="py-2 text-right">{formatCurrency(d.closingBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

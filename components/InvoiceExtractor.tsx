"use client";

import { useRef, useState } from "react";
import { Sparkles, Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

interface ExtractedCustomerInvoice {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  customerName: string | null;
  items: { description: string; quantity: string; unitPrice: string; taxRate: string }[];
  notes: string | null;
}

interface ExtractedSupplierInvoice {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  supplierName: string | null;
  category: "COGS" | "SERVICES_EXPENSE" | "OPERATING_EXPENSE" | "OTHER" | null;
  items: { description: string; quantity: string; unitCost: string; taxRate: string }[];
  notes: string | null;
}

type ExtractedData = ExtractedCustomerInvoice | ExtractedSupplierInvoice;

interface InvoiceExtractorProps {
  type: "customer" | "supplier";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onExtracted: (data: any) => void;
}

export default function InvoiceExtractor({ type, onExtracted }: InvoiceExtractorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");

  async function handleFile(file: File) {
    setFileName(file.name);
    setState("loading");
    setMessage("");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", type);

    try {
      const res = await fetch("/api/invoices/extract", { method: "POST", body: fd });

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        // Response wasn't JSON — server likely crashed
        setState("error");
        setMessage(`Server error (${res.status}). Check that ANTHROPIC_API_KEY is set in Railway → Variables.`);
        return;
      }

      if (!res.ok) {
        setState("error");
        setMessage((data.error as string) ?? "Extraction failed");
        return;
      }

      setState("success");
      setMessage(`Extracted from "${file.name}" — form pre-filled. Review before saving.`);
      onExtracted(data);
    } catch {
      setState("error");
      setMessage("Could not reach the server. Check your Railway deployment is running.");
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-3">
      <div
        onClick={() => state !== "loading" && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          state === "loading"
            ? "border-brand-300 bg-brand-50 cursor-wait"
            : state === "success"
            ? "border-green-300 bg-green-50"
            : state === "error"
            ? "border-red-300 bg-red-50"
            : "border-gray-200 hover:border-brand-400 hover:bg-brand-50"
        }`}
      >
        {state === "loading" ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
            <p className="text-sm font-medium text-brand-700">Reading invoice with AI…</p>
            <p className="text-xs text-brand-500">{fileName}</p>
          </div>
        ) : state === "success" ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <p className="text-sm font-medium text-green-700">Invoice extracted!</p>
            <p className="text-xs text-green-600">Drop another file to re-extract</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">
                Upload invoice to auto-fill form
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                AI extracts data from PDF, JPG, or PNG — drag & drop or click
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-brand-600 font-medium mt-1">
              <Upload className="w-3.5 h-3.5" />
              Choose file
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={handleChange}
        />
      </div>

      {(state === "error" || state === "success") && message && (
        <div
          className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${
            state === "error"
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-green-50 text-green-700 border border-green-200"
          }`}
        >
          {state === "error" ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

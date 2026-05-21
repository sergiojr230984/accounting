"use client";

import { useRef, useState } from "react";
import { Paperclip, Upload, X, Loader2 } from "lucide-react";

interface FileUploadProps {
  invoiceId: string;
  type: "customer" | "supplier";
  existingFiles?: { id: string; originalName: string; mimeType: string }[];
  onUploaded?: () => void;
}

export default function FileUpload({
  invoiceId,
  type,
  existingFiles = [],
  onUploaded,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        if (type === "customer") fd.append("customerInvoiceId", invoiceId);
        else fd.append("supplierInvoiceId", invoiceId);

        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json();
          setError(d.error ?? "Upload failed");
          break;
        }
      }
      onUploaded?.();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div
        className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-brand-400 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? (
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin mx-auto" />
        ) : (
          <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
        )}
        <p className="text-xs text-gray-500 mt-1">
          {uploading ? "Uploading…" : "Drop files here or click to select"}
        </p>
        <p className="text-xs text-gray-400">PDF, JPG, PNG, CSV — max 10MB</p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.csv"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}

      {existingFiles.length > 0 && (
        <div className="mt-3 space-y-1">
          {existingFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm text-gray-600">
              <Paperclip className="w-3.5 h-3.5 text-gray-400" />
              <span className="truncate">{f.originalName}</span>
              <span className="text-gray-400 text-xs">({f.mimeType})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, CheckCircle2, AlertTriangle, Loader2, Mic, Square, Trash2 } from "lucide-react";

const EXCEPTION_REASONS: { value: string; label: string }[] = [
  { value: "CLIENTE_AUSENTE", label: "Cliente ausente" },
  { value: "DIRECCION_INCORRECTA", label: "Dirección incorrecta" },
  { value: "ACCESO_IMPOSIBLE", label: "Acceso imposible" },
  { value: "PRODUCTO_DANADO", label: "Producto dañado" },
  { value: "CLIENTE_RECHAZO", label: "Cliente rechazó" },
  { value: "OTRO", label: "Otro" },
];

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

/** Resizes to a max 2000px edge and re-encodes as JPEG client-side (spec §6) before it ever leaves the phone. */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", JPEG_QUALITY);
  });
}

interface PhotoItem {
  id: string;
  previewUrl: string;
  blob: Blob;
}

export default function DeliveryUploadForm({ token }: { token: string }) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [mode, setMode] = useState<"idle" | "exception">("idle");
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"delivered" | "exception" | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Best-effort, never blocks anything -- spec §1/§2.3: store GPS only if the
  // browser hands it over with permission already granted/grantable.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        /* denied, unavailable, or timed out -- fine, submission never depends on this */
      },
      { timeout: 6000, maximumAge: 60_000 }
    );
  }, []);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setCompressing(true);
    try {
      const newPhotos: PhotoItem[] = [];
      for (const file of Array.from(fileList)) {
        const blob = await compressImage(file);
        newPhotos.push({ id: `${Date.now()}-${Math.random()}`, previewUrl: URL.createObjectURL(blob), blob });
      }
      setPhotos((prev) => [...prev, ...newPhotos]);
    } finally {
      setCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setVoiceBlob(new Blob(recordedChunksRef.current, { type: "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("No se pudo acceder al micrófono.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function submit(outcome: "DELIVERED" | "EXCEPTION") {
    setError("");
    if (outcome === "DELIVERED" && photos.length === 0) {
      setError("Toma al menos una foto para marcar como entregado.");
      return;
    }
    if (outcome === "EXCEPTION" && !exceptionReason) {
      setError("Selecciona un motivo.");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("outcome", outcome);
      photos.forEach((p, i) => fd.append("photos", p.blob, `foto-${i + 1}.jpg`));
      if (outcome === "EXCEPTION") {
        fd.append("exceptionReason", exceptionReason);
        if (exceptionNote.trim()) fd.append("exceptionNote", exceptionNote.trim());
        if (voiceBlob) fd.append("voiceNote", voiceBlob, "nota.webm");
      }
      if (gps) {
        fd.append("gpsLat", String(gps.lat));
        fd.append("gpsLng", String(gps.lng));
      }

      const res = await fetch(`/api/d/${token}`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Ocurrió un error. Intenta de nuevo.");
        setSubmitting(false);
        return;
      }
      setDone(outcome === "DELIVERED" ? "delivered" : "exception");
    } catch {
      setError("Sin conexión. Verifica tu internet e intenta de nuevo.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6 text-center">
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
        <p className="text-lg font-semibold text-gray-900">
          {done === "delivered" ? "¡Entrega registrada!" : "Reporte enviado"}
        </p>
        <p className="text-sm text-gray-500 mt-1">Gracias, ya puedes cerrar esta página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={compressing}
        className="w-full flex items-center justify-center gap-3 bg-brand-600 text-white text-lg font-semibold py-5 rounded-2xl shadow-sm active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {compressing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
        {compressing ? "Procesando foto…" : "Tomar foto"}
      </button>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1"
                aria-label="Quitar foto"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {mode === "idle" && (
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={() => submit("DELIVERED")}
            disabled={submitting || photos.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-green-600 text-white text-lg font-semibold py-5 rounded-2xl shadow-sm disabled:opacity-40 disabled:bg-gray-300 active:scale-[0.98] transition-transform"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Entregado
          </button>
          {photos.length === 0 && <p className="text-center text-xs text-gray-400">Toma una foto para poder marcar como entregado</p>}

          <button
            type="button"
            onClick={() => setMode("exception")}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-white border-2 border-amber-300 text-amber-700 text-base font-semibold py-4 rounded-2xl"
          >
            <AlertTriangle className="w-5 h-5" />
            No se pudo entregar
          </button>
        </div>
      )}

      {mode === "exception" && (
        <div className="bg-white rounded-2xl border border-amber-200 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Motivo *</label>
            <select
              className="w-full border border-gray-300 rounded-xl px-3 py-3 text-base"
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
            >
              <option value="">Selecciona un motivo…</option>
              {EXCEPTION_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota (opcional)</label>
            <textarea
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-base"
              rows={2}
              value={exceptionNote}
              onChange={(e) => setExceptionNote(e.target.value)}
              placeholder="Escribe aquí o graba una nota de voz abajo"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota de voz (opcional)</label>
            {!voiceBlob ? (
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium ${
                  recording ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
                }`}
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {recording ? "Detener grabación" : "Grabar nota de voz"}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <audio src={URL.createObjectURL(voiceBlob)} controls className="flex-1 h-10" />
                <button type="button" onClick={() => setVoiceBlob(null)} className="p-2 text-gray-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="flex-1 bg-gray-100 text-gray-700 font-medium py-3 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => submit("EXCEPTION")}
              disabled={submitting || !exceptionReason}
              className="flex-1 bg-amber-600 text-white font-semibold py-3 rounded-xl disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Enviar reporte"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}
    </div>
  );
}

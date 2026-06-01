"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Users, Target, Clock, TrendingUp } from "lucide-react";
import StatCard from "@/components/StatCard";
import { STATUS_META } from "@/components/LeadStatusBadge";

interface Metrics {
  total: number;
  byStatus: { NEW: number; CONTACTED: number; FOLLOW_UP: number; CLOSED: number; LOST: number };
  conversionRate: number;
  leadsByDay: { date: string; count: number }[];
  leadsBySalesperson: { name: string; count: number; closed: number }[];
  avgResponseMinutes: number | null;
}

function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export default function CrmDashboardPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/crm/metrics?${params}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const statusOrder = ["NEW", "CONTACTED", "FOLLOW_UP", "CLOSED", "LOST"] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel CRM</h1>
          <p className="text-sm text-gray-500 mt-0.5">Resumen de leads y desempeño del equipo</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input text-sm w-40" />
          <span className="text-gray-400">a</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input text-sm w-40" />
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }} className="btn-secondary text-sm py-1.5">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-100" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Tarjetas principales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total de leads" value={data.total} icon={Users} color="blue" isCurrency={false} />
            <StatCard
              label="Tasa de conversión"
              value={`${(data.conversionRate * 100).toFixed(1)}%`}
              icon={Target}
              color="green"
              isCurrency={false}
              subtitle={`${data.byStatus.CLOSED} cerrados`}
            />
            <StatCard
              label="Tiempo de respuesta"
              value={formatResponseTime(data.avgResponseMinutes)}
              icon={Clock}
              color="purple"
              isCurrency={false}
              subtitle="promedio 1ª respuesta"
            />
            <StatCard
              label="En seguimiento"
              value={data.byStatus.FOLLOW_UP + data.byStatus.CONTACTED}
              icon={TrendingUp}
              color="yellow"
              isCurrency={false}
              subtitle={`${data.byStatus.NEW} nuevos`}
            />
          </div>

          {/* Desglose por estado */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {statusOrder.map((s) => (
              <div key={s} className="card text-center py-4">
                <p className="text-2xl font-bold text-gray-900">{data.byStatus[s]}</p>
                <span className={`inline-flex mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_META[s].className}`}>
                  {STATUS_META[s].label}
                </span>
              </div>
            ))}
          </div>

          {/* Leads por día */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Leads por día (últimos 30 días)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.leadsByDay} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0ea5e9" radius={[3, 3, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Leads por vendedora */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Leads por vendedora</h2>
            {data.leadsBySalesperson.length === 0 ? (
              <p className="text-sm text-gray-400">Sin datos en el período seleccionado.</p>
            ) : (
              <div className="space-y-3">
                {data.leadsBySalesperson.map((s) => {
                  const max = Math.max(...data.leadsBySalesperson.map((x) => x.count), 1);
                  return (
                    <div key={s.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700">{s.name}</span>
                        <span className="text-gray-500">
                          {s.count} leads · {s.closed} cerrados
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-500 rounded-full"
                          style={{ width: `${(s.count / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

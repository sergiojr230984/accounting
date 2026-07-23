"use client";

import { useState } from "react";
import { signIn, getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BarChart3,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  LockKeyhole,
  Headset,
  TrendingUp,
  Package,
  Users,
  FileText,
  PieChart,
} from "lucide-react";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
type FormData = z.infer<typeof schema>;

const features = [
  { icon: TrendingUp, label: "Financial Management" },
  { icon: Package, label: "Inventory Control" },
  { icon: Users, label: "Customers & Suppliers" },
  { icon: FileText, label: "Invoicing & Payments" },
  { icon: PieChart, label: "Reports & Analytics" },
];

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    console.log("[login] onSubmit fired", { email: data.email, hasPassword: !!data.password });
    setError("");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
        callbackUrl: `${origin}/dashboard`,
      });
      console.log("[login] signIn result", result);
      if (result?.error) {
        setError(`Sign-in failed: ${result.error}`);
        return;
      }
      // /dashboard is ADMIN-only (company-wide P&L/COGS) -- the API 403s
      // any other role and the page has no graceful fallback for that, so
      // sending every role there unconditionally used to crash the page
      // immediately after login for every non-ADMIN user. Land ADMIN on the
      // dashboard as before; everyone else on Invoices, which every role
      // can actually see.
      const freshSession = await getSession();
      const sessionRole = (freshSession?.user as { role?: string } | undefined)?.role;
      const landingPath = sessionRole === "ADMIN" ? "/dashboard" : "/invoices/customer";
      // Force same-origin navigation — never let a stale NEXTAUTH_URL env var
      // send the browser to localhost or any other host.
      if (typeof window !== "undefined") {
        window.location.href = `${window.location.origin}${landingPath}`;
      } else {
        router.push(landingPath);
      }
    } catch (e) {
      console.error("[login] signIn threw", e);
      setError(`Sign-in error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-50 flex items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* Left column — brand & marketing */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 bg-brand-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="leading-tight">
              <p className="font-extrabold text-xl text-gray-900 tracking-tight">LA CUEVITA</p>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">
                Business Management System
              </p>
            </div>
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight text-gray-900 mb-4">
            Run your business.
            <br />
            <span className="text-brand-600">Not the spreadsheets.</span>
          </h1>
          <p className="text-gray-500 text-base leading-relaxed max-w-md mb-10">
            All-in-one management system for all your businesses. Track finances,
            sales, expenses, inventory, customers and performance in one place.
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-6">
            {features.map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-start gap-2">
                <Icon className="w-5 h-5 text-brand-500" />
                <span className="text-xs font-medium text-gray-600 leading-snug">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column — sign-in card */}
        <div className="w-full max-w-md mx-auto lg:mx-0">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 bg-brand-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Welcome back</h2>
                <p className="text-sm text-gray-500">Sign in to your account</p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                console.log("[login] form submit event fired", {
                  hasErrors: Object.keys(errors).length,
                  errors,
                });
                return handleSubmit(onSubmit)(e);
              }}
              className="space-y-5"
              noValidate
            >
              <div>
                <label className="label" htmlFor="email">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className="input pl-9"
                    placeholder="you@lacuevitabusiness.com"
                    {...register("email")}
                  />
                </div>
                {errors.email && (
                  <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0" htmlFor="password">Password</label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="input pl-9"
                    placeholder="••••••••"
                    {...register("password")}
                  />
                </div>
                {errors.password && (
                  <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
                )}
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-gray-600">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  Remember me
                </label>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full justify-center py-2.5"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">Need help?</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <p className="flex items-center justify-center gap-2 text-sm font-medium text-brand-600">
              <Headset className="w-4 h-4" />
              Contact your administrator
            </p>
          </div>

          <div className="flex items-center justify-center gap-6 mt-6 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Secure. Reliable. Always protected.
            </span>
            <span className="flex items-center gap-1.5">
              <LockKeyhole className="w-3.5 h-3.5" />
              Your data is safe with us.
            </span>
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            © {new Date().getFullYear()} La Cuevita Business Management System
            <br />
            Version {process.env.NEXT_PUBLIC_APP_VERSION ?? "1.5.2"}
          </p>
        </div>
      </div>
    </div>
  );
}

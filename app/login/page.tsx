"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BookOpen,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);
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
      // Force same-origin navigation — never let a stale NEXTAUTH_URL env var
      // send the browser to localhost or any other host.
      if (typeof window !== "undefined") {
        window.location.href = `${window.location.origin}/dashboard`;
      } else {
        router.push("/dashboard");
      }
    } catch (e) {
      console.error("[login] signIn threw", e);
      setError(`Sign-in error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-white rounded-3xl shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 border border-orange-100">
        {/* Left column — brand panel */}
        <div className="bg-gradient-to-br from-brand-700 to-brand-900 text-white p-10 lg:p-12 hidden lg:flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-11 h-11 bg-white rounded-xl flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-brand-600" />
              </div>
              <div className="leading-tight">
                <p className="font-bold text-lg">La Cuevita</p>
                <p className="text-brand-100 text-xs uppercase tracking-wider">Furniture</p>
              </div>
            </div>

            <h1 className="text-3xl font-bold leading-tight mb-3">
              Run the shop, not the spreadsheets.
            </h1>
            <p className="text-brand-100 text-sm mb-10 leading-relaxed">
              Invoices, customers, suppliers, and team performance — all in one
              place built for La Cuevita Furniture.
            </p>

            <ul className="space-y-4 text-sm">
              {[
                "Print invoices with your logo in one click",
                "Track down payments and remaining balances",
                "Commissions and performance per sales rep",
                "Tax rates and credit-card fees configured once",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-brand-200 flex-shrink-0 mt-0.5" />
                  <span className="text-brand-50">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-brand-200 text-xs mt-10">
            v{process.env.NEXT_PUBLIC_APP_VERSION ?? "1.1.0"} · Need help? Talk
            to your administrator.
          </p>
        </div>

        {/* Right column — sign-in form */}
        <div className="p-8 lg:p-12 flex flex-col justify-center">
          {/* Mobile-only brand */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="font-bold text-gray-900">La Cuevita</p>
              <p className="text-gray-500 text-xs uppercase tracking-wider">Furniture</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Sign in</h2>
            <p className="text-sm text-gray-500 mt-1">
              Use the email and password your admin set up for you.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              console.log("[login] form submit event fired", {
                hasErrors: Object.keys(errors).length,
                errors,
              });
              return handleSubmit(onSubmit)(e);
            }}
            className="space-y-4"
            noValidate
          >
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input"
                placeholder="you@lacuevitafurniture.com"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="password">Password</label>
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 mb-1"
                >
                  {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full justify-center py-2.5 mt-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-xs text-gray-400 mt-8 text-center">
            Forgot your password? Ask your administrator to reset it from
            Settings → Users.
          </p>
        </div>
      </div>
    </div>
  );
}

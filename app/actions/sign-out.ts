"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Server action for sign-out. Runs on the server when the form submits —
 * cookies().delete() is the canonical Next.js 15 way to clear cookies
 * server-side, and redirect() handles the navigation internally so no
 * URL-building, proxy headers, or Location response shenanigans needed.
 *
 * Any cookie whose name looks auth-related gets nuked, plus explicit
 * deletes for every NextAuth variant we know about (chunked .0-.4 too).
 */
export async function signOutAction() {
  const store = await cookies();

  // First pass: nuke anything that looks like a session / auth cookie.
  for (const c of store.getAll()) {
    const lower = c.name.toLowerCase();
    if (
      lower.includes("auth") ||
      lower.includes("session") ||
      lower.includes("csrf") ||
      lower.includes("callback")
    ) {
      store.delete(c.name);
    }
  }

  // Second pass: explicit named deletes for every NextAuth cookie variant
  // (in case the first pass missed any because of case sensitivity, etc.).
  const bases = [
    "__Secure-authjs.session-token",
    "authjs.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.session-token",
    "__Secure-authjs.csrf-token",
    "authjs.csrf-token",
    "__Host-authjs.csrf-token",
    "authjs.callback-url",
    "__Secure-authjs.callback-url",
  ];
  for (const base of bases) {
    for (const suffix of ["", ".0", ".1", ".2", ".3", ".4"]) {
      try { store.delete(base + suffix); } catch { /* ignore */ }
    }
  }

  // redirect() throws internally — Next handles the navigation. Always
  // resolves to the user's actual host because Next reads it from the
  // request context, not from request.url.
  redirect("/login");
}

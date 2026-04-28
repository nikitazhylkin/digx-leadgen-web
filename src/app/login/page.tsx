"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-[#00F0F4]">DigX Leads</h1>
        <p className="text-sm text-white/60 mt-1">Sign in to continue</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-3 p-6 rounded-lg bg-[#0F2038] border border-[#00C4C8]/20"
      >
        <div>
          <label htmlFor="email" className="block text-xs text-white/70 mb-1">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md bg-[#0A1628] border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-[#00C4C8]"
            placeholder="you@digx.agency"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-xs text-white/70 mb-1">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md bg-[#0A1628] border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-[#00C4C8]"
          />
        </div>

        {error && (
          <p className="text-xs text-red-400 pt-1">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full h-9 rounded-md bg-[#00C4C8] hover:bg-[#00F0F4] text-[#0A1628] text-sm font-semibold inline-flex items-center justify-center disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </button>
      </form>

      <p className="text-center text-xs text-white/40 mt-4">
        Accounts are provisioned manually. Contact Nikita.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A1628] text-foreground p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

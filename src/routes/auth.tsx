import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff sign-in — Legal Aid Center" },
      { name: "description", content: "Sign in to the Legal Aid Center staff review dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If already signed in, head to /center.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/center" });
    });
  }, [navigate]);

  const signInEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate({ to: "/center" });
  };

  const signInGoogle = async () => {
    setBusy(true);
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/center",
    });
    if (result.redirected) return;
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed");
      return;
    }
    navigate({ to: "/center" });
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Staff sign-in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Legal Aid Center review dashboard
        </p>

        <button
          onClick={signInGoogle}
          disabled={busy}
          className="mt-6 w-full px-4 py-2 rounded-md text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <div className="flex-1 h-px bg-slate-200" />
          or
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <form onSubmit={signInEmail} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full px-4 py-2 rounded-md text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-500">
          Staff accounts are provisioned by an administrator. New sign-ups are
          not accepted here.
        </p>
      </div>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Building2, Loader2, LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nextPath, setNextPath] = useState('/');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedNext = params.get('next');
    setNextPath(requestedNext?.startsWith('/') ? requestedNext : '/');
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsSubmitting(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  };

  return (
    <div className="takeoff-shell takeoff-light-theme min-h-screen bg-[var(--takeoff-paper)] text-[var(--takeoff-ink)]">
      <div className="takeoff-dot-grid flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-[1120px] overflow-hidden rounded-[30px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)] shadow-[0_30px_70px_rgba(31,39,33,0.14)] backdrop-blur-xl">
          <div className="grid min-h-[620px] lg:grid-cols-[0.95fr_1.05fr]">
            <section
              className="relative flex flex-col justify-between overflow-hidden border-b border-[var(--takeoff-line)] bg-[#0e1511] bg-cover bg-center p-8 text-white lg:border-b-0 lg:border-r"
              style={{ backgroundImage: "linear-gradient(180deg, rgba(14, 21, 17, 0.58), rgba(14, 21, 17, 0.92)), url('/auth-login-hero.png')" }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_34%),linear-gradient(90deg,rgba(14,21,17,0.86),rgba(14,21,17,0.34))]" />
              <div className="relative">
                <div className="flex h-[58px] w-[58px] items-center justify-center rounded-[16px] border border-white/15 bg-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.24)] backdrop-blur-md">
                  <Building2 className="h-7 w-7 text-[#dce8d8]" />
                </div>
                <div className="takeoff-label mt-8 text-[10px] font-semibold text-[#aebcaf]">
                  Secure Workspace
                </div>
                <h1 className="mt-3 max-w-sm text-[42px] font-semibold leading-[0.96] tracking-[-0.05em]">
                  Company takeoff and quote workspace
                </h1>
                <p className="mt-5 max-w-sm text-[14px] leading-7 text-[#c5d0c2]">
                  Sign in to manage clients, project files, takeoff workspaces, and quote output.
                </p>
              </div>
              <div className="relative mt-10 grid gap-3 text-[12px] text-[#d9e2d6]">
                <div className="rounded-[18px] border border-white/15 bg-white/[0.08] px-4 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.22)] backdrop-blur-md">
                  Your company profile and quote branding are applied after workspace setup.
                </div>
              </div>
            </section>

            <section className="flex items-center justify-center p-8">
              <form onSubmit={handleSubmit} className="w-full max-w-md">
                <div className="takeoff-label text-[10px] font-semibold text-[var(--takeoff-text-subtle)]">
                  Login
                </div>
                <h2 className="mt-2 text-[34px] font-semibold tracking-[-0.05em] text-[var(--takeoff-ink)]">
                  Access your workspace
                </h2>
                <p className="mt-3 text-[13px] leading-6 text-[var(--takeoff-text-muted)]">
                  Use the account assigned to your company workspace.
                </p>

                {error && (
                  <div className="mt-6 flex gap-3 rounded-[18px] border border-[#efc4c8] bg-[#fff5f5] px-4 py-3 text-[13px] text-[#a3151d]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="mt-7 space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="takeoff-mono text-[11px] text-[var(--takeoff-text-muted)]">
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 rounded-[16px] border-[var(--takeoff-line)] bg-white text-[15px]"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="takeoff-mono mt-7 h-12 w-full rounded-[12px] border border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-[12px] font-semibold text-white hover:bg-[#202621]"
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="mr-2 h-4 w-4" />
                  )}
                  Sign In
                </Button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

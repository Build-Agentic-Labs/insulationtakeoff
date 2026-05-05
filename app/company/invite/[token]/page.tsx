"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export default function CompanyInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Accepting invitation...');

  useEffect(() => {
    const acceptInvitation = async () => {
      const response = await fetch('/api/company/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: params.token }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus('error');
        setMessage(data.error ?? 'Unable to accept invitation.');
        return;
      }

      setStatus('success');
      setMessage('Invitation accepted. You can now access this workspace.');
      router.refresh();
    };

    acceptInvitation();
  }, [params.token, router]);

  return (
    <div className="takeoff-shell takeoff-light-theme min-h-screen bg-[var(--takeoff-paper)] text-[var(--takeoff-ink)]">
      <div className="takeoff-dot-grid flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-[30px] border border-[var(--takeoff-line)] bg-white p-8 text-center shadow-[0_30px_70px_rgba(31,39,33,0.14)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-[var(--takeoff-paper)]">
            {status === 'loading' ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : status === 'success' ? (
              <CheckCircle2 className="h-7 w-7 text-[#47644a]" />
            ) : (
              <AlertCircle className="h-7 w-7 text-[#a3151d]" />
            )}
          </div>
          <h1 className="mt-5 text-[30px] font-semibold tracking-[-0.05em]">
            {status === 'success' ? 'Workspace Joined' : status === 'error' ? 'Invite Issue' : 'Joining Workspace'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--takeoff-text-muted)]">{message}</p>
          <Button
            className="ev-primary-action mt-7 w-full"
            onClick={() => router.replace(status === 'success' ? '/' : '/login')}
          >
            {status === 'success' ? 'Go to Dashboard' : 'Go to Login'}
          </Button>
        </div>
      </div>
    </div>
  );
}

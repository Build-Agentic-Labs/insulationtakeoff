"use client";

import { useMemo, useState } from 'react';
import { Loader2, MailWarning, MessageSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SupportMessage, SupportTicket } from './SupportQueue';

interface SupportThreadProps {
  ticket: SupportTicket;
  viewerRole: 'customer' | 'support';
  onTicketUpdated: (ticket: SupportTicket) => void;
}

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getMessageLabel(message: SupportMessage, viewerRole: 'customer' | 'support') {
  if (message.author_role === 'system') return 'System';
  if (message.author_role === viewerRole) return 'You';
  return message.author_role === 'support' ? 'Support' : 'Customer';
}

function getMessageSourceLabel(message: SupportMessage) {
  return message.source === 'email' ? 'Email reply' : 'App reply';
}

export function SupportThread({ ticket, viewerRole, onTicketUpdated }: SupportThreadProps) {
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messages = useMemo(() => {
    const ticketMessages = ticket.messages ?? [];
    const sortedMessages = [...ticketMessages].sort((a, b) => (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ));

    if (sortedMessages.length > 0) return sortedMessages;

    return [{
      id: `${ticket.id}-initial`,
      ticket_id: ticket.id,
      company_id: '',
      author_user_id: null,
      author_email: ticket.submitter_email,
      author_role: 'customer' as const,
      body: ticket.message,
      source: 'app' as const,
      inbound_email_id: null,
      inbound_message_id: null,
      outbound_email_id: null,
      notification_status: ticket.notification_status,
      notification_error: ticket.notification_error,
      notified_at: null,
      created_at: ticket.created_at,
    }];
  }, [ticket]);

  const sendReply = async () => {
    const body = reply.trim();

    if (!body) {
      setError('Add a reply before sending.');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/support/tickets/${ticket.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: body,
          authorRole: viewerRole,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to send support reply.');
      }

      setReply('');
      onTicketUpdated(data.ticket);
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Failed to send support reply.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="rounded-[16px] border border-[var(--takeoff-line)] bg-white p-4">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--takeoff-line)] pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[var(--takeoff-paper)]">
            <MessageSquare className="h-4 w-4 text-[var(--takeoff-ink)]" />
          </span>
          <div>
            <div className="ev-label">Conversation</div>
            <div className="mt-1 text-sm font-semibold text-[var(--takeoff-ink)]">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="takeoff-mono text-xs text-[var(--takeoff-text-muted)]">
          Oldest first
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {messages.map((message) => {
          const isOwnMessage = message.author_role === viewerRole;

          return (
            <div
              key={message.id}
              className={cn(
                "rounded-[14px] border px-4 py-3",
                isOwnMessage
                  ? "border-[rgba(110,139,94,0.24)] bg-[rgba(110,139,94,0.1)]"
                  : "border-[var(--takeoff-line)] bg-white"
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--takeoff-ink)]">
                    {getMessageLabel(message, viewerRole)}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--takeoff-text-muted)]">
                    {message.author_email}
                  </div>
                </div>
                <div className="shrink-0 rounded-full border border-[var(--takeoff-line)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase text-[var(--takeoff-text-muted)]">
                  {getMessageSourceLabel(message)}
                </div>
              </div>
              <div className="mt-3 whitespace-pre-wrap rounded-[12px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.62)] px-3 py-3 text-sm leading-6 text-[var(--takeoff-ink)]">
                {message.body}
              </div>
              <div className="mt-2 text-xs text-[var(--takeoff-text-muted)]">
                {formatDate(message.created_at)}
              </div>
              {message.notification_status === 'failed' ? (
                <div className="mt-3 rounded-[12px] border border-[rgba(215,25,33,0.22)] bg-[rgba(215,25,33,0.08)] px-3 py-2 text-xs leading-5 text-[var(--takeoff-accent)]">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <MailWarning className="h-4 w-4" />
                    Email notification failed
                  </div>
                  {message.notification_error ?? 'The message was saved, but the email notification could not be sent.'}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-[12px] border border-[rgba(215,25,33,0.24)] bg-[rgba(215,25,33,0.08)] px-4 py-3 text-sm text-[var(--takeoff-accent)]">
          {error}
        </div>
      ) : null}

      <div className="mt-4 rounded-[14px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] p-3">
        <div className="mb-2 text-xs font-semibold text-[var(--takeoff-text-muted)]">Reply</div>
        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder={viewerRole === 'support' ? 'Reply to the customer...' : 'Reply to support...'}
          maxLength={5000}
          disabled={isSending}
          className="min-h-28 w-full resize-y rounded-[12px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)] px-3 py-3 text-sm leading-6 text-[var(--takeoff-ink)] placeholder:text-[var(--takeoff-text-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--takeoff-ink)]/10 disabled:opacity-50"
        />
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={sendReply} disabled={isSending || reply.trim().length === 0}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

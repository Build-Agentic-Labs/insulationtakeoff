"use client";

import { useMemo, useState } from 'react';
import { ExternalLink, ImageIcon, Inbox, Loader2, MailWarning, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SupportStatus = 'open' | 'in_progress' | 'resolved';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface SupportAttachment {
  id: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  submitter_email: string;
  subject: string;
  message: string;
  page_url: string | null;
  browser_info: unknown;
  status: SupportStatus;
  notification_status: NotificationStatus;
  notification_error: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  project: {
    id: string;
    name: string;
  } | null;
  attachments: SupportAttachment[];
}

interface SupportQueueProps {
  initialTickets: SupportTicket[];
  initialSelectedTicketId?: string | null;
}

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusClass(status: SupportStatus) {
  switch (status) {
    case 'resolved':
      return 'border-[rgba(110,139,94,0.24)] bg-[rgba(110,139,94,0.12)] text-[#48613d]';
    case 'in_progress':
      return 'border-[rgba(183,121,31,0.24)] bg-[rgba(183,121,31,0.12)] text-[#8e621b]';
    default:
      return 'border-[rgba(20,24,20,0.12)] bg-white text-[var(--takeoff-ink)]';
  }
}

function notificationClass(status: NotificationStatus) {
  if (status === 'failed') {
    return 'border-[rgba(215,25,33,0.22)] bg-[rgba(215,25,33,0.08)] text-[var(--takeoff-accent)]';
  }

  if (status === 'sent') {
    return 'border-[rgba(110,139,94,0.24)] bg-[rgba(110,139,94,0.12)] text-[#48613d]';
  }

  return 'border-[rgba(20,24,20,0.12)] bg-white text-[var(--takeoff-text-muted)]';
}

function attachmentUrl(path: string) {
  return `/api/storage/file?path=${encodeURIComponent(path)}`;
}

export function SupportQueue({ initialTickets, initialSelectedTicketId }: SupportQueueProps) {
  const [tickets, setTickets] = useState(initialTickets);
  const [activeStatus, setActiveStatus] = useState<SupportStatus | 'all'>('all');
  const [selectedTicketId, setSelectedTicketId] = useState(
    initialSelectedTicketId && initialTickets.some((ticket) => ticket.id === initialSelectedTicketId)
      ? initialSelectedTicketId
      : initialTickets[0]?.id ?? null
  );
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredTickets = useMemo(() => {
    if (activeStatus === 'all') return tickets;
    return tickets.filter((ticket) => ticket.status === activeStatus);
  }, [activeStatus, tickets]);

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) ?? filteredTickets[0] ?? null;

  const counts = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
  }), [tickets]);

  const refreshTickets = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch('/api/support/tickets');
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to refresh support tickets.');
      }

      setTickets(data.tickets ?? []);
      if (selectedTicketId && !data.tickets?.some((ticket: SupportTicket) => ticket.id === selectedTicketId)) {
        setSelectedTicketId(data.tickets?.[0]?.id ?? null);
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh support tickets.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateStatus = async (ticketId: string, status: SupportStatus) => {
    setUpdatingTicketId(ticketId);
    setError(null);

    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to update support ticket.');
      }

      setTickets((current) => current.map((ticket) => (
        ticket.id === ticketId ? data.ticket : ticket
      )));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update support ticket.');
    } finally {
      setUpdatingTicketId(null);
    }
  };

  return (
    <div className="ev-page min-h-screen">
      <div className="ev-page-grid min-h-screen">
        <div className="ev-container space-y-6">
          <header className="flex flex-col gap-4 border-b border-[var(--takeoff-line)] pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="ev-label">Workspace support</div>
              <h1 className="ev-title mt-2 text-4xl">Support Inbox</h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--takeoff-text-muted)]">
                Review customer questions, screenshots, page context, and email notification state.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={refreshTickets} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </header>

          {error ? (
            <div className="rounded-[12px] border border-[rgba(215,25,33,0.24)] bg-[rgba(215,25,33,0.08)] px-4 py-3 text-sm text-[var(--takeoff-accent)]">
              {error}
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
            <section className="rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.88)]">
              <div className="flex flex-wrap gap-2 border-b border-[var(--takeoff-line)] p-3">
                {(['all', 'open', 'in_progress', 'resolved'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setActiveStatus(status)}
                    className={cn(
                      "rounded-[12px] border px-3 py-1.5 text-xs font-semibold transition-colors",
                      activeStatus === status
                        ? "border-[var(--takeoff-ink)] bg-[var(--takeoff-ink)] text-white"
                        : "border-[var(--takeoff-line)] bg-white text-[var(--takeoff-text-muted)] hover:text-[var(--takeoff-ink)]"
                    )}
                  >
                    {status === 'all' ? 'All' : STATUS_LABELS[status]} {counts[status]}
                  </button>
                ))}
              </div>

              <div className="max-h-[68vh] overflow-y-auto">
                {filteredTickets.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center text-[var(--takeoff-text-muted)]">
                    <Inbox className="mb-3 h-8 w-8" />
                    <div className="font-semibold text-[var(--takeoff-ink)]">No tickets</div>
                    <div className="mt-1 text-sm">There are no support requests in this status.</div>
                  </div>
                ) : (
                  filteredTickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={cn(
                        "block w-full border-b border-[var(--takeoff-line)] px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-[var(--takeoff-paper)]",
                        selectedTicket?.id === ticket.id && "bg-[var(--takeoff-paper)]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--takeoff-ink)]">{ticket.subject}</div>
                          <div className="mt-1 truncate text-xs text-[var(--takeoff-text-muted)]">
                            {ticket.submitter_email}
                          </div>
                        </div>
                        <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase", statusClass(ticket.status))}>
                          {STATUS_LABELS[ticket.status]}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-[var(--takeoff-text-muted)]">
                        <span>{formatDate(ticket.created_at)}</span>
                        <span>{ticket.attachments.length} image{ticket.attachments.length === 1 ? '' : 's'}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="min-h-[68vh] rounded-[18px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.9)]">
              {selectedTicket ? (
                <div className="flex min-h-full flex-col">
                  <div className="border-b border-[var(--takeoff-line)] px-5 py-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-2 py-1 text-[10px] font-bold uppercase", statusClass(selectedTicket.status))}>
                            {STATUS_LABELS[selectedTicket.status]}
                          </span>
                          <span className={cn("rounded-full border px-2 py-1 text-[10px] font-bold uppercase", notificationClass(selectedTicket.notification_status))}>
                            Email {selectedTicket.notification_status}
                          </span>
                        </div>
                        <h2 className="mt-3 break-words text-2xl font-semibold tracking-[-0.03em] text-[var(--takeoff-ink)]">
                          {selectedTicket.subject}
                        </h2>
                        <div className="mt-2 text-sm text-[var(--takeoff-text-muted)]">
                          {selectedTicket.submitter_email} · {formatDate(selectedTicket.created_at)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['open', 'in_progress', 'resolved'] as SupportStatus[]).map((status) => (
                          <Button
                            key={status}
                            type="button"
                            variant={selectedTicket.status === status ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => updateStatus(selectedTicket.id, status)}
                            disabled={updatingTicketId === selectedTicket.id || selectedTicket.status === status}
                          >
                            {updatingTicketId === selectedTicket.id && selectedTicket.status !== status ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            {STATUS_LABELS[status]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid flex-1 gap-5 p-5 lg:grid-cols-[1fr_280px]">
                    <div className="space-y-5">
                      <div>
                        <div className="ev-label">Question</div>
                        <div className="mt-2 whitespace-pre-wrap rounded-[14px] border border-[var(--takeoff-line)] bg-white px-4 py-4 text-sm leading-6 text-[var(--takeoff-ink)]">
                          {selectedTicket.message}
                        </div>
                      </div>

                      <div>
                        <div className="ev-label">Screenshots</div>
                        {selectedTicket.attachments.length > 0 ? (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {selectedTicket.attachments.map((attachment) => (
                              <a
                                key={attachment.id}
                                href={attachmentUrl(attachment.storage_path)}
                                target="_blank"
                                rel="noreferrer"
                                className="group rounded-[14px] border border-[var(--takeoff-line)] bg-white p-3 transition-colors hover:border-[var(--takeoff-line-strong)]"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--takeoff-line)] bg-[var(--takeoff-paper)]">
                                    <ImageIcon className="h-5 w-5 text-[var(--takeoff-text-muted)]" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-[var(--takeoff-ink)] group-hover:underline">
                                      {attachment.file_name}
                                    </div>
                                    <div className="mt-0.5 text-xs text-[var(--takeoff-text-muted)]">
                                      {formatFileSize(attachment.file_size)}
                                    </div>
                                  </div>
                                  <ExternalLink className="h-4 w-4 text-[var(--takeoff-text-muted)]" />
                                </div>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 rounded-[14px] border border-[var(--takeoff-line)] bg-white px-4 py-4 text-sm text-[var(--takeoff-text-muted)]">
                            No screenshots attached.
                          </div>
                        )}
                      </div>
                    </div>

                    <aside className="space-y-4 rounded-[14px] border border-[var(--takeoff-line)] bg-white p-4">
                      <div>
                        <div className="ev-label">Project</div>
                        <div className="mt-1 text-sm text-[var(--takeoff-ink)]">
                          {selectedTicket.project?.name ?? 'No project context'}
                        </div>
                      </div>
                      <div>
                        <div className="ev-label">Page</div>
                        {selectedTicket.page_url ? (
                          <a
                            href={selectedTicket.page_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block break-all text-sm text-[var(--takeoff-ink)] underline-offset-4 hover:underline"
                          >
                            {selectedTicket.page_url}
                          </a>
                        ) : (
                          <div className="mt-1 text-sm text-[var(--takeoff-text-muted)]">No page URL</div>
                        )}
                      </div>
                      <div>
                        <div className="ev-label">Updated</div>
                        <div className="mt-1 text-sm text-[var(--takeoff-ink)]">{formatDate(selectedTicket.updated_at)}</div>
                      </div>
                      {selectedTicket.resolved_at ? (
                        <div>
                          <div className="ev-label">Resolved</div>
                          <div className="mt-1 text-sm text-[var(--takeoff-ink)]">{formatDate(selectedTicket.resolved_at)}</div>
                        </div>
                      ) : null}
                      {selectedTicket.notification_status === 'failed' ? (
                        <div className="rounded-[12px] border border-[rgba(215,25,33,0.22)] bg-[rgba(215,25,33,0.08)] p-3 text-xs leading-5 text-[var(--takeoff-accent)]">
                          <div className="mb-1 flex items-center gap-2 font-semibold">
                            <MailWarning className="h-4 w-4" />
                            Email failed
                          </div>
                          {selectedTicket.notification_error ?? 'Support email could not be sent.'}
                        </div>
                      ) : null}
                    </aside>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[68vh] flex-col items-center justify-center px-6 text-center text-[var(--takeoff-text-muted)]">
                  <Inbox className="mb-3 h-8 w-8" />
                  <div className="font-semibold text-[var(--takeoff-ink)]">No support ticket selected</div>
                  <div className="mt-1 text-sm">Select a request from the queue.</div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { MySupportTickets } from '@/components/support/MySupportTickets';
import type { SupportTicket } from '@/components/support/SupportQueue';
import { requireServerCompanyMembership } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { SUPPORT_TICKET_WITH_THREAD_SELECT } from '@/lib/support/tickets';

export const dynamic = 'force-dynamic';

export default async function MySupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  let companyId: string;
  let userId: string;

  try {
    const membership = await requireServerCompanyMembership();
    companyId = membership.companyId;
    userId = membership.user.id;
  } catch {
    notFound();
  }

  const { ticket: selectedTicketId } = await searchParams;
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(SUPPORT_TICKET_WITH_THREAD_SELECT)
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('My support tickets page load error:', error);
    throw new Error('Failed to load your support tickets');
  }

  return (
    <MySupportTickets
      initialTickets={(data ?? []) as SupportTicket[]}
      initialSelectedTicketId={selectedTicketId ?? null}
    />
  );
}

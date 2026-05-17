import { notFound } from 'next/navigation';
import { SupportQueue, type SupportTicket } from '@/components/support/SupportQueue';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerSupportAdmin } from '@/lib/support/admin-access-server';
import { SUPPORT_TICKET_WITH_THREAD_SELECT } from '@/lib/support/tickets';

export const dynamic = 'force-dynamic';

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  let companyId: string;

  try {
    const membership = await requireServerSupportAdmin();
    companyId = membership.companyId;
  } catch {
    notFound();
  }

  const { ticket: selectedTicketId } = await searchParams;
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(SUPPORT_TICKET_WITH_THREAD_SELECT)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Support page load error:', error);
    throw new Error('Failed to load support inbox');
  }

  return (
    <SupportQueue
      initialTickets={(data ?? []) as SupportTicket[]}
      initialSelectedTicketId={selectedTicketId ?? null}
    />
  );
}

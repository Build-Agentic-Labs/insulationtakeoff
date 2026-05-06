import { notFound } from 'next/navigation';
import { SupportQueue, type SupportTicket } from '@/components/support/SupportQueue';
import { requireServerCompanyAdmin } from '@/lib/supabase/company-server';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  let companyId: string;

  try {
    const membership = await requireServerCompanyAdmin();
    companyId = membership.companyId;
  } catch {
    notFound();
  }

  const { ticket: selectedTicketId } = await searchParams;
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(`
      *,
      project:projects(id, name),
      attachments:support_ticket_attachments(*)
    `)
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

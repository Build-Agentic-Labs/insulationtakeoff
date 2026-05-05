import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { createServerSupabaseClient } from '@/lib/supabase/session';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const token = String(body.token ?? '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Invitation token is required.' }, { status: 400 });
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('company_invitations')
      .select('id, company_id, email, role, expires_at, accepted_at')
      .eq('token', token)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
    }

    if (invitation.accepted_at) {
      return NextResponse.json({ error: 'Invitation has already been accepted.' }, { status: 400 });
    }

    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Invitation has expired.' }, { status: 400 });
    }

    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json({ error: 'Sign in with the invited email address to accept this invitation.' }, { status: 403 });
    }

    const { error: memberError } = await supabaseAdmin
      .from('company_members')
      .upsert(
        {
          company_id: invitation.company_id,
          user_id: user.id,
          role: invitation.role,
        },
        { onConflict: 'company_id,user_id' }
      );

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const { error: acceptError } = await supabaseAdmin
      .from('company_invitations')
      .update({
        accepted_by: user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (acceptError) {
      return NextResponse.json({ error: acceptError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Unable to accept invitation.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/server';
import { requireServerCompanyAdmin, requireServerCompanyMembership } from '@/lib/supabase/company-server';
import { AuthRequiredError, CompanyRoleRequiredError } from '@/lib/supabase/company';

type TeamRole = 'owner' | 'admin' | 'member';
type InviteRole = 'admin' | 'member';

function normalizeEmail(email: unknown) {
  return String(email ?? '').trim().toLowerCase();
}

function isInviteRole(role: unknown): role is InviteRole {
  return role === 'admin' || role === 'member';
}

function isAuthUserConfirmed(user: User) {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

async function findAuthUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const perPage = 100;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) return { user: null, error };

    const user = data.users.find((candidate) => normalizeEmail(candidate.email) === normalizedEmail);
    if (user) return { user, error: null };

    if (data.users.length < perPage) break;
  }

  return { user: null, error: null };
}

function teamErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof CompanyRoleRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function getUserEmails(userIds: string[]) {
  const emailById = new Map<string, string | null>();
  const uniqueUserIds = Array.from(new Set(userIds));

  await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      emailById.set(userId, data.user?.email ?? null);
    })
  );

  return emailById;
}

export async function GET() {
  try {
    const { companyId } = await requireServerCompanyMembership();

    const { data: members, error: membersError } = await supabaseAdmin
      .from('company_members')
      .select('id, user_id, role, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (membersError) {
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    const emailById = await getUserEmails((members ?? []).map((member) => member.user_id));

    const { data: invitations, error: invitationsError } = await supabaseAdmin
      .from('company_invitations')
      .select('id, email, role, token, expires_at, created_at')
      .eq('company_id', companyId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (invitationsError) {
      return NextResponse.json({ error: invitationsError.message }, { status: 500 });
    }

    return NextResponse.json({
      members: (members ?? []).map((member) => ({
        ...member,
        email: emailById.get(member.user_id) ?? 'Workspace user',
      })),
      invitations: invitations ?? [],
    });
  } catch (error) {
    return teamErrorResponse(error, 'Unable to load team');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await requireServerCompanyAdmin();
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const role = isInviteRole(body.role) ? body.role : 'member';

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }

    const { user: authUser, error: authUserError } = await findAuthUserByEmail(email);

    if (authUserError) {
      return NextResponse.json({ error: authUserError.message }, { status: 500 });
    }

    if (!authUser) {
      return NextResponse.json(
        { error: 'Create this user in Supabase Auth first, then add them to the workspace.' },
        { status: 404 }
      );
    }

    const { data: existingMember, error: existingMemberError } = await supabaseAdmin
      .from('company_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (existingMemberError) {
      return NextResponse.json({ error: existingMemberError.message }, { status: 500 });
    }

    if (existingMember) {
      return NextResponse.json({ error: 'This user is already a workspace member.' }, { status: 409 });
    }

    const { data: member, error: memberError } = await supabaseAdmin
      .from('company_members')
      .insert({
        company_id: companyId,
        user_id: authUser.id,
        role,
      })
      .select('id, user_id, role, created_at')
      .single();

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('company_invitations')
      .delete()
      .eq('company_id', companyId)
      .ilike('email', email)
      .is('accepted_at', null);

    return NextResponse.json({
      member: {
        ...member,
        email: authUser.email ?? email,
      },
      memberAdded: true,
      requiresConfirmation: !isAuthUserConfirmed(authUser),
    });
  } catch (error) {
    return teamErrorResponse(error, 'Unable to add workspace user');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { companyId, user } = await requireServerCompanyAdmin();
    const body = await request.json();
    const memberId = String(body.memberId ?? '');
    const role = body.role as TeamRole;

    if (!memberId || !['owner', 'admin', 'member'].includes(role)) {
      return NextResponse.json({ error: 'Valid member and role are required.' }, { status: 400 });
    }

    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('company_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('company_id', companyId)
      .single();

    if (targetError || !targetMember) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    if (targetMember.user_id === user.id && targetMember.role === 'owner' && role !== 'owner') {
      return NextResponse.json({ error: 'Owners cannot demote themselves.' }, { status: 400 });
    }

    if (targetMember.role === 'owner' && role !== 'owner') {
      const { count } = await supabaseAdmin
        .from('company_members')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('role', 'owner');

      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'A workspace must keep at least one owner.' }, { status: 400 });
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('company_members')
      .update({ role })
      .eq('id', memberId)
      .eq('company_id', companyId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return teamErrorResponse(error, 'Unable to update member');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { companyId, user } = await requireServerCompanyAdmin();
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');
    const invitationId = searchParams.get('invitationId');

    if (invitationId) {
      const { error } = await supabaseAdmin
        .from('company_invitations')
        .delete()
        .eq('id', invitationId)
        .eq('company_id', companyId)
        .is('accepted_at', null);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    if (!memberId) {
      return NextResponse.json({ error: 'Member or invitation id is required.' }, { status: 400 });
    }

    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('company_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('company_id', companyId)
      .single();

    if (targetError || !targetMember) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    if (targetMember.user_id === user.id) {
      return NextResponse.json({ error: 'You cannot remove yourself from the workspace.' }, { status: 400 });
    }

    if (targetMember.role === 'owner') {
      const { count } = await supabaseAdmin
        .from('company_members')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('role', 'owner');

      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'A workspace must keep at least one owner.' }, { status: 400 });
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from('company_members')
      .delete()
      .eq('id', memberId)
      .eq('company_id', companyId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return teamErrorResponse(error, 'Unable to remove team entry');
  }
}

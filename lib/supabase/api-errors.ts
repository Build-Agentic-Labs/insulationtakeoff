import { NextResponse } from 'next/server';
import { AuthRequiredError, CompanyRequiredError, CompanyRoleRequiredError } from './company';

export function authApiErrorResponse(error: unknown, fallback = 'Internal server error') {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof CompanyRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof CompanyRoleRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}

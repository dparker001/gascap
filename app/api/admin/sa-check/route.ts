// Temporary debug route — returns only the service account email (not the private key)
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const pw = req.nextUrl.searchParams.get('pw') ?? '';
  if (pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY not set' });
  try {
    const { client_email, project_id } = JSON.parse(raw);
    return NextResponse.json({ client_email, project_id });
  } catch {
    return NextResponse.json({ error: 'Failed to parse key' });
  }
}

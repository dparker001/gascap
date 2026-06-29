import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSmartcarConfigDiag } from '@/lib/smartcar';

// TEMPORARY diagnostic endpoint — remove after Smartcar credential issue is resolved
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(getSmartcarConfigDiag());
}

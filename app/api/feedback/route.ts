import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendMail } from '@/lib/email';

export async function POST(req: Request) {
  const { message, page, email } = await req.json() as {
    message?: string;
    page?:    string;
    email?:   string;
  };

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const from    = session?.user?.email ?? email ?? 'Anonymous';
  const name    = session?.user?.name  ?? 'Beta Tester';

  try {
    await sendMail({
      to:      'hello@gascap.app',
      subject: `[GasCap™ Feedback] from ${name}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1e2d4a;padding:20px 24px;border-radius:12px 12px 0 0;">
            <span style="color:#fff;font-size:18px;font-weight:900;">GasCap™ Beta Feedback</span>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
            <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">From</p>
            <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1e293b;">${name} &lt;${from}&gt;</p>
            <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Page</p>
            <p style="margin:0 0 16px;font-size:14px;color:#475569;font-family:monospace;">${page ?? 'unknown'}</p>
            <p style="margin:0 0 4px;font-size:13px;color:#94a3b8;">Message</p>
            <p style="margin:0;font-size:15px;color:#1e293b;white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;">${message.trim()}</p>
          </div>
        </div>
      `,
      text: `GasCap Feedback\nFrom: ${name} <${from}>\nPage: ${page ?? 'unknown'}\n\n${message.trim()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[GasCap] Feedback send failed:', err);
    return NextResponse.json({ error: 'Failed to send feedback.' }, { status: 500 });
  }
}

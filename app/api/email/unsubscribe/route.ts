/**
 * GET /api/email/unsubscribe?id=USER_ID
 * One-click unsubscribe from GasCap marketing emails.
 */
import { NextResponse } from 'next/server';
import { findById, optOutEmailCampaign } from '@/lib/users';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return new NextResponse(unsubPage('Invalid link', 'This unsubscribe link is missing a user ID.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const user = findById(id);
  if (!user) {
    return new NextResponse(unsubPage('Already removed', "You've been removed from our mailing list."), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  optOutEmailCampaign(id);

  return new NextResponse(unsubPage('Unsubscribed', `${user.name}, you've been removed from GasCap marketing emails. You'll still receive account-critical emails (password reset, billing receipts).`), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function unsubPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — GasCap™</title>
</head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:440px;width:100%;margin:40px 16px;background:#fff;border-radius:20px;
              box-shadow:0 2px 20px rgba(0,0,0,.08);overflow:hidden;text-align:center;">
    <div style="background:#1e2d4a;padding:24px 32px;">
      <span style="color:#fff;font-size:20px;font-weight:900;">
        GasCap<sup style="color:#f59e0b;font-size:11px;">™</sup>
      </span>
    </div>
    <div style="padding:40px 32px;">
      <p style="font-size:40px;margin:0 0 16px;">✓</p>
      <p style="font-size:20px;font-weight:900;color:#1e2d4a;margin:0 0 12px;">${title}</p>
      <p style="font-size:15px;color:#64748b;line-height:1.6;margin:0 0 28px;">${message}</p>
      <a href="https://www.gascap.app"
         style="display:inline-block;background:#f59e0b;color:#fff;font-weight:900;
                font-size:15px;padding:13px 28px;border-radius:12px;text-decoration:none;">
        Back to GasCap →
      </a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Server-side OneSignal REST API helper.
 * Used by /api/push/* routes to send notifications.
 */

const OS_API = 'https://onesignal.com/api/v1/notifications';

interface SendOptions {
  title:       string;
  body:        string;
  url?:        string;
  /** If provided, sends only to these external user IDs. Otherwise sends to all subscribers. */
  externalIds?: string[];
}

export async function sendPushNotification({
  title,
  body,
  url = '/',
  externalIds,
}: SendOptions): Promise<{ recipients?: number; errors?: unknown }> {
  const appId  = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    console.warn('[OneSignal] Missing NEXT_PUBLIC_ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY');
    return { errors: 'OneSignal not configured' };
  }

  const webUrl = url.startsWith('http') ? url : `https://gascap.app${url}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    app_id:   appId,
    headings: { en: title },
    contents: { en: body },
    url:      webUrl,
    web_url:  webUrl,
    chrome_web_icon: 'https://gascap.app/icon-192.png',
    firefox_icon:    'https://gascap.app/icon-192.png',
  };

  if (externalIds && externalIds.length > 0) {
    // Target specific users by their external ID (set via OneSignal.login())
    payload.include_aliases   = { external_id: externalIds };
    payload.target_channel    = 'push';
  } else {
    // Broadcast to all subscribed users
    payload.included_segments = ['Subscribed Users'];
  }

  try {
    const res  = await fetch(OS_API, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json() as { recipients?: number; errors?: unknown };
    if (!res.ok) {
      console.error('[OneSignal] Send error:', data);
    }
    return data;
  } catch (err) {
    console.error('[OneSignal] Network error:', err);
    return { errors: String(err) };
  }
}

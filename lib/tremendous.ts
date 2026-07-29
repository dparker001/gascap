/**
 * Tremendous gift-card delivery — shared by the admin manual-confirm route
 * and the public winner self-serve claim route. Pure API call, no DB writes;
 * callers are responsible for marking the draw claimed once this returns sent.
 */
export interface TremendousResult {
  configured: boolean;
  sent:       boolean;
  orderId?:   string;
  error?:     string;
}

export async function sendTremendousCard(
  recipientName: string,
  recipientEmail: string,
  prize: string, // e.g. "$50"
): Promise<TremendousResult> {
  const tremendousKey        = process.env.TREMENDOUS_API_KEY;
  const tremendousCampaignId = process.env.TREMENDOUS_CAMPAIGN_ID;
  const configured           = Boolean(tremendousKey && tremendousCampaignId);

  if (!configured) {
    return { configured: false, sent: false, error: 'TREMENDOUS_API_KEY or TREMENDOUS_CAMPAIGN_ID not configured' };
  }

  const denomination = parseFloat(prize.replace(/[^0-9.]/g, ''));
  if (isNaN(denomination) || denomination <= 0) {
    return { configured: true, sent: false, error: `Could not parse prize amount: ${prize}` };
  }

  try {
    const tRes = await fetch('https://www.tremendous.com/api/v2/orders', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${tremendousKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        payment: { funding_source_id: 'BALANCE' },
        rewards: [{
          campaign_id: tremendousCampaignId,
          recipient:   { name: recipientName, email: recipientEmail },
          value:       { denomination, currency_code: 'USD' },
        }],
      }),
    });

    if (!tRes.ok) {
      const errText = await tRes.text();
      return { configured: true, sent: false, error: `Tremendous API ${tRes.status}: ${errText}` };
    }

    const tData = await tRes.json() as { order?: { id?: string } };
    return { configured: true, sent: true, orderId: tData.order?.id };
  } catch (err) {
    return { configured: true, sent: false, error: String(err) };
  }
}

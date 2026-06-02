/**
 * Gift store — backed by Railway PostgreSQL via Prisma.
 * Handles gift purchases (Pro Lifetime gifted to a recipient) and redemption.
 */
import { prisma } from './prisma';
import type { Gift as PrismaGift } from './generated/prisma/client';

export type GiftOccasion = 'gift' | 'fathers-day' | 'birthday' | 'holiday';
export type GiftStatus   = 'paid' | 'redeemed' | 'refunded';

export interface StoredGift {
  id:                 string;
  code:               string;
  occasion:           string;
  plan:               string;
  interval:           string;
  amountPaid:         number;
  purchaserEmail:     string;
  purchaserUserId:    string | null;
  recipientEmail:     string | null;
  recipientName:      string | null;
  giftMessage:        string | null;
  deliverToRecipient: boolean;
  stripeSessionId:    string | null;
  stripePaymentId:    string | null;
  status:             string;
  redeemedByUserId:   string | null;
  redeemedAt:         string | null;
  createdAt:          string;
}

function toStoredGift(g: PrismaGift): StoredGift {
  return {
    id:                 g.id,
    code:               g.code,
    occasion:           g.occasion,
    plan:               g.plan,
    interval:           g.interval,
    amountPaid:         g.amountPaid,
    purchaserEmail:     g.purchaserEmail,
    purchaserUserId:    g.purchaserUserId,
    recipientEmail:     g.recipientEmail,
    recipientName:      g.recipientName,
    giftMessage:        g.giftMessage,
    deliverToRecipient: g.deliverToRecipient,
    stripeSessionId:    g.stripeSessionId,
    stripePaymentId:    g.stripePaymentId,
    status:             g.status,
    redeemedByUserId:   g.redeemedByUserId,
    redeemedAt:         g.redeemedAt,
    createdAt:          g.createdAt,
  };
}

/**
 * Generate a human-friendly redemption code, e.g. "GASCAP-7K2P-9QX4".
 * Excludes ambiguous chars (0/O, 1/I/L) for easier reading/typing.
 */
export function generateGiftCode(): string {
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () =>
      ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join('');
  return `GASCAP-${block()}-${block()}`;
}

export interface CreateGiftInput {
  occasion?:           string;
  amountPaid:          number;
  purchaserEmail:      string;
  purchaserUserId?:    string | null;
  recipientEmail?:     string | null;
  recipientName?:      string | null;
  giftMessage?:        string | null;
  deliverToRecipient?: boolean;
  stripeSessionId?:    string | null;
  stripePaymentId?:    string | null;
}

/** Create a paid gift, generating a unique code (retries on collision). */
export async function createGift(input: CreateGiftInput): Promise<StoredGift> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGiftCode();
    const existing = await prisma.gift.findUnique({ where: { code } });
    if (existing) continue;
    const gift = await prisma.gift.create({
      data: {
        id:                 `gift_${crypto.randomUUID()}`,
        code,
        occasion:           input.occasion           ?? 'gift',
        plan:               'pro',
        interval:           'lifetime',
        amountPaid:         input.amountPaid,
        purchaserEmail:     input.purchaserEmail.toLowerCase().trim(),
        purchaserUserId:    input.purchaserUserId    ?? null,
        recipientEmail:     input.recipientEmail ? input.recipientEmail.toLowerCase().trim() : null,
        recipientName:      input.recipientName      ?? null,
        giftMessage:        input.giftMessage        ?? null,
        deliverToRecipient: input.deliverToRecipient ?? false,
        stripeSessionId:    input.stripeSessionId    ?? null,
        stripePaymentId:    input.stripePaymentId    ?? null,
        status:             'paid',
        createdAt:          new Date().toISOString(),
      },
    });
    return toStoredGift(gift);
  }
  throw new Error('Could not generate a unique gift code after several attempts.');
}

export async function findGiftByCode(code: string): Promise<StoredGift | null> {
  const gift = await prisma.gift.findUnique({ where: { code: code.toUpperCase().trim() } });
  return gift ? toStoredGift(gift) : null;
}

export async function findGiftBySession(sessionId: string): Promise<StoredGift | null> {
  const gift = await prisma.gift.findFirst({ where: { stripeSessionId: sessionId } });
  return gift ? toStoredGift(gift) : null;
}

/** Mark a gift as redeemed by a specific user. Returns false if already redeemed. */
export async function markGiftRedeemed(code: string, redeemedByUserId: string): Promise<boolean> {
  const result = await prisma.gift.updateMany({
    where: { code: code.toUpperCase().trim(), status: 'paid' },
    data:  { status: 'redeemed', redeemedByUserId, redeemedAt: new Date().toISOString() },
  });
  return result.count > 0;
}

/** All gifts, newest first — for the admin dashboard. */
export async function listGifts(): Promise<StoredGift[]> {
  const gifts = await prisma.gift.findMany({ orderBy: { createdAt: 'desc' } });
  return gifts.map(toStoredGift);
}

/**
 * emailLog.ts
 *
 * Lightweight append-only log of every marketing/transactional email sent
 * through GasCap™. Records are written to the EmailLog Prisma model.
 *
 * Usage:
 *   import { logEmail } from '@/lib/emailLog';
 *   await logEmail({ userId, userEmail, userName, type: 'trial-d1', subject });
 *
 * Failures are swallowed — a logging error must NEVER block the actual email send.
 *
 * Type conventions (use these exact strings so the admin panel badges work):
 *   Trial drip:        trial-d1 … trial-d5
 *   Paid drip:         paid-p1 … paid-p5
 *   Comp drip:         comp-c1 … comp-c5
 *   Engagement Pro:    eng-s1 … eng-s5
 *   Engagement Fleet:  eng-f1 … eng-f4
 *   Milestones:        milestone-fillup10 | milestone-mpg | milestone-referral1
 *   Referral credit:   referral-credit
 *   Trial ended:       trial-ended
 *   Early upgrade:     early-upgrade-offer
 *   Comp pro for life: comp-pro-for-life
 */
import { randomUUID } from 'crypto';
import { prisma }     from '@/lib/prisma';

export interface EmailLogEntry {
  userId:    string;
  userEmail: string;
  userName:  string;
  type:      string;
  subject:   string;
}

/**
 * Write one row to the EmailLog table. Never throws — logging errors are
 * printed to the console but do not propagate to the caller.
 */
export async function logEmail(entry: EmailLogEntry): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        id:        randomUUID(),
        userId:    entry.userId,
        userEmail: entry.userEmail,
        userName:  entry.userName,
        type:      entry.type,
        subject:   entry.subject,
        sentAt:    new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[emailLog] Failed to write log entry:', err);
  }
}

/** Human-readable label for each email type — used in admin panel badges */
export function emailTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'trial-d1': 'Trial D1',
    'trial-d2': 'Trial D2',
    'trial-d3': 'Trial D3',
    'trial-d4': 'Trial D4',
    'trial-d5': 'Trial D5',
    'paid-p1':  'Paid P1',
    'paid-p2':  'Paid P2',
    'paid-p3':  'Paid P3',
    'paid-p4':  'Paid P4',
    'paid-p5':  'Paid P5',
    'comp-c1':  'Comp C1',
    'comp-c2':  'Comp C2',
    'comp-c3':  'Comp C3',
    'comp-c4':  'Comp C4',
    'comp-c5':  'Comp C5',
    'eng-s1':   'Eng S1',
    'eng-s2':   'Eng S2',
    'eng-s3':   'Eng S3',
    'eng-s4':   'Eng S4',
    'eng-s5':   'Eng S5',
    'eng-f1':   'Eng F1',
    'eng-f2':   'Eng F2',
    'eng-f3':   'Eng F3',
    'eng-f4':   'Eng F4',
    'milestone-fillup10':  'M1 Fill-ups',
    'milestone-mpg':       'M2 MPG',
    'milestone-referral1': 'M3 Referral',
    'referral-credit':     'Referral Credit',
    'trial-ended':         'Trial Ended',
    'early-upgrade-offer': 'Early Upgrade',
    'comp-pro-for-life':   'Comp Pro Life',
  };
  return labels[type] ?? type;
}

/** Badge color class for each email type family */
export function emailTypeBadgeColor(type: string): string {
  if (type.startsWith('trial-'))       return 'bg-amber-100 text-amber-700';
  if (type.startsWith('paid-'))        return 'bg-blue-100 text-blue-700';
  if (type.startsWith('comp-'))        return 'bg-teal-100 text-teal-700';
  if (type.startsWith('eng-'))         return 'bg-green-100 text-green-700';
  if (type.startsWith('milestone-'))   return 'bg-purple-100 text-purple-700';
  if (type === 'referral-credit')      return 'bg-yellow-100 text-yellow-700';
  if (type === 'trial-ended')          return 'bg-red-100 text-red-600';
  if (type === 'early-upgrade-offer')  return 'bg-orange-100 text-orange-700';
  if (type === 'comp-pro-for-life')    return 'bg-teal-100 text-teal-800';
  return 'bg-slate-100 text-slate-600';
}

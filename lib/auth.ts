import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider        from 'next-auth/providers/google';
import {
  findByEmail, findById, verifyPassword, recordLogin,
  createGoogleUser, nameFromEmail,
  grantNewSignupProTrial, enrollEmailCampaign,
} from './users';
import { upsertGhlContact } from './ghl';
import { sendMail }         from './email';
import { sendCampaignEmail } from './emailCampaign';
import { hasEmailBeenSent }  from './emailLog';
import { checkRateLimit } from './rateLimit';
import { pgPool }        from './prisma';
import { recordAnalyticsEvent } from './analyticsEvents';

/** Wrong-code guesses allowed per email before verification is refused. */
const OTP_VERIFY_MAX_ATTEMPTS = 5;
/** Window for the above — matches the 10-minute life of the code itself. */
const OTP_VERIFY_WINDOW_MS    = 10 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  providers: [
    // ── Google OAuth ────────────────────────────────────────────────────────
    // Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in Railway env vars.
    // Redirect URI to register in Google Cloud Console:
    //   https://www.gascap.app/api/auth/callback/google
    //   http://localhost:3000/api/auth/callback/google  (local dev)
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID     ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),

    // ── Passwordless OTP ───────────────────────────────────────────────────
    CredentialsProvider({
      id:   'credentials-otp',
      name: 'Email OTP',
      credentials: {
        email:        { label: 'Email',    type: 'email' },
        code:         { label: 'Code',     type: 'text'  },
        locale:       { label: 'Locale',   type: 'text'  },
        referralCode: { label: 'Referral', type: 'text'  },
        platform:     { label: 'Platform', type: 'text'  },
      },
      async authorize(credentials) {
        try {
        if (!credentials?.email || !credentials?.code) return null;
        const email = credentials.email.toLowerCase().trim();
        const code  = credentials.code.trim();

        // Brute-force ceiling on VERIFICATION attempts.
        //
        // /api/otp/send was rate limited; this comparison was not. A 6-digit
        // code is a 1,000,000-value space with a 10-minute life, and unlimited
        // guesses against a known email address is a realistic attack on a
        // passwordless login — success here creates a session.
        //
        // Counted per email so one attacker cannot burn another user's budget
        // by guessing at their address... but note the trade-off: that also
        // means an attacker CAN lock a specific address out of OTP sign-in for
        // the window. Chosen deliberately — the alternative (keying on IP)
        // is trivially bypassed with rotation, and the user retains password
        // sign-in and a fresh code after the window.
        //
        // In-memory, matching the existing limiter. Single-instance today; the
        // migration path is documented in docs/RATE_LIMITING_PLAN.md. A
        // process restart clears counters, which is acceptable only because
        // the code itself expires in 10 minutes and is single-use.
        //
        // Checked BEFORE the database round-trip, not after — the whole point
        // of an in-memory ceiling is to reject cheaply. Querying Postgres
        // first and only then checking the limit (the original order here)
        // still protects against a successful guess, but wastes a DB round
        // trip on every attempt beyond the limit, including a sustained flood.
        const attempt = checkRateLimit(`otp-verify:${email}`, OTP_VERIFY_MAX_ATTEMPTS, OTP_VERIFY_WINDOW_MS);
        if (!attempt.allowed) {
          // Email intentionally NOT logged — this line is reachable by anyone
          // who submits a wrong code 5 times, i.e. by an attacker as easily as
          // a confused user, so it must not become a way to bulk-harvest which
          // addresses have GasCap accounts via log access.
          console.warn('[otp/verify] attempt limit reached for an email (redacted)');
          return null;
        }

        // Read + consume OTP from DB via raw pg (Prisma adapter had silent failures)
        const { rows } = await pgPool.query<{ code: string; name: string; expires: Date }>(
          `SELECT code, name, expires FROM "OtpCode" WHERE email=$1 LIMIT 1`,
          [email],
        );
        const entry = rows[0];

        if (!entry || entry.code !== code) return null;
        if (new Date() > new Date(entry.expires)) {
          await pgPool.query(`DELETE FROM "OtpCode" WHERE email=$1`, [email]);
          return null;
        }
        await pgPool.query(`DELETE FROM "OtpCode" WHERE email=$1`, [email]);

        const verifiedName = entry.name;
        const locale       = credentials.locale ?? 'en';
        const referralCode = credentials.referralCode ?? '';
        const platform     = (['ios', 'android'] as const).includes(credentials.platform as 'ios' | 'android')
          ? (credentials.platform as 'ios' | 'android')
          : 'web';

        // Find or create user
        let user = await findByEmail(email);
        const isNew = !user;

        if (!user) {
          const { rows: created } = await pgPool.query(
            `INSERT INTO "User" (id, email, name, "passwordHash", plan, "createdAt", "emailVerified", locale, "signupPlatform")
             VALUES ($1,$2,$3,'otp-no-password','free',$4,true,$5,$6) RETURNING id, name, plan`,
            [crypto.randomUUID(), email, verifiedName || nameFromEmail(email),
             new Date().toISOString(), locale === 'es' ? 'es' : 'en', platform],
          );
          // Growth Sprint 1, P0C-1A — signup_completed fires immediately after
          // the INSERT succeeds, using its own RETURNING id as the
          // authoritative new-user id, deliberately BEFORE the trial grant
          // below — signup and trial-grant success are independent facts,
          // and this event must record the former regardless of the latter.
          const newUserId = created[0].id as string;
          try {
            await recordAnalyticsEvent({
              eventType: 'signup_completed',
              originPlatform: platform,
              emitter: 'server',
              userId: newUserId,
              source: 'auth_signup',
              idempotencyKey: `signup_completed:${newUserId}`,
              metadata: { signupMethod: 'otp' },
            });
          } catch (e) { console.error('[GasCap analytics] OTP signup_completed write failed:', e); }
          user = await findByEmail(email);
          if (!user) return null;
        } else {
          await pgPool.query(`UPDATE "User" SET "emailVerified"=true WHERE email=$1`, [email]);
        }

        if (isNew) {
          // Grant trial synchronously so badge shows PRO TRIAL on first login
          const grantedTrial = await grantNewSignupProTrial(user!.id, 30).catch((e) => { console.error('[otp] trial grant failed:', e); return null; });
          // Growth Sprint 1, P0C-1A — trial_started only fires when the grant
          // itself actually succeeded (grantNewSignupProTrial catches its own
          // Prisma error and returns null on failure — awaiting a `.catch()`
          // wrapper alone would never observe that, since a caught rejection
          // never rejects). Explicitly capturing the return value is required.
          if (grantedTrial !== null) {
            try {
              await recordAnalyticsEvent({
                eventType: 'trial_started',
                originPlatform: platform,
                emitter: 'server',
                userId: user!.id,
                source: 'signup_trial',
                idempotencyKey: `trial_started:${user!.id}`,
              });
            } catch (e) { console.error('[GasCap analytics] OTP trial_started write failed:', e); }
          }
          user = await findByEmail(email) ?? user; // refresh to get updated plan/isProTrial
          // Remaining onboarding fire-and-forget
          ;(async () => {
            try {
              await enrollEmailCampaign(user!.id);
              if (referralCode) {
                const { findByReferralCode, setReferredBy } = await import('./users');
                const referrer = await findByReferralCode(referralCode).catch(() => null);
                if (referrer) await setReferredBy(user!.id, referralCode.toUpperCase()).catch(() => {});
              }
              if (!(await hasEmailBeenSent(user!.id, 'trial-d1'))) {
                await sendCampaignEmail(1, { id: user!.id, name: user!.name, email });
              }
              sendMail({
                to: 'info@gascap.app',
                subject: `New GasCap signup (OTP): ${user!.name}`,
                html: `<p><strong>${user!.name}</strong> (${email}) signed up via OTP.</p>`,
                text: `New OTP signup: ${user!.name} <${email}>`,
              }).catch(() => {});
              upsertGhlContact({
                name: user!.name, email, plan: 'pro', locale: locale === 'es' ? 'es' : 'en',
                source: 'GasCap Signup',
                extraTags: ['gascap-new-signup','gascap-trial-30day','gascap-email-verified','gascap-passwordless'],
              }).catch(() => {});
            } catch (e) { console.error('[otp] onboarding error', e); }
          })();
        }

        // Record the login for EVERY successful sign-in, new or returning.
        // This used to sit in the `else` above, so a brand-new signup got a
        // working session but no recorded login — which is why users appeared
        // with loginCount 0 while clearly using the app. It also matters
        // beyond the stat: recordLogin stamps activeDays, and that's what
        // earns a giveaway entry, so new signups were missing an entry for
        // their signup day. The Google new-user path already did this.
        await recordLogin(user.id);

        return { id: user.id, email, name: user.name, plan: user.plan, isProTrial: user.isProTrial ?? false, trialExpiresAt: user.trialExpiresAt ?? null, emailVerified: true, userMode: user.userMode ?? null };
        } catch (err) {
          console.error('[otp/verify] authorize threw:', err);
          return null;
        }
      },
    }),

    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        // ── Rate limit: 15 sign-in attempts per IP per 15 minutes ────────────
        const forwarded = (req?.headers?.['x-forwarded-for'] as string | undefined)
          ?.split(',')[0]?.trim();
        const realIp = req?.headers?.['x-real-ip'] as string | undefined;
        const ip = forwarded ?? realIp ?? 'unknown';
        const rl = checkRateLimit(`signin:${ip}`, 15, 15 * 60 * 1000);
        if (!rl.allowed) {
          throw new Error('Too many sign-in attempts. Please wait before trying again.');
        }

        if (!credentials?.email || !credentials?.password) return null;
        const user = await findByEmail(credentials.email);
        if (!user) return null;
        // Google-only accounts have no passwordHash — block credential sign-in
        if (!user.passwordHash) {
          throw new Error('This account uses Google Sign-In. Please continue with Google.');
        }
        const valid = await verifyPassword(credentials.password, user.passwordHash);
        if (!valid) return null;
        await recordLogin(user.id);
        return { id: user.id, email: user.email, name: user.name, plan: user.plan, emailVerified: user.emailVerified ?? false, userMode: user.userMode ?? null };
      },
    }),
  ],

  session: { strategy: 'jwt' },

  pages: {
    signIn: '/signin',
  },

  callbacks: {
    // ── Google OAuth: find-or-create user in our DB ──────────────────────
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        try {
          const email = user.email!;
          let dbUser  = await findByEmail(email);

          if (dbUser) {
            // Existing account — link Google to it (trust Google's verified email)
            await recordLogin(dbUser.id);
          } else {
            // Growth Sprint 1, P0C-1A correction — createGoogleUser() now
            // returns { user, created } so this callback never has to GUESS
            // whether it just created a brand-new account. Before this fix,
            // reaching this `else` branch (outer findByEmail found nothing)
            // was wrongly treated as proof of a fresh signup — but two
            // concurrent Google sign-ins for the same brand-new email could
            // both pass that outer check before either INSERT lands; the
            // race loser's createGoogleUser() call would take its OWN
            // internal existing-user early return and hand back a real,
            // already-created account. Unconditionally granting/extending a
            // trial and emitting trial_started in that case would corrupt
            // an existing user's trial state on every such race. `created`
            // makes the distinction explicit and authoritative.
            const googleName = user.name ?? nameFromEmail(email);
            const avatarUrl  = (profile as { picture?: string })?.picture ?? null;
            const result = await createGoogleUser(email, googleName, avatarUrl);
            dbUser = result.user;

            if (result.created) {
              // Genuine new account — full new-user sequence.
              const grantedTrial = await grantNewSignupProTrial(dbUser.id, 30);
              // trial_started only when the grant itself actually succeeded
              // (grantNewSignupProTrial catches its own Prisma error and
              // returns null on failure, never rejects).
              if (grantedTrial !== null) {
                try {
                  await recordAnalyticsEvent({
                    eventType: 'trial_started',
                    originPlatform: 'unknown',
                    emitter: 'server',
                    userId: dbUser.id,
                    source: 'signup_trial',
                    idempotencyKey: `trial_started:${dbUser.id}`,
                  });
                } catch (e) { console.error('[GasCap analytics] Google trial_started write failed:', e); }
              }
              await enrollEmailCampaign(dbUser.id);
              await recordLogin(dbUser.id);

              // Welcome drip email (fire-and-forget)
              // Google users have verified emails — omit verifyUrl so the verify
              // block does not render in the D1 email.
              ;(async () => {
                if (await hasEmailBeenSent(dbUser!.id, 'trial-d1')) return;
                await sendCampaignEmail(1, {
                  id:    dbUser!.id,
                  name:  dbUser!.name,
                  email: dbUser!.email,
                  // verifyUrl intentionally omitted: Google accounts are pre-verified
                });
              })().catch((e) => console.error('[GasCap] Google welcome drip failed:', e));

              // Admin notify (fire-and-forget)
              sendMail({
                to:      'info@gascap.app',
                subject: `🎉 New GasCap™ signup via Google: ${dbUser.name} (Pro trial activated)`,
                html:    `<p><strong>${dbUser.name}</strong> (${dbUser.email}) signed up with Google — Pro trial active.</p>`,
                text:    `New Google signup: ${dbUser.name} <${dbUser.email}> — Pro trial (30 days)`,
              }).catch(() => {});

              // GHL sync (fire-and-forget)
              upsertGhlContact({
                name:      dbUser.name,
                email:     dbUser.email,
                plan:      'pro',
                locale:    'en',
                source:    'GasCap Google Signup',
                extraTags: ['gascap-new-signup', 'gascap-trial-30day', 'gascap-google-auth'],
              }).catch(() => {});
            } else {
              // Race loser — createGoogleUser() found the account had
              // already been created by a concurrent request. Treat exactly
              // like a returning login: no trial grant, no trial_started,
              // no signup_completed, no campaign enrollment, no new-signup
              // email/admin/GHL side effects. Only the login itself is
              // recorded — this outcome must never mutate trial state.
              await recordLogin(dbUser.id);
            }
          }

          // Override NextAuth's Google user ID with our DB user ID so the JWT
          // callback picks it up correctly in its `if (user)` branch.
          user.id = dbUser.id;
          const u = user as unknown as Record<string, unknown>;
          u.plan           = dbUser.plan;
          u.emailVerified  = true;
          u.isProTrial     = dbUser.isProTrial ?? false;
          u.trialExpiresAt = dbUser.trialExpiresAt ?? null;
          u.createdAt      = dbUser.createdAt;
        } catch (err) {
          console.error('[GasCap] Google signIn callback error:', err);
          return false;
        }
      }
      return true;
    },

    // Expose user id in the JWT token and session
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id              = user.id;
        token.plan            = (user as { plan?: string }).plan ?? 'free';
        token.emailVerified   = (user as { emailVerified?: boolean }).emailVerified ?? false;
        token.isProTrial      = (user as { isProTrial?: boolean }).isProTrial ?? false;
        token.trialExpiresAt  = (user as { trialExpiresAt?: string }).trialExpiresAt ?? null;
        token.createdAt       = (user as { createdAt?: string }).createdAt ?? null;
        token.stripeInterval  = (user as { stripeInterval?: string }).stripeInterval ?? null;
        // Post-Revision-2 fix: expose RevenueCat provenance on the session
        // too, so client-side "is this a Lifetime member" checks can be
        // provider-neutral (see lib/entitlements.ts's hasLifetimeEntitlement
        // and lib/planBadge.ts) instead of only ever seeing stripeInterval,
        // which no longer reflects an RC-only Lifetime purchaser.
        token.revenueCatActive   = (user as { revenueCatActive?: boolean }).revenueCatActive ?? false;
        token.revenueCatInterval = (user as { revenueCatInterval?: string | null }).revenueCatInterval ?? null;
        token.userMode        = (user as { userMode?: string | null }).userMode ?? null;
      }
      // Re-fetch plan on session refresh so upgrades are reflected immediately
      if (trigger === 'update' || (!user && token.id)) {
        const fresh = await findById(token.id as string);
        if (fresh) {
          token.plan           = fresh.plan;
          token.emailVerified  = fresh.emailVerified  ?? false;
          token.isProTrial     = fresh.isProTrial     ?? false;
          token.trialExpiresAt = fresh.trialExpiresAt ?? null;
          token.createdAt      = fresh.createdAt      ?? null;
          token.stripeInterval = fresh.stripeInterval ?? null;
          token.revenueCatActive   = fresh.revenueCatActive   ?? false;
          token.revenueCatInterval = fresh.revenueCatInterval ?? null;
          token.userMode       = fresh.userMode       ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; plan?: string }).id                    = token.id            as string;
        (session.user as { id?: string; plan?: string }).plan                  = token.plan          as string ?? 'free';
        (session.user as { emailVerified?: boolean }).emailVerified            = token.emailVerified  as boolean ?? false;
        (session.user as { isProTrial?: boolean }).isProTrial                  = token.isProTrial     as boolean ?? false;
        (session.user as { trialExpiresAt?: string | null }).trialExpiresAt   = token.trialExpiresAt as string | null ?? null;
        (session.user as { createdAt?: string | null }).createdAt             = token.createdAt     as string | null ?? null;
        (session.user as { stripeInterval?: string | null }).stripeInterval   = token.stripeInterval as string | null ?? null;
        (session.user as { revenueCatActive?: boolean }).revenueCatActive     = token.revenueCatActive as boolean ?? false;
        (session.user as { revenueCatInterval?: string | null }).revenueCatInterval = token.revenueCatInterval as string | null ?? null;
        (session.user as { userMode?: string | null }).userMode               = token.userMode       as string | null ?? null;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

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
import { prisma }           from './prisma';
import { findByReferralCode, setReferredBy } from './users';
import { newUserOtps }     from './otpNewUsers';

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

    // ── Passwordless OTP sign-in ────────────────────────────────────────────
    // Client calls signIn('credentials-otp', { email, code, locale?, referralCode? })
    // directly — no intermediate session token needed.
    CredentialsProvider({
      id:   'credentials-otp',
      name: 'Email OTP',
      credentials: {
        email:        { label: 'Email',        type: 'email' },
        code:         { label: 'Code',         type: 'text'  },
        locale:       { label: 'Locale',       type: 'text'  },
        referralCode: { label: 'Referral',     type: 'text'  },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.code) return null;
        const email = credentials.email.toLowerCase().trim();
        const code  = credentials.code.trim();

        // Verify code — DB for existing users, memory for new users
        const row = await prisma.user.findUnique({
          where:  { email },
          select: { id: true, otpCode: true, otpCodeExpires: true, otpCodeName: true,
                    name: true, plan: true, emailVerified: true, isProTrial: true,
                    trialExpiresAt: true, emailCampaignStep: true },
        });

        let verifiedName: string | null = null;

        if (row) {
          // Existing user — check DB
          if (row.otpCode !== code) return null;
          if (!row.otpCodeExpires || new Date(row.otpCodeExpires) < new Date()) return null;
          verifiedName = row.otpCodeName ?? row.name;
          await prisma.user.update({
            where: { email },
            data:  { otpCode: null, otpCodeExpires: null, otpCodeName: null, emailVerified: true },
          });
        } else {
          // New user — check in-memory store
          const entry = newUserOtps.get(email);
          if (!entry || entry.code !== code) return null;
          if (Date.now() > entry.expires) { newUserOtps.delete(email); return null; }
          verifiedName = entry.name;
          newUserOtps.delete(email);
        }

        const locale       = credentials.locale ?? 'en';
        const referralCode = credentials.referralCode ?? '';
        const displayName  = verifiedName?.trim() || nameFromEmail(email);
        const needsOnboarding = !row; // new user if no DB row existed

        let userId: string;

        if (!row) {
          // Create the user now that OTP is verified
          const created = await prisma.user.create({
            data: {
              id:            crypto.randomUUID(),
              email,
              name:          displayName,
              passwordHash:  null,
              plan:          'free',
              createdAt:     new Date().toISOString(),
              emailVerified: true,
              locale:        locale === 'es' ? 'es' : 'en',
            },
          });
          userId = created.id;
        } else {
          userId = row.id;
        }

        if (needsOnboarding) {
          ;(async () => {
            try {
              await grantNewSignupProTrial(userId, 30);
              await enrollEmailCampaign(userId);

              if (referralCode) {
                const referrer = await findByReferralCode(referralCode).catch(() => null);
                if (referrer) await setReferredBy(userId, referralCode.toUpperCase()).catch(() => {});
              }

              if (!(await hasEmailBeenSent(userId, 'trial-d1'))) {
                await sendCampaignEmail(1, { id: userId, name: displayName, email });
              }

              await sendMail({
                to:      'info@gascap.app',
                subject: `New GasCap signup (passwordless): ${displayName}`,
                html:    `<p><strong>${displayName}</strong> (${email}) signed up via email OTP.</p>`,
                text:    `New signup: ${displayName} <${email}>`,
              });

              upsertGhlContact({
                name:      displayName,
                email,
                plan:      'pro',
                locale:    locale === 'es' ? 'es' : 'en',
                source:    'GasCap Signup',
                extraTags: ['gascap-new-signup', 'gascap-trial-30day', 'gascap-email-verified', 'gascap-passwordless'],
              }).catch(() => {});
            } catch (e) {
              console.error('[credentials-otp] onboarding error', e);
            }
          })();
        } else {
          await recordLogin(userId);
        }

        const finalUser = await prisma.user.findUnique({
          where:  { id: userId },
          select: { id: true, name: true, plan: true },
        });

        return {
          id:            userId,
          email,
          name:          finalUser?.name ?? displayName,
          plan:          finalUser?.plan ?? 'free',
          emailVerified: true,
        };
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
        return { id: user.id, email: user.email, name: user.name, plan: user.plan, emailVerified: user.emailVerified ?? false };
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
            // New Google user — create account, grant Pro trial, start drip
            const googleName = user.name ?? nameFromEmail(email);
            const avatarUrl  = (profile as { picture?: string })?.picture ?? null;
            dbUser = await createGoogleUser(email, googleName, avatarUrl);
            await grantNewSignupProTrial(dbUser.id, 30);
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
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

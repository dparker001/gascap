import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { findByEmail, findById, verifyPassword, recordLogin } from './users';
import { checkRateLimit } from './rateLimit';

export const authOptions: NextAuthOptions = {
  providers: [
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
    // Expose user id in the JWT token and session
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id              = user.id;
        token.plan            = (user as { plan?: string }).plan ?? 'free';
        token.emailVerified   = (user as { emailVerified?: boolean }).emailVerified ?? false;
        token.isProTrial      = (user as { isProTrial?: boolean }).isProTrial ?? false;
        token.trialExpiresAt  = (user as { trialExpiresAt?: string }).trialExpiresAt ?? null;
        token.createdAt       = (user as { createdAt?: string }).createdAt ?? null;
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
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; plan?: string }).id              = token.id            as string;
        (session.user as { id?: string; plan?: string }).plan            = token.plan          as string ?? 'free';
        (session.user as { emailVerified?: boolean }).emailVerified      = token.emailVerified  as boolean ?? false;
        (session.user as { isProTrial?: boolean }).isProTrial            = token.isProTrial     as boolean ?? false;
        (session.user as { trialExpiresAt?: string | null }).trialExpiresAt = token.trialExpiresAt as string | null ?? null;
        (session.user as { createdAt?: string | null }).createdAt        = token.createdAt     as string | null ?? null;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id:            string;
      plan?:         string;
      emailVerified?: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    id:            string;
    plan?:         string;
    emailVerified?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?:           string;
    plan?:         string;
    emailVerified?: boolean;
  }
}

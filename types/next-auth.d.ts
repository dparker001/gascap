import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id:            string;
      plan?:         string;
      emailVerified?: boolean;
      userMode?:     string | null;
    } & DefaultSession['user'];
  }

  interface User {
    id:            string;
    plan?:         string;
    emailVerified?: boolean;
    userMode?:     string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?:           string;
    plan?:         string;
    emailVerified?: boolean;
    userMode?:     string | null;
  }
}

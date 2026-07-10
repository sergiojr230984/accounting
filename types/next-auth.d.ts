import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    companyId: string;
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    companyId: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: string;
    companyId: string;
  }
}

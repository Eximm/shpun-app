export type MeResponse = {
  ok: true;
  profile: {
    id: number;
    displayName: string;
    login: string | null;
    login2?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    fullName?: string | null;
    phone?: string | null;
    passwordSet: boolean;
    created?: string | null;
    lastLogin?: string | null;
    role?: string | null;
    isAdmin?: boolean;
  };
  admin?: {
    role?: string | null;
    isAdmin?: boolean;
  };
  telegram?: {
    login?: string | null;
    username?: string | null;
    chatId?: number | string | null;
    status?: string | null;
  } | null;
  balance: {
    amount: number;
    currency: string;
  };
  bonus?: number;
  discount?: number;
  referralsCount?: number;
};
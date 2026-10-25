export type OrderStatus =
  | 'INITIALIZING'
  | 'PENDING'
  | 'PAID'
  | 'UNDERPAID'
  | 'EXPIRED'
  | 'FAILED'
  | 'PAID_NEEDS_OWNER';

export type SkuCondition = 'new' | 'uk_used' | 'refurbished';

export type PaystackInitializeData = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export type PaystackVerifyData = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  domain?: string;
  paidAt?: string | null;
};

export type ProviderAttempt = {
  attempt: number;
  httpStatus?: number;
  payload: unknown;
};

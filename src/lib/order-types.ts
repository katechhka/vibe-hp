export type OrderStatus =
  'pending' | 'paid' | 'failed' | 'canceled' | 'expired';
export type AttemptStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';
export type CartLot = { key: string; quantity: number };
export type OrderLine = {
  id: string;
  variant: string;
  quantity: number;
  name: string;
  slug: string;
  image: string;
  unitPrice: number;
  lots: CartLot[];
};
export type PublicOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  items: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
  deliveryLabel: string;
  createdAt: number;
  reservedUntil: number;
  activeAttempt: string | null;
  attemptStatus: AttemptStatus | null;
  mode: 'demo' | 'yookassa_test';
  confirmationUrl?: string | null;
  paymentError?: string | null;
  emailStatus: ReceiptStatus;
};
export type OrderRequestLine = {
  id: string;
  variant: string;
  quantity: number;
  lots: CartLot[];
};

export type ReceiptStatus =
  'not_requested' | 'not_configured' | 'pending' | 'sent' | 'failed' | 'review';

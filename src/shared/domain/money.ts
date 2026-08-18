export const SUPPORTED_CURRENCY = "JPY" as const;

export type Money = Readonly<{
  amount: number;
  currency: typeof SUPPORTED_CURRENCY;
}>;

export class InvalidMoneyError extends Error {
  constructor(amount: number) {
    super(`Money must be a non-negative integer, received: ${amount}`);
    this.name = "InvalidMoneyError";
  }
}

export function money(amount: number): Money {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new InvalidMoneyError(amount);
  }

  return { amount, currency: SUPPORTED_CURRENCY };
}

export function multiplyMoney(price: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InvalidMoneyError(quantity);
  }

  return money(price.amount * quantity);
}

export function formatMoney(value: Money): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: 0,
  }).format(value.amount);
}

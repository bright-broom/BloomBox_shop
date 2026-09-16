export const ACCOUNT_LIMITS = {
  addresses: 20,
  favorites: 50,
  requests: 20,
  name: 100,
  message: 2000,
  phone: 20,
  label: 40,
  postalCode: 8,
  prefecture: 10,
  city: 80,
  addressLine: 120,
  requestHistory: 50,
  queue: 20,
  privacyQueue: 10,
  erasureReviewDays: 30,
} as const;
export type AddressEntry = Readonly<{
  id: string;
  label: string;
  name: string;
  postalCode: string;
  prefecture: string;
  city: string;
  line1: string;
  line2: string;
  phone: string;
}>;
export type AccountPreferences = Readonly<{
  name: string;
  phone: string;
  marketing: boolean;
  marketingEmail: string | null;
  addresses: readonly AddressEntry[];
  defaultAddressId: string | null;
  favorites: readonly string[];
}>;
export const emptyAccountPreferences = (): AccountPreferences => ({
  name: "",
  phone: "",
  marketing: false,
  marketingEmail: null,
  addresses: [],
  defaultAddressId: null,
  favorites: [],
});
export type AccountChange =
  | { kind: "profile"; name: string; phone: string }
  | { kind: "address"; address: AddressEntry }
  | { kind: "remove-address" | "default-address"; id: string }
  | { kind: "favorite" | "unfavorite"; productId: string }
  | { kind: "marketing"; enabled: boolean; verifiedEmail: string };
export class AccountPortalError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "expired"
      | "conflict"
      | "limit"
      | "not-found"
      | "unavailable",
  ) {
    super("Customer account operation failed");
  }
}
export function changeAccount(
  current: AccountPreferences,
  change: AccountChange,
): AccountPreferences {
  switch (change.kind) {
    case "profile":
      return { ...current, name: change.name, phone: change.phone };
    case "marketing":
      return {
        ...current,
        marketing: change.enabled,
        marketingEmail: change.enabled ? change.verifiedEmail : null,
      };
    case "favorite":
      if (current.favorites.includes(change.productId)) return current;
      if (current.favorites.length >= ACCOUNT_LIMITS.favorites)
        throw new AccountPortalError("limit");
      return {
        ...current,
        favorites: [...current.favorites, change.productId],
      };
    case "unfavorite":
      return {
        ...current,
        favorites: current.favorites.filter((id) => id !== change.productId),
      };
    case "address": {
      const exists = current.addresses.some((a) => a.id === change.address.id);
      if (!exists && current.addresses.length >= ACCOUNT_LIMITS.addresses)
        throw new AccountPortalError("limit");
      return {
        ...current,
        addresses: exists
          ? current.addresses.map((a) =>
              a.id === change.address.id ? change.address : a,
            )
          : [...current.addresses, change.address],
        defaultAddressId: current.defaultAddressId ?? change.address.id,
      };
    }
    case "remove-address": {
      const addresses = current.addresses.filter((a) => a.id !== change.id);
      return {
        ...current,
        addresses,
        defaultAddressId:
          current.defaultAddressId === change.id
            ? (addresses[0]?.id ?? null)
            : current.defaultAddressId,
      };
    }
    case "default-address":
      if (!current.addresses.some((a) => a.id === change.id))
        throw new AccountPortalError("not-found");
      return { ...current, defaultAddressId: change.id };
  }
}

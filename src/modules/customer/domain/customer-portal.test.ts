import { describe, expect, it } from "vitest";
import {
  changeAccount,
  emptyAccountPreferences,
  ACCOUNT_LIMITS,
} from "./customer-portal";
const address = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "自宅",
  name: "テスト",
  postalCode: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  line1: "テスト1",
  line2: "",
  phone: "09012345678",
};
describe("customer self-service policy", () => {
  it("does not opt in or infer an address at registration", () => {
    expect(emptyAccountPreferences()).toMatchObject({
      marketing: false,
      marketingEmail: null,
      addresses: [],
      defaultAddressId: null,
    });
  });
  it("keeps one valid default across edit, selection and deletion", () => {
    const first = changeAccount(emptyAccountPreferences(), {
      kind: "address",
      address,
    });
    const second = changeAccount(first, {
      kind: "address",
      address: { ...address, id: "00000000-0000-4000-8000-000000000002" },
    });
    expect(second.defaultAddressId).toBe(address.id);
    const updated = changeAccount(second, {
      kind: "address",
      address: { ...address, label: "実家" },
    });
    expect(updated.addresses).toHaveLength(2);
    expect(updated.addresses[0].label).toBe("実家");
    expect(first.addresses[0].label).toBe("自宅");
    const remaining = changeAccount(updated, {
      kind: "remove-address",
      id: address.id,
    });
    expect(remaining.defaultAddressId).toBe(remaining.addresses[0].id);
    expect(
      changeAccount(remaining, {
        kind: "remove-address",
        id: remaining.addresses[0].id,
      }).defaultAddressId,
    ).toBeNull();
    expect(() =>
      changeAccount(first, { kind: "default-address", id: "unknown" }),
    ).toThrow();
  });
  it("bounds saved data and makes favourite addition/removal repeatable", () => {
    const full = {
      ...emptyAccountPreferences(),
      favorites: Array.from(
        { length: ACCOUNT_LIMITS.favorites },
        (_, i) => "product-" + i,
      ),
    };
    expect(
      changeAccount(full, { kind: "favorite", productId: "product-0" }),
    ).toBe(full);
    expect(() =>
      changeAccount(full, { kind: "favorite", productId: "new" }),
    ).toThrow();
    expect(
      changeAccount(full, { kind: "unfavorite", productId: "missing" })
        .favorites,
    ).toEqual(full.favorites);
    expect(() =>
      changeAccount(
        {
          ...emptyAccountPreferences(),
          addresses: Array.from(
            { length: ACCOUNT_LIMITS.addresses },
            (_, i) => ({ ...address, id: String(i) }),
          ),
        },
        { kind: "address", address },
      ),
    ).toThrow();
  });
  it("withdraws the saved marketing destination with consent", () => {
    const on = changeAccount(emptyAccountPreferences(), {
      kind: "marketing",
      enabled: true,
      verifiedEmail: "fixture@example.test",
    });
    expect(
      changeAccount(on, {
        kind: "marketing",
        enabled: false,
        verifiedEmail: "fixture@example.test",
      }),
    ).toMatchObject({ marketing: false, marketingEmail: null });
  });
});

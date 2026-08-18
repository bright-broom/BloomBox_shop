import { describe, expect, it } from "vitest";
import { InvalidMoneyError, money, multiplyMoney } from "./money";

describe("money", () => {
  it("stores JPY as integer minor units", () => {
    expect(money(6600)).toEqual({ amount: 6600, currency: "JPY" });
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid amount %s", (amount) => {
    expect(() => money(amount)).toThrow(InvalidMoneyError);
  });

  it("multiplies without floating point prices", () => {
    expect(multiplyMoney(money(6600), 2)).toEqual({ amount: 13200, currency: "JPY" });
  });
});

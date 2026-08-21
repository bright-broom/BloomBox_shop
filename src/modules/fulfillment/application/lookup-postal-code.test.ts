import { describe, expect, it, vi } from "vitest";
import type { PostalAddressRepository } from "../domain/postal-address";
import { LookupPostalCode } from "./lookup-postal-code";

describe("LookupPostalCode", () => {
  it("normalizes input before calling the repository", async () => {
    const findByPostalCode = vi.fn<PostalAddressRepository["findByPostalCode"]>()
      .mockResolvedValue([{ prefecture: "東京都", city: "千代田区", town: "千代田" }]);

    const result = await new LookupPostalCode({ findByPostalCode }).execute("１００-０００１");

    expect(findByPostalCode).toHaveBeenCalledWith("1000001");
    expect(result).toEqual({
      postalCode: "100-0001",
      addresses: [{ prefecture: "東京都", city: "千代田区", town: "千代田" }],
    });
  });
});

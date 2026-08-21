import { describe, expect, it, vi } from "vitest";
import { postalCode } from "../domain/postal-address";
import {
  PostalCodeLookupUnavailableError,
  ZipcloudPostalAddressRepository,
  type PostalCodeFetch,
} from "./zipcloud-postal-address-repository";

describe("ZipcloudPostalAddressRepository", () => {
  it("uses a bounded cached request and maps unique address candidates", async () => {
    const fetcher = vi.fn<PostalCodeFetch>().mockResolvedValue(response({
      status: 200,
      message: null,
      results: [
        { address1: "東京都", address2: "千代田区", address3: "千代田", zipcode: "1000001" },
        { address1: "東京都", address2: "千代田区", address3: "千代田", zipcode: "1000001" },
      ],
    }));
    const repository = new ZipcloudPostalAddressRepository(fetcher);

    await expect(repository.findByPostalCode(postalCode("1000001"))).resolves.toEqual([
      { prefecture: "東京都", city: "千代田区", town: "千代田" },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://zipcloud.ibsnet.co.jp/api/search?zipcode=1000001&limit=20");
    expect(options).toEqual(expect.objectContaining({
      method: "GET",
      cache: "force-cache",
      next: { revalidate: 86_400 },
    }));
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns no candidates when the postal code is not found", async () => {
    const fetcher = vi.fn<PostalCodeFetch>().mockResolvedValue(response({
      status: 200,
      message: null,
      results: null,
    }));

    await expect(new ZipcloudPostalAddressRepository(fetcher).findByPostalCode(postalCode("9999999")))
      .resolves.toEqual([]);
  });

  it("hides network, provider, and invalid response details behind one typed error", async () => {
    const networkFailure = vi.fn<PostalCodeFetch>().mockRejectedValue(new Error("sensitive URL"));
    const invalidResponse = vi.fn<PostalCodeFetch>().mockResolvedValue(response({ status: 500 }));

    await expect(new ZipcloudPostalAddressRepository(networkFailure).findByPostalCode(postalCode("1000001")))
      .rejects.toBeInstanceOf(PostalCodeLookupUnavailableError);
    await expect(new ZipcloudPostalAddressRepository(invalidResponse).findByPostalCode(postalCode("1000001")))
      .rejects.toBeInstanceOf(PostalCodeLookupUnavailableError);
  });

  it("rejects a provider result for a different postal code", async () => {
    const fetcher = vi.fn<PostalCodeFetch>().mockResolvedValue(response({
      status: 200,
      message: null,
      results: [
        { address1: "東京都", address2: "千代田区", address3: "千代田", zipcode: "1000002" },
      ],
    }));

    await expect(new ZipcloudPostalAddressRepository(fetcher).findByPostalCode(postalCode("1000001")))
      .rejects.toBeInstanceOf(PostalCodeLookupUnavailableError);
  });
});

function response(payload: unknown, ok = true): Pick<Response, "ok" | "json"> {
  return { ok, json: async () => payload };
}

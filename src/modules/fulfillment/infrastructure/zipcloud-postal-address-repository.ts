import { z } from "zod";
import {
  postalAddress,
  type PostalAddress,
  type PostalAddressRepository,
  type PostalCode,
} from "../domain/postal-address";

const ZIPCLOUD_SEARCH_ENDPOINT = "https://zipcloud.ibsnet.co.jp/api/search";
const POSTAL_CODE_CACHE_SECONDS = 86_400;
const POSTAL_CODE_LOOKUP_TIMEOUT_MS = 2_500;

const zipcloudResponseSchema = z.object({
  status: z.number().int(),
  message: z.string().nullable(),
  results: z.array(z.object({
    address1: z.string(),
    address2: z.string(),
    address3: z.string(),
    zipcode: z.string().regex(/^\d{7}$/),
  })).max(20).nullable(),
});

type PostalCodeFetchInit = RequestInit & Readonly<{
  next: Readonly<{ revalidate: number }>;
}>;

export type PostalCodeFetch = (
  input: string | URL,
  init: PostalCodeFetchInit,
) => Promise<Pick<Response, "ok" | "json">>;

export class ZipcloudPostalAddressRepository implements PostalAddressRepository {
  constructor(
    private readonly fetcher: PostalCodeFetch = fetch,
    private readonly endpoint = ZIPCLOUD_SEARCH_ENDPOINT,
  ) {}

  async findByPostalCode(postalCode: PostalCode): Promise<readonly PostalAddress[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("zipcode", postalCode);
    url.searchParams.set("limit", "20");

    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "force-cache",
        next: { revalidate: POSTAL_CODE_CACHE_SECONDS },
        signal: AbortSignal.timeout(POSTAL_CODE_LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) throw new PostalCodeLookupUnavailableError();
      const parsed = zipcloudResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.status !== 200) {
        throw new PostalCodeLookupUnavailableError();
      }
      if (parsed.data.results?.some((result) => result.zipcode !== postalCode)) {
        throw new PostalCodeLookupUnavailableError();
      }
      return uniqueAddresses((parsed.data.results ?? []).map((result) => postalAddress({
        prefecture: result.address1,
        city: result.address2,
        town: result.address3,
      })));
    } catch {
      throw new PostalCodeLookupUnavailableError();
    }
  }
}

export class PostalCodeLookupUnavailableError extends Error {
  constructor() {
    super("Postal code lookup provider is unavailable");
    this.name = "PostalCodeLookupUnavailableError";
  }
}

function uniqueAddresses(addresses: readonly PostalAddress[]): readonly PostalAddress[] {
  return [...new Map(addresses.map((address) => [
    `${address.prefecture}\u001f${address.city}\u001f${address.town}`,
    address,
  ])).values()];
}

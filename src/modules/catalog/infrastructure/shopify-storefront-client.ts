import type { ShopifyStorefrontConfig } from "@/shared/infrastructure/config/shopify-storefront-config";
import { z } from "zod";

export const SHOPIFY_REQUEST_TIMEOUT_MS = 8_000;
export const SHOPIFY_REQUEST_MAX_ATTEMPTS = 3;
export const SHOPIFY_RESPONSE_MAX_BYTES = 2_000_000;

export interface ShopifyStorefrontClient {
  request(query: string, variables: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export class ShopifyCatalogResponseError extends Error {
  constructor() {
    super("Shopify catalog response is invalid");
    this.name = "ShopifyCatalogResponseError";
  }
}

export class ShopifyStorefrontFetchClient implements ShopifyStorefrontClient {
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly buyerIp: () => Promise<string | undefined>;

  constructor(
    private readonly config: ShopifyStorefrontConfig,
    options: Readonly<{
      fetchImplementation?: typeof fetch;
      delay?: (milliseconds: number) => Promise<void>;
      buyerIp?: () => Promise<string | undefined>;
    }> = {},
  ) {
    this.endpoint = `https://${config.storeDomain}/api/${config.apiVersion}/graphql.json`;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.delay = options.delay ?? defaultDelay;
    this.buyerIp = options.buyerIp ?? (async () => undefined);
  }

  async request(query: string, variables: Readonly<Record<string, unknown>>): Promise<unknown> {
    const buyerIp = await this.buyerIp();
    for (let attempt = 1; attempt <= SHOPIFY_REQUEST_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SHOPIFY_REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImplementation(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": this.config.accessToken,
            ...(buyerIp ? { "Shopify-Storefront-Buyer-IP": buyerIp } : {}),
          },
          body: JSON.stringify({ query, variables }),
          redirect: "error",
          signal: controller.signal,
        });
        if (isRetryableStatus(response.status) && attempt < SHOPIFY_REQUEST_MAX_ATTEMPTS) {
          await this.delay(retryDelayMilliseconds(response, attempt));
          continue;
        }
        if (!response.ok) throw new ShopifyCatalogResponseError();
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > SHOPIFY_RESPONSE_MAX_BYTES) {
          throw new ShopifyCatalogResponseError();
        }
        try {
          const json: unknown = JSON.parse(text);
          if (isRetryableGraphqlResponse(json) && attempt < SHOPIFY_REQUEST_MAX_ATTEMPTS) {
            await this.delay(Math.min(1_000 * 2 ** (attempt - 1), 2_000));
            continue;
          }
          return json;
        } catch {
          throw new ShopifyCatalogResponseError();
        }
      } catch (error) {
        if (
          attempt < SHOPIFY_REQUEST_MAX_ATTEMPTS
          && !(error instanceof ShopifyCatalogResponseError)
        ) {
          await this.delay(100 * 2 ** (attempt - 1));
          continue;
        }
        throw error instanceof ShopifyCatalogResponseError
          ? error
          : new ShopifyCatalogResponseError();
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new ShopifyCatalogResponseError();
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableGraphqlResponse(value: unknown): boolean {
  const parsed = z.object({
    errors: z.array(z.object({
      extensions: z.object({ code: z.string() }).optional(),
    })),
  }).safeParse(value);
  return parsed.success && parsed.data.errors.some((error) =>
    error.extensions?.code === "THROTTLED"
    || error.extensions?.code === "INTERNAL_SERVER_ERROR");
}

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1_000, 2_000);
  return 100 * 2 ** (attempt - 1);
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

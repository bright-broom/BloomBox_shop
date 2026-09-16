import { AccountPortalError } from "@/modules/customer/public";
import { customerPortalContext } from "@/shared/infrastructure/customer-portal";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return new Response(null, { status: 403, headers });
  try {
    const { actor, repository } = await customerPortalContext();
    const [snapshot, requests] = await Promise.all([
      repository.read(actor),
      repository.requests(actor),
    ]);
    return Response.json(
      {
        format: "bloombox-account-v1",
        exportedAt: new Date().toISOString(),
        profile: snapshot.preferences,
        requests,
        scope:
          "Saved account preferences and latest 50 support requests. Order details are available in purchase history.",
      },
      {
        headers: {
          ...headers,
          "Content-Disposition": 'attachment; filename="bloombox-account.json"',
        },
      },
    );
  } catch (error) {
    if (!(error instanceof AccountPortalError))
      console.error("customer_export_failed");
    return Response.json(
      { error: "Account export unavailable" },
      {
        status:
          error instanceof AccountPortalError && error.code === "expired"
            ? 401
            : 503,
        headers,
      },
    );
  }
}

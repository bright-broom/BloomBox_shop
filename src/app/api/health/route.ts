export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      release: process.env.BLOOMBOX_RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

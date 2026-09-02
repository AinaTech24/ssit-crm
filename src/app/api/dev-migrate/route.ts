// Migration complete. Inactive route.
export const dynamic = "force-dynamic";
export async function GET() {
  return new Response("Inactive");
}

import { NextResponse } from "next/server";

import { versionJournal } from "@/lib/depot";

// Route interrogée en boucle par les navigateurs ouverts : elle doit rester
// la moins chère possible, et surtout jamais mise en cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const version = await versionJournal();
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids (non-empty array) is required" }, { status: 400 });
  }

  // PostgREST rejects long `in.(...)` filter URLs once the query string
  // approaches ~8KB — chunk the delete to stay under the limit.
  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("leads")
      .delete({ count: "exact" })
      .in("id", slice);
    if (error) return NextResponse.json({ error: error.message, deleted }, { status: 500 });
    deleted += count ?? slice.length;
  }
  return NextResponse.json({ ok: true, deleted });
}

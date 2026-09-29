import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/server/env";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

/**
 * nginx streams file uploads straight to the Go upload server, so they never
 * reach this app's middleware. Before sending a body there, nginx asks this
 * route (`auth_request`): the session is checked against the database, so a
 * logged-out or revoked cookie is refused, and demo mode blocks uploads like
 * every other write. A 2xx lets the upload through; 401 and 403 go back to the
 * visitor.
 */
export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  if (serverEnv.DEMO_MODE) {
    return NextResponse.json(
      { error: "This action is not available in demo mode." },
      { status: 403 },
    );
  }

  return new NextResponse(null, { status: 204 });
}

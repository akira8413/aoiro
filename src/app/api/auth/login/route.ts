import { NextResponse } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/aoiro/auth";

export async function POST(req: Request) {
  const configured = process.env.APP_SECRET || "";
  if (!configured) {
    return NextResponse.json({ error: "APP_SECRET is not configured" }, { status: 503 });
  }

  const { secret } = await req.json();
  if (secret !== configured) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const cookieSecure =
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" && forwardedProto === "https");
  res.cookies.set(AUTH_COOKIE, sessionToken(configured), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

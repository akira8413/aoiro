import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_FILE = /\.(.*)$/;
const AUTH_COOKIE = "aoiro_auth";

async function sessionToken(secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("aoiro-session-v1"));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (!secret) {
    return new NextResponse("APP_SECRET is not configured", { status: 503 });
  }

  const auth = req.headers.get("authorization");
  const hasBearer = auth === `Bearer ${secret}`;
  const hasCookie = req.cookies.get(AUTH_COOKIE)?.value === await sessionToken(secret);
  if (hasBearer || hasCookie) return NextResponse.next();

  if (pathname === "/login" || pathname === "/api/auth/login") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

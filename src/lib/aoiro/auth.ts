import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "aoiro_auth";

export function sessionToken(secret: string) {
  return createHmac("sha256", secret).update("aoiro-session-v1").digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function configuredSecret() {
  return process.env.APP_SECRET || "";
}

export function isAuthEnabled() {
  return configuredSecret().length > 0;
}

export function isAuthorized(req: Request) {
  const secret = configuredSecret();
  if (!secret) return false;

  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && safeEqual(auth.slice("Bearer ".length), secret)) return true;

  const expectedCookie = sessionToken(secret);
  const cookie = req.headers.get("cookie") || "";
  return cookie.split(";").some((part) => {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== AUTH_COOKIE) return false;
    return safeEqual(decodeURIComponent(valueParts.join("=")), expectedCookie);
  });
}

export function unauthorizedJson() {
  if (!configuredSecret()) {
    return NextResponse.json({ error: "APP_SECRET is not configured" }, { status: 503 });
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

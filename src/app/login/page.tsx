"use client";

import { useState } from "react";

export default function LoginPage() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      setError("合言葉が違います");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="min-h-screen grid place-items-center bg-muted/30 px-4">
      <form onSubmit={login} className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">aoiro</h1>
          <p className="text-sm text-muted-foreground">合言葉を入力してください。</p>
        </div>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          入る
        </button>
      </form>
    </main>
  );
}

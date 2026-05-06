"use client";
import { usePrivy } from "@privy-io/react-auth";

export function LoginButton() {
  const { login, authenticated, logout, ready } = usePrivy();
  if (!ready) {
    return (
      <button disabled className="px-4 py-2 rounded bg-zinc-700 text-white opacity-50">
        Loading…
      </button>
    );
  }
  if (authenticated) {
    return (
      <button
        onClick={logout}
        className="px-4 py-2 rounded bg-zinc-700 text-white hover:bg-zinc-600"
      >
        Sign out
      </button>
    );
  }
  return (
    <button
      onClick={login}
      className="px-6 py-3 rounded bg-orange-600 text-white font-semibold hover:bg-orange-500"
    >
      Sign in
    </button>
  );
}
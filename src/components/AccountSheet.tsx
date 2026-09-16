"use client";

import { useState } from "react";
import type { useAccount } from "@/lib/useAccount";

type Account = ReturnType<typeof useAccount>;

/**
 * Sign in / account card. Email magic link today; Google and Apple buttons
 * appear once those providers are configured (NEXT_PUBLIC_AUTH_PROVIDERS).
 */
const PROVIDERS = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s): s is "google" | "apple" => s === "google" || s === "apple");

export default function AccountSheet({ account, onClose }: { account: Account; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [handle, setHandle] = useState(account.profile?.handle ?? "");
  const [handleMsg, setHandleMsg] = useState<string | null>(null);

  async function sendLink() {
    if (!email.includes("@")) {
      setErr("Enter your email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await account.signInWithEmail(email);
    setBusy(false);
    if (error) setErr(error);
    else setSent(true);
  }

  async function saveHandle() {
    const { error } = await account.setHandle(handle);
    setHandleMsg(error ?? "Saved");
  }

  return (
    <div
      data-vr-account
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        className="vr-glow-edge w-full max-w-sm rounded-2xl bg-vr-panel p-4 text-vr-text shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {account.session ? (
          <>
            <h2 className="text-lg font-bold leading-tight">Your account</h2>
            <p className="mb-4 text-xs text-vr-muted">{account.email}</p>

            <label className="mb-1 block text-xs font-semibold text-vr-text-2">Handle</label>
            <div className="flex gap-2">
              <input
                value={handle}
                onChange={(e) => { setHandle(e.target.value); setHandleMsg(null); }}
                placeholder="viper"
                maxLength={20}
                className="min-w-0 flex-1 rounded-lg bg-vr-panel-2 px-3 py-2 text-sm outline-none ring-emerald-400/40 focus:ring-2"
              />
              <button onClick={saveHandle} className="rounded-lg bg-vr-panel-2 px-3 py-2 text-sm font-semibold hover:bg-vr-panel-3">
                Save
              </button>
            </div>
            {handleMsg && <p className="mt-1 text-xs text-vr-muted">{handleMsg}</p>}
            <p className="mt-2 text-xs text-vr-muted">
              Friends will find you by handle (coming soon). Your avatar and {account.favorites.length}{" "}
              favorite{account.favorites.length === 1 ? "" : "s"} are synced to this account.
            </p>

            <div className="mt-4 flex items-center justify-between">
              <button onClick={account.signOut} className="text-xs text-vr-muted hover:text-vr-text">
                Sign out
              </button>
              <button onClick={onClose} className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black">
                Done
              </button>
            </div>
          </>
        ) : sent ? (
          <>
            <h2 className="text-lg font-bold leading-tight">Check your email</h2>
            <p className="mt-1 text-sm text-vr-text-2">
              We sent a sign-in link to <span className="font-semibold">{email}</span>. Open it on this device and you&apos;re in.
            </p>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-bold text-black">
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold leading-tight">Sign in</h2>
            <p className="mb-3 text-xs text-vr-muted">
              Optional. Keeps your avatar and favorite stations on every device — friends and messages come next.
            </p>
            {PROVIDERS.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {PROVIDERS.includes("apple") && (
                  <button onClick={() => account.signInWithProvider("apple")} className="rounded-lg bg-white py-2 text-sm font-semibold text-black">
                     Continue with Apple
                  </button>
                )}
                {PROVIDERS.includes("google") && (
                  <button onClick={() => account.signInWithProvider("google")} className="rounded-lg bg-vr-panel-2 py-2 text-sm font-semibold hover:bg-vr-panel-3">
                    Continue with Google
                  </button>
                )}
                <p className="text-center text-[11px] text-vr-dim">or</p>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                data-vr-account-email
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendLink()}
                placeholder="you@example.com"
                className="min-w-0 flex-1 rounded-lg bg-vr-panel-2 px-3 py-2 text-sm outline-none ring-emerald-400/40 focus:ring-2"
              />
              <button
                onClick={sendLink}
                disabled={busy}
                data-vr-account-send
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-black disabled:opacity-50"
              >
                {busy ? "…" : "Email me a link"}
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="text-sm text-vr-muted hover:text-vr-text">Not now</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

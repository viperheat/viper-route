"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { accountsEnabled, supabase } from "@/lib/supabase/client";
import { isValidAvatar, type Avatar } from "@/lib/avatar";

/**
 * Optional account layer (Phase 6). Everything works signed-out; signing in
 * syncs your avatar and favorite stations across devices.
 */
export type Profile = { id: string; handle: string | null; avatar: Avatar | null };

export function useAccount() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [ready, setReady] = useState(!accountsEnabled);

  // Session tracking.
  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    let cancelled = false;
    sb.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setReady(true);
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load profile + favorites when signed in.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    const sb = supabase();
    let cancelled = false;
    async function load() {
      if (!sb || !userId) {
        setProfile(null);
        setFavorites([]);
        return;
      }
      const [{ data: p }, { data: f }] = await Promise.all([
        sb!.from("profiles").select("id, handle, avatar").eq("id", userId).maybeSingle(),
        sb!.from("favorites").select("station_id").eq("user_id", userId),
      ]);
      if (cancelled) return;
      setProfile(
        p ? { id: p.id, handle: p.handle, avatar: isValidAvatar(p.avatar) ? p.avatar : null } : { id: userId!, handle: null, avatar: null }
      );
      setFavorites((f ?? []).map((r) => r.station_id as string));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signInWithEmail = useCallback(async (email: string) => {
    const sb = supabase();
    if (!sb) return { error: "Accounts aren't set up yet." };
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    return { error: error?.message ?? null };
  }, []);

  const signInWithProvider = useCallback(async (provider: "google" | "apple") => {
    const sb = supabase();
    if (!sb) return;
    await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }, []);

  const signOut = useCallback(async () => {
    await supabase()?.auth.signOut();
    setSession(null);
  }, []);

  const saveAvatarToProfile = useCallback(
    async (avatar: Avatar | null) => {
      const sb = supabase();
      if (!sb || !userId) return;
      await sb.from("profiles").upsert({ id: userId, avatar });
      setProfile((p) => (p ? { ...p, avatar } : p));
    },
    [userId]
  );

  const setHandle = useCallback(
    async (handle: string) => {
      const sb = supabase();
      if (!sb || !userId) return { error: "Not signed in." };
      const h = handle.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(h)) return { error: "3–20 letters, numbers or _" };
      const { error } = await sb.from("profiles").upsert({ id: userId, handle: h });
      if (error) return { error: error.code === "23505" ? "That handle is taken." : error.message };
      setProfile((p) => (p ? { ...p, handle: h } : p));
      return { error: null };
    },
    [userId]
  );

  const toggleFavorite = useCallback(
    async (stationId: string) => {
      const sb = supabase();
      if (!sb || !userId) return;
      if (favorites.includes(stationId)) {
        setFavorites((f) => f.filter((s) => s !== stationId));
        await sb.from("favorites").delete().eq("user_id", userId).eq("station_id", stationId);
      } else {
        setFavorites((f) => [...f, stationId]);
        await sb.from("favorites").upsert({ user_id: userId, station_id: stationId });
      }
    },
    [userId, favorites]
  );

  return {
    enabled: accountsEnabled,
    ready,
    session,
    email: session?.user.email ?? null,
    profile,
    favorites,
    signInWithEmail,
    signInWithProvider,
    signOut,
    saveAvatarToProfile,
    setHandle,
    toggleFavorite,
  };
}

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Magic-link / OAuth return: exchange the one-time code for a session cookie,
// then send the user back to the map.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const redirect = NextResponse.redirect(new URL(next, url.origin));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!code || !supabaseUrl || !anon) return redirect;

  const supabase = createServerClient(supabaseUrl, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) redirect.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.exchangeCodeForSession(code);
  return redirect;
}

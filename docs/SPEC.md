# NYC Transit App — Spec & Build Plan

*A live map that finds you and shows the trains and buses arriving near you — built to be free to run at the start and to leave room for fun features later.*

Working name: **(pick one later — placeholder: "NearTrain")**
Owner: Viper · Last updated: 2026-09-15

---

## 1. The one-paragraph vision

A web app anyone can open on their phone that instantly shows a map centered on where they are, with the nearest subway stations and bus stops and **live** "next arrival" times pulled straight from the MTA. No login needed to use it. It should feel fast, clean, and a little playful — with custom-drawn train/bus markers and room to bolt on extras (turn-by-turn directions, a snake minigame that runs on the streets while you wait). Cheap-to-free to run while it's small, with a clear path to paid hosting only if real traffic shows up.

---

## 2. How we're building it (the method)

We follow **spec-driven development**: this document is the source of truth. We decide *what* and *why* here, then build in small, testable slices. Each slice ends with something you can actually see working in a browser before we move on. You'll understand each piece as we go, because you're going to own this codebase.

**The four phases, repeated per feature:** Spec → Plan → small Tasks → Build & verify.

---

## 3. What counts as "v1 is live" (the finish line)

v1 is done when a stranger can open the public URL on their phone and:

1. The page loads and asks to use their location.
2. A map appears, centered on them, with a marker for where they are.
3. Nearby subway stations show up as markers.
4. Tapping a station shows the **live** next few arrivals (line + direction + minutes away).
5. It works on a phone screen, and the URL is public (not just on your laptop).

**Acceptance criteria (the checklist we test against):**

- [ ] Loads in under ~3 seconds on a phone connection.
- [ ] Handles "user denied location" gracefully (falls back to a default center, e.g. Midtown, with a "search/enter location" option).
- [ ] Live arrival times refresh automatically (every ~30s) without a manual reload.
- [ ] Shows a clear "data may be delayed" / last-updated stamp so it's never silently stale.
- [ ] Doesn't crash when the MTA feed is momentarily down — shows a friendly message.
- [ ] Anyone with the link can use it (deployed, public HTTPS URL).

**Explicitly NOT in v1** (so we don't sprawl): buses, directions, accounts/login, saved favorites, the minigame. All planned below — just not blocking the first launch.

---

## 4. Feature backlog (what comes after v1)

Ordered roughly by value-for-effort. We'll re-prioritize as you use it.

**Phase 2 — Buses.** Register for a free MTA Bus Time API key, add bus stops + live bus arrivals to the same map. (Buses are a separate feed with a key, which is why they're not in v1.)

**Phase 3 — Custom graphics.** Replace default pins with custom-drawn markers: MTA-style line "bullets" (the colored circles), a distinct bus icon, your own "you are here" marker, and an app logo/favicon. These we generate ourselves.

**Phase 4 — Directions.** "Get me from A to B" — type/tap a destination, get a transit route with which line to take and where to transfer. Bigger lift; likely uses a routing service.

**Phase 5 — The fun layer.** The snake minigame that plays over the street grid while you wait — snake follows the streets, food spawns at nearby stops. This is the "shareable/wow" feature and a good reason to keep the architecture modular from day one.

**Later ideas parking lot:** saved favorite stops, service-alert banners (delays/reroutes), dark mode, "notify me when my train is 5 min away," step-free/accessibility filter, a shareable "my commute" link.

**Phase 6 — Accounts & social.** Sign in with Apple or Google (Supabase Auth), add friends, save favorite stations, and maybe send short messages ("on the 2, be there in 8"). Needs the database layer, so it comes after the free-tier-only features above.

---

## 5. The stack (and plain-language why)

Everything here has a real free tier and is beginner-friendly with strong docs.

| Layer | Choice | Why (plain language) |
|---|---|---|
| **Language/Framework** | **Next.js** (React) | The most popular way to build a web app in 2026. It's a website *and* a tiny backend in one project, so we can fetch MTA data server-side without extra setup. Best docs, one-click free deploy. |
| **Map** | **MapLibre GL JS** + **OpenFreeMap** tiles | MapLibre is a free, modern map engine (smooth zoom, custom markers). OpenFreeMap gives us the actual map imagery for free with no key and no usage cap — ideal while we're small. |
| **Your location** | Browser **Geolocation API** | Built into every phone browser, free, no library. |
| **Live train data** | MTA **subway GTFS-realtime** feed | Free, **no API key**. We fetch it in a Next.js server function, translate it, and hand clean data to the map. |
| **Live bus data (Phase 2)** | MTA **Bus Time** feed | Free but needs a quick key registration. Added after v1. |
| **Station/stop locations** | MTA **static GTFS** (schedule) data | The list of every stop and its exact coordinates, so we know what's "near you." Downloaded once, bundled with the app. |
| **Hosting** | **Vercel** (Hobby / free) | Made by the Next.js team; push to GitHub and it deploys itself to a public HTTPS URL. Free for a project this size. |
| **Database** | **None in v1**, then **Supabase** (free) when needed | v1 has no accounts — all data is live from MTA, so no database needed yet. When we add favorites/logins (later), Supabase's free tier covers it. Not paying for what we don't use. |
| **Code lives on** | Your Mac + **GitHub** | Real repo you own. GitHub is the backup + what Vercel deploys from. |

**Why this is the "not-behind" stack:** it's the boring, proven, well-documented path — exactly what you want for your first ship. The AI-tooling churn on Twitter is mostly about *how* people write the code (agents, editors), not *what* the app is made of. We keep the app on solid ground and use agents (me, plus Claude Code / Cursor on your Mac) to move fast within it.

---

## 6. How the data flows (the architecture, simply)

```
   Your phone browser
        │  1. "Where am I?" (Geolocation API)
        ▼
   The app (Next.js on Vercel)
        │  2. "Give me arrivals near these coordinates"
        ▼
   App's own server function ──3. fetches──► MTA subway realtime feed (no key)
        │                                          │
        │  ◄──────────── raw feed (protobuf) ──────┘
        │  4. translates raw feed → clean JSON (line, direction, minutes)
        ▼
   Map on screen (MapLibre + OpenFreeMap tiles)
        5. draws you + nearby stations + live arrival times, refreshes every ~30s
```

The one part worth naming: the MTA's live feed comes in a compact binary format called **protobuf**, not plain JSON. Our server function does the translating so the map only ever sees clean, simple data. A well-supported free library handles the decode — we don't write that from scratch.

**Built to leave room for features:** we keep the code in clear zones — `data/` (talking to MTA), `map/` (the map + markers), `features/` (self-contained add-ons like the minigame), and `ui/` (buttons, panels). New features drop into `features/` without touching the core map. This is what makes "push cool stuff down the line" cheap instead of painful.

---

## 7. Cost path (free now, cheap only if it takes off)

**Today → real users: $0/month.** Vercel Hobby + OpenFreeMap + MTA feeds + GitHub are all free at our scale. Domain name is optional (~$10–15/year) if you want a custom URL instead of the free `something.vercel.app` one.

**If it grows** (thousands of daily users, or you add logins/favorites):
- Vercel Pro (~$20/mo) or move to a cheap VPS if we outgrow free bandwidth.
- Supabase stays free until you have real account volume, then ~$25/mo.
- Map tiles stay free on OpenFreeMap; if we ever want fancier styles, MapTiler has a free tier too.

We cross those bridges only with evidence (real traffic), never preemptively.

---

## 8. Build roadmap (small slices, each ends with something you can see)

Each milestone is a "we can look at it working" checkpoint. I'll explain what and why at each step.

**M0 — Foundations (setup).**
Create the project folder + GitHub repo, install Next.js, get a blank app running on your Mac and auto-deploying to a public Vercel URL. *You see: a live "hello" page at a real URL.*

**M1 — A map on the screen.**
Add MapLibre + OpenFreeMap. *You see: a pannable NYC map, live on your URL.*

**M2 — Find me.**
Wire up geolocation; center the map on the user with a "you are here" marker; handle "location denied." *You see: the map jumps to your real location.*

**M3 — Stations near you.**
Load MTA static stop data; show nearby subway stations as markers. *You see: real station pins around you.*

**M4 — Live arrivals (the core).**
Build the server function that fetches + translates the subway realtime feed; tap a station → see live next arrivals; auto-refresh. *You see: real "downtown 2 train, 4 min" times.* **← this is v1 live.**

**M5 — Polish for launch.**
Loading states, error handling, mobile layout, last-updated stamp, basic branding. *You see: something you'd actually text to a friend.*

**Then:** Phase 2 buses → Phase 3 custom graphics → Phase 4 directions → Phase 5 snake. Each gets its own mini-spec when we reach it.

### v2 — "is this the best we can do?" (shipped so far: M6–M11)

Built after v1 went live. Order chosen for value-for-effort:

1. **M6/M6b — Dark map + Viper palette.** OpenFreeMap dark style recolored at runtime.
2. **M7 — Subway Snake.** Classic snake in a full-screen overlay, food = MTA line bullets.
3. **M8/M9 — Live train sprites.** Ghost trains interpolated along the real path from the realtime feed, with real-time physics, per-train memory across refreshes (glide instead of teleport), fade in/out, and a "Live trains on/off" toggle remembered per device.
4. **M10 — Responsive layout.** Phones keep the draggable bottom sheet; tablets/desktops (≥768px) get a docked left panel with the brand, toggle and arrivals, map fills the rest.
5. **M11 — Snake on the streets.** A small pixel snake in the corner of the map launches the game. The snake runs on Manhattan's real street grid (14th–24th St × 9th Ave–Park Ave S), drawn over the live map; intersections come from OpenStreetMap (`src/data/snake-grid.json`), the map rotates to the grid's 29° bearing (119° in portrait so the board fills a phone), and you can only turn north/south at an avenue.
6. **Avatar editor.** A circular pixel-sprite editor that replaces the "you are here" dot (saved on-device).
7. **Neon color pass.** Cooler palette + glow across UI and map.
8. **Race the Train.** Your walking/biking pace vs. the live train to the next stop.
9. **Colored subway lines on the map.** Static GTFS shapes → line layer (data task in Claude Code).
10. **Buses.** Needs a free MTA Bus Time key (owner registers).

---

## 9. Open decisions (we'll settle these as we hit them)

- App name + custom domain (or stick with the free Vercel URL for now).
- Subway-line coverage for v1: all lines, or start with a couple to keep it simple? (Recommendation: all — it's the same amount of work.)
- Marker style direction for Phase 3 (authentic MTA-style bullets vs. our own look).

---

## 10. Key references

- MTA developer resources & feeds: https://www.mta.info/developers
- MTA real-time data feeds portal: https://api.mta.info/
- MTA static subway schedule (GTFS): https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
- Next.js: https://nextjs.org · MapLibre: https://maplibre.org · OpenFreeMap: https://openfreemap.org
- Free hosting: https://vercel.com · Free DB (later): https://supabase.com

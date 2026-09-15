export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-lg font-black text-black">
          VR
        </span>
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Viper Route</h1>
      </div>

      <p className="max-w-md text-base text-neutral-400 sm:text-lg">
        Live NYC trains and buses, on a map that finds you.
      </p>

      <div className="rounded-full border border-neutral-700 px-4 py-1.5 text-sm text-neutral-400">
        v1 in progress · next up: the map
      </div>
    </main>
  );
}

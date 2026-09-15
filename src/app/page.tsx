import MapView from "@/components/MapView";

export default function Home() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <MapView />

      <header className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-neutral-950/80 px-3 py-2 text-neutral-100 shadow-lg backdrop-blur">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-black text-black">
          VR
        </span>
        <span className="text-sm font-bold">Viper Route</span>
      </header>
    </main>
  );
}

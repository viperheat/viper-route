import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viper Route — live NYC trains & buses",
  description: "A map that finds you and shows the trains and buses arriving near you.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">
        <Script
          src="https://unpkg.com/maplibre-gl@6.9.1/dist/maplibre-gl.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}

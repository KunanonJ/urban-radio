import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { PwaServiceWorkerRegistrar } from "@/components/PwaServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "Sonic Bloom",
  description: "Music library and playback — Next.js + Firebase migration",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-ui-theme="oled" data-accent="green" suppressHydrationWarning>
      <body className="min-h-[100dvh] font-sans antialiased">
        <AppProviders>{children}</AppProviders>
        <PwaServiceWorkerRegistrar />
      </body>
    </html>
  );
}

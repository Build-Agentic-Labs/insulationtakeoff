import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Insulation Takeoff & Quote Workspace",
  description: "Construction takeoff and insulation quote workspace for insulation contractors",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
        <div className="flex min-h-screen bg-[var(--takeoff-paper)]">
          <Sidebar />
          <main className="min-h-screen min-w-0 flex-1 bg-[var(--takeoff-paper)] transition-all duration-300">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

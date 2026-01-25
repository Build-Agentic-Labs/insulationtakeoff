import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "InsulateQuote - AI-Powered Insulation Quotes",
  description: "AI-powered insulation quote generator from architectural PDFs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen flex">
          <Sidebar />
          <main className="flex-1 ml-64 transition-all duration-300 bg-zinc-50 dark:bg-zinc-900 min-h-screen">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

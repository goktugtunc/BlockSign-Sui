import type { Metadata } from "next";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "./providers"; // 👈 yeni dosyayı buradan import edeceğiz

export const metadata: Metadata = {
  title: "BlockSign – AI-assisted Sui e-sign platform",
  description: "Generate, sign and verify contracts with low fees on Sui blockchain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}

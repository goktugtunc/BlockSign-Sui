"use client";

import { Suspense } from "react";
import "@mysten/dapp-kit/dist/index.css";
import { SuiClientProvider, WalletProvider as DappWalletProvider, createNetworkConfig } from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ThemeProvider } from "@/components/theme-provider";
import { WalletProvider } from "@/lib/wallet-context";
import { LanguageProvider } from "@/lib/language-context";
import { Toaster } from "@/components/ui/toaster";
import { Header } from "@/components/header";

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl("testnet") },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <DappWalletProvider autoConnect>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            <LanguageProvider>
              <WalletProvider>
                <Suspense fallback={null}>
                  <div className="min-h-screen bg-background">
                    <Header />
                    <main className="flex-1">{children}</main>
                  </div>
                  <Toaster />
                </Suspense>
              </WalletProvider>
            </LanguageProvider>
          </ThemeProvider>
        </DappWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

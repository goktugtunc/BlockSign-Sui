// lib/wallet-context.tsx
"use client";

import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  useCurrentAccount,
  useSuiClient,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from "@mysten/dapp-kit";

interface WalletState {
  isConnected: boolean;
  address: string | null;
  walletType: string | null;
  balance: number; // SUI
}

interface WalletContextType {
  wallet: WalletState;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // dApp Kit context’leri (app/providers.tsx içinde veriliyor)
  const suiClient = useSuiClient();
  const account = useCurrentAccount();

  // Yeni dApp Kit hook'ları:
  const wallets = useWallets();
  const { mutateAsync: connectMutation } = useConnectWallet();
  const { mutate: disconnectMutation } = useDisconnectWallet();

  const [wallet, setWallet] = useState<WalletState>({
    isConnected: false,
    address: null,
    walletType: null,
    balance: 0,
  });

  const connectWallet = async () => {
    // Tercihen Slush (Sui Wallet) seç, yoksa ilk cüzdan
    if (!wallets.length) throw new Error("Uygun cüzdan bulunamadı. (Slush/Sui Wallet yüklü mü?)");
    const preferred =
      wallets.find((w) => w?.name?.toLowerCase().includes("slush") || w?.name?.toLowerCase().includes("sui")) ||
      wallets[0];

    await connectMutation({ wallet: preferred });
    // walletType'ı hemen state'e yazma, currentAccount geldikten sonra set edilecek
  };

  const disconnectWallet = () => {
    disconnectMutation();
    setWallet({ isConnected: false, address: null, walletType: null, balance: 0 });
  };

  useEffect(() => {
    (async () => {
      if (!account?.address) {
        setWallet((w) => ({ ...w, isConnected: false, address: null, walletType: null, balance: 0 }));
        return;
      }

      // Cüzdan adını yakala
      const connected = wallets.find((w) => w.accounts?.some((a) => a.address === account.address));
      const walletName = connected?.name ?? "wallet";

      // SUI bakiyesi
      let balance = 0;
      try {
        const b = await suiClient.getBalance({ owner: account.address, coinType: "0x2::sui::SUI" });
        balance = Number(b.totalBalance) / 1_000_000_000;
      } catch {
        balance = 0;
      }

      setWallet({
        isConnected: true,
        address: account.address,
        walletType: walletName,
        balance,
      });
    })();
    // wallets da değiştiğinde yeniden değerlendir (cüzdan adı için)
  }, [account?.address, wallets, suiClient]);

  const value = useMemo<WalletContextType>(
    () => ({ wallet, connectWallet, disconnectWallet }),
    [wallet]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}

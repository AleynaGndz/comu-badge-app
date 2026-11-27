"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

// Next.js SSR hatasını önlemek için butonu dinamik yüklüyoruz
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function Home() {
  const { publicKey } = useWallet();

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <nav className="flex justify-between items-center max-w-4xl mx-auto pb-8 border-b border-slate-800">
        <h1 className="text-xl font-bold text-purple-400">ÇOMÜ Badge</h1>
        <WalletMultiButton />
      </nav>

      <div className="max-w-4xl mx-auto mt-12 text-center">
        {publicKey ? (
          <div className="p-6 bg-slate-900 rounded-xl border border-purple-500/30">
            <p className="text-green-400 font-semibold mb-2">Cüzdan Başarıyla Bağlandı!</p>
            <p className="text-sm text-slate-400 break-all">Adres: {publicKey.toBase58()}</p>
          </div>
        ) : (
          <p className="text-slate-400">Rozetlerini görmek için sağ üstten Phantom cüzdanını bağla.</p>
        )}
      </div>
    </main>
  );
}
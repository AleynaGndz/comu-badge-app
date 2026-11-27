"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { Award, CheckCircle, Loader2 } from "lucide-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function ClaimContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event") || "genel-etkinlik";
  const eventName = searchParams.get("name") || "ÇOMÜ Teknoloji Etkinliği";

  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const handleClaimBadge = async () => {
    if (!publicKey) return;
    setLoading(true);

    try {
      // Kişi 1 backend API'yi hazırladığında buraya gerçek fetch('/api/mint') gelecek
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setClaimed(true);
    } catch (error) {
      console.error("Rozet basma hatası:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
      <div className="w-16 h-16 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mx-auto mb-4">
        <Award className="w-8 h-8" />
      </div>

      <span className="text-xs uppercase tracking-wider text-purple-400 font-semibold">
        Etkinlik Katılım Rozeti (cNFT)
      </span>
      <h1 className="text-2xl font-bold mt-1 mb-2">{eventName}</h1>
      <p className="text-slate-400 text-sm mb-6">
        Katılımını Solana blokzincirine kaydet ve sponsor indirimlerinin kilidini aç.
      </p>

      <div className="flex justify-center mb-6">
        <WalletMultiButton />
      </div>

      {publicKey && !claimed && (
        <button
          onClick={handleClaimBadge}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Rozet Cüzdana Basılıyor...</span>
            </>
          ) : (
            <span>Rozetimi Ücretsiz Al</span>
          )}
        </button>
      )}

      {claimed && (
        <div className="p-4 bg-green-950/50 border border-green-500/40 rounded-xl text-green-400">
          <CheckCircle className="w-6 h-6 mx-auto mb-1" />
          <p className="font-semibold text-sm">Rozet Cüzdanına Gönderildi!</p>
          <p className="text-xs text-slate-400 mt-1">Etkinlik Kodu: {eventId}</p>
        </div>
      )}
    </div>
  );
}

export default function ClaimPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
      <Suspense fallback={<p className="text-slate-400">Yükleniyor...</p>}>
        <ClaimContent />
      </Suspense>
    </main>
  );
}
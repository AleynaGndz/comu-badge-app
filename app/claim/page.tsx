"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Award, CheckCircle, Loader2, ExternalLink, AlertCircle, ArrowLeft } from "lucide-react";

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
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClaimBadge = async () => {
    if (!publicKey) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          eventId: eventId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Rozet basma işlemi başarısız oldu.");
      }

      setTxSignature(data.txSignature || null);
      setClaimed(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Bir hata oluştu.";
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
      <div className="flex justify-start mb-4">
        <Link href="/" className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Ana Sayfa</span>
        </Link>
      </div>

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

      {errorMsg && (
        <div className="mb-4 p-3 bg-red-950/50 border border-red-500/40 rounded-xl text-red-400 text-xs flex items-center gap-2 text-left">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {publicKey && !claimed && (
        <button
          onClick={handleClaimBadge}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>cNFT Cüzdana Basılıyor...</span>
            </>
          ) : (
            <span>Rozetimi Ücretsiz Al</span>
          )}
        </button>
      )}

      {claimed && (
        <div className="p-4 bg-green-950/50 border border-green-500/40 rounded-xl text-green-400 space-y-2">
          <CheckCircle className="w-6 h-6 mx-auto" />
          <p className="font-semibold text-sm">cNFT Rozet Cüzdanına Gönderildi!</p>
          <p className="text-xs text-slate-400">Etkinlik Kodu: {eventId}</p>
          {txSignature && (
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 underline pt-1"
            >
              <span>Solana Explorer&apos;da İncele</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
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
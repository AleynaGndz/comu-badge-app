"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Award, CheckCircle2, Loader2, ArrowLeft, ExternalLink, AlertCircle } from "lucide-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function ClaimContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event") || "";
  const eventName = searchParams.get("name") || "ÇOMÜ Topluluk Etkinliği";
  const qrToken = searchParams.get("token") || "";

  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClaimBadge = async () => {
    if (!publicKey) return;
    if (!eventId || !qrToken) {
      setErrorMsg("Geçersiz veya eksik QR token bilgisi. Lütfen etkinlik QR kodunu tekrar okutun.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          eventId,
          qrToken,
        }),
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("cNFT basma servisi (/api/claim) henüz backend tarafında aktif edilmedi.");
      }

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
    <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-xl">
      <div className="text-left mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-purple-400 transition"
        >
          <ArrowLeft className="w-4 h-4" />
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

      {!publicKey ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-slate-400">Devam etmek için Solana cüzdanını bağla:</p>
          <WalletMultiButton />
        </div>
      ) : claimed ? (
        <div className="p-4 bg-green-950/60 border border-green-500/40 rounded-xl space-y-3">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
          <h2 className="font-bold text-green-400">Rozet Cüzdanına Gönderildi!</h2>
          <p className="text-xs text-slate-300">
            Solana Devnet üzerinde cNFT rozetin başarıyla oluşturuldu.
          </p>
          {txSignature && (
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200 underline"
            >
              <span>Solana Explorer&apos;da Görüntüle</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-center">
            <WalletMultiButton />
          </div>

          {!qrToken && (
            <div className="p-3 bg-amber-950/50 border border-amber-500/40 rounded-lg text-xs text-amber-300 flex items-center justify-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>QR token eksik — lütfen yönetim panelindeki QR kodu okutun.</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-950/50 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center justify-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            onClick={handleClaimBadge}
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>cNFT Basılıyor...</span>
              </>
            ) : (
              <span>Rozetimi Ücretsiz Al</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ClaimPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <Suspense fallback={<div className="text-slate-400 text-sm">Yükleniyor...</div>}>
        <ClaimContent />
      </Suspense>
    </main>
  );
}
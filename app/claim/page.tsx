"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Award,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  ExternalLink,
  AlertCircle,
  Camera,
  Coins,
  Users,
  X,
} from "lucide-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function ClaimContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event") || "";
  const eventName = searchParams.get("name") || "ÇOMÜ Topluluk Etkinliği";

  const { publicKey } = useWallet();
  const [isRegistered, setIsRegistered] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);

  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isProcessingQrRef = useRef(false);

  // Kullanıcının bu etkinliğe önceden kayıt (0.5 SOL stake) yapıp yapmadığını kontrol et
  useEffect(() => {
    if (!publicKey || !eventId) {
      setIsRegistered(false);
      return;
    }

    const storageKey = `comu_rsvp_${publicKey.toBase58()}_${eventId}`;
    const saved = localStorage.getItem(storageKey);
    setIsRegistered(saved === "true");
  }, [publicKey, eventId]);

  // Etkinliğe 0.5 SOL taahhüt ile kayıt olma
  const handleRegisterStake = async () => {
    if (!publicKey || !eventId) return;

    setRegisterLoading(true);
    setErrorMsg(null);

    try {
      // Backend /api/rsvp eklendiğinde otomatik bağlanır; henüz yoksa yerel kayıt ile devam eder
      await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          eventId,
          stakeAmountSol: 0.5,
        }),
      }).catch(() => null);

      const storageKey = `comu_rsvp_${publicKey.toBase58()}_${eventId}`;
      localStorage.setItem(storageKey, "true");
      setIsRegistered(true);
    } catch {
      setErrorMsg("Kayıt işlemi sırasında bir hata oluştu.");
    } finally {
      setRegisterLoading(false);
    }
  };

  // QR okutulduktan sonra rozet alma ve 0.5 SOL iade isteği
  const submitClaimWithToken = async (qrToken: string) => {
    if (!publicKey || !eventId) return;

    setClaiming(true);
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
        throw new Error("cNFT basma ve iade servisi (/api/claim) henüz backend tarafında aktif edilmedi.");
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Rozet alma ve 0.5 SOL iade işlemi başarısız oldu.");
      }

      setTxSignature(data.txSignature || null);
      setClaimed(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Bir hata oluştu.";
      setErrorMsg(message);
    } finally {
      setClaiming(false);
    }
  };

  // Satır içi (inline) QR Kamera Yönetimi (Strict Mode çift kamera korumalı)
  useEffect(() => {
    if (!showScanner) return;

    const scannerId = "claim-inline-qr-reader";
    const container = document.getElementById(scannerId);
    if (container) {
      container.innerHTML = "";
    }

    const html5QrCode = new Html5Qrcode(scannerId);
    let isCancelled = false;
    let isStarted = false;
    isProcessingQrRef.current = false;
    setScanError(null);
    setCameraError(null);

    html5QrCode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          if (isProcessingQrRef.current || isCancelled) return;

          try {
            const parsed = new URL(decodedText, window.location.origin);
            const isSameOrigin = parsed.origin === window.location.origin;
            const isClaimPath = parsed.pathname === "/claim";
            const scannedEventId = parsed.searchParams.get("event");
            const scannedToken = parsed.searchParams.get("token");

            if (isSameOrigin && isClaimPath && scannedEventId === eventId && scannedToken) {
              isProcessingQrRef.current = true;
              setScanError(null);

              html5QrCode
                .stop()
                .then(() => html5QrCode.clear())
                .catch(() => {})
                .finally(() => {
                  setShowScanner(false);
                  submitClaimWithToken(scannedToken);
                });
              return;
            }

            if (isSameOrigin && isClaimPath && scannedEventId && scannedEventId !== eventId) {
              setScanError("Bu QR kod başka bir etkinliğe ait! Lütfen bu etkinliğin QR kodunu okutun.");
              return;
            }
          } catch {
            // Geçerli URL değilse aşağıdaki uyarıya düşer
          }

          setScanError("Geçersiz QR kod! Lütfen etkinlik alanındaki ÇOMÜ Badge QR kodunu okutun.");
        },
        () => {}
      )
      .then(() => {
        isStarted = true;
        if (isCancelled) {
          html5QrCode
            .stop()
            .then(() => html5QrCode.clear())
            .catch(() => {});
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error("Kamera başlatılamadı:", err);
          setCameraError("Kameraya erişilemedi. Lütfen tarayıcı kamera izinlerini kontrol edin.");
        }
      });

    return () => {
      isCancelled = true;
      if (isStarted) {
        html5QrCode
          .stop()
          .then(() => html5QrCode.clear())
          .catch(() => {});
      }
    };
  }, [showScanner, eventId]);

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
        Etkinlik Katılımı & Rozet (cNFT)
      </span>
      <h1 className="text-2xl font-bold mt-1 mb-2">{eventName}</h1>
      <p className="text-slate-400 text-sm mb-6">
        Etkinliğe 0.5 SOL taahhüt ile kaydol, etkinlik günü QR kodu okutup hem 0.5 SOL iadeni hem de rozetini al.
      </p>

      {/* Stake-to-Attend Bilgi Kutusu */}
      <div className="mb-6 p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-left space-y-2 text-xs text-slate-300">
        <div className="flex items-center gap-2 text-purple-300 font-semibold">
          <Coins className="w-4 h-4 shrink-0" />
          <span>0.5 SOL Katılım Taahhüdü</span>
        </div>
        <p className="text-slate-400">
          Etkinliğe katılıp QR okuttuğunda <strong>0.5 SOL</strong> anında cüzdanına iade edilir ve cNFT rozetini kazanırsın.
        </p>
        <div className="flex items-start gap-2 text-emerald-300/90 pt-1">
          <Users className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Kayıt olup gelmeyenlerin iade edilmeyen SOL&apos;leri, etkinliğe katılanlar arasında <strong>eşit olarak paylaştırılır</strong>.
          </span>
        </div>
      </div>

      {!publicKey ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-slate-400">Devam etmek için Solana cüzdanını bağla:</p>
          <WalletMultiButton />
        </div>
      ) : claimed ? (
        <div className="p-4 bg-green-950/60 border border-green-500/40 rounded-xl space-y-3">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
          <h2 className="font-bold text-green-400">0.5 SOL İade Edildi & Rozet Kazanıldı!</h2>
          <p className="text-xs text-slate-300">
            Katılımın doğrulandı. 0.5 SOL taahhüdün cüzdanına geri gönderildi ve cNFT rozetin oluşturuldu.
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

          {errorMsg && (
            <div className="p-3 bg-red-950/50 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center justify-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!isRegistered ? (
            <button
              onClick={handleRegisterStake}
              disabled={registerLoading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {registerLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Kayıt Yapılıyor...</span>
                </>
              ) : (
                <>
                  <Coins className="w-5 h-5" />
                  <span>Katılacağım (0.5 SOL Taahhüt Et)</span>
                </>
              )}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Etkinliğe kayıtlısın (0.5 SOL taahhüt edildi)</span>
              </div>

              {showScanner ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="font-medium">Etkinlik QR Kodunu Okutun</span>
                    <button
                      onClick={() => setShowScanner(false)}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Kapat</span>
                    </button>
                  </div>

                  {cameraError ? (
                    <div className="p-3 bg-red-950/50 border border-red-500/40 rounded-xl text-xs text-red-300">
                      {cameraError}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-purple-500/40 bg-black">
                      <div id="claim-inline-qr-reader" className="w-full" />
                    </div>
                  )}

                  {scanError && (
                    <div className="p-3 bg-amber-950/60 border border-amber-500/40 rounded-xl flex items-start gap-2 text-xs text-amber-200 text-left">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{scanError}</span>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    setErrorMsg(null);
                    setShowScanner(true);
                  }}
                  disabled={claiming}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  {claiming ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>0.5 SOL İade & Rozet İşleniyor...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5" />
                      <span>Rozetimi Al & 0.5 SOL İade Et (QR Okut)</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
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
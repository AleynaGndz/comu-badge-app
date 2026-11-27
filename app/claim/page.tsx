"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
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
  Clock,
  RefreshCw,
  Sparkles,
} from "lucide-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

interface EventDetail {
  id: string;
  title: string;
  description?: string;
  event_date: string;
}

const REQUIRED_STAKE_SOL = 0.5;

function ClaimContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event") || "";
  const paramEventName = searchParams.get("name") || "ÇOMÜ Topluluk Etkinliği";
  const urlToken = searchParams.get("token") || "";

  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const walletAddress = publicKey ? publicKey.toBase58() : "";

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);

  const [activeToken, setActiveToken] = useState<string>(urlToken);
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [claiming, setClaiming] = useState(false);
  const [processingChain, setProcessingChain] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canRetryFailed, setCanRetryFailed] = useState(false);

  const isProcessingQrRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!eventId) return;

    fetch("/api/events")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.events)) {
          const found = data.events.find((ev: EventDetail) => String(ev.id) === String(eventId));
          if (found) {
            setEventDetail(found);
          }
        }
      })
      .catch(() => {});
  }, [eventId]);

  // Cüzdanın Solana Devnet bakiyesini çek
  useEffect(() => {
    if (!publicKey) {
      setSolBalance(null);
      return;
    }

    let cancelled = false;
    setBalanceLoading(true);

    connection
      .getBalance(publicKey)
      .then((lamports) => {
        if (!cancelled) {
          setSolBalance(lamports / LAMPORTS_PER_SOL);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSolBalance(0);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBalanceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  // Cüzdan veya etkinlik değiştiğinde tüm claim/sonuç durumlarını sıfırla
  useEffect(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    setClaiming(false);
    setProcessingChain(false);
    setClaimed(false);
    setTxSignature(null);
    setAssetId(null);
    setErrorMsg(null);
    setCanRetryFailed(false);
    setShowScanner(false);
    setActiveToken(urlToken);

    if (!walletAddress || !eventId) {
      setIsRegistered(false);
      setIsAuthenticated(false);
      return;
    }

    const storageKey = `comu_rsvp_${walletAddress}_${eventId}`;
    setIsRegistered(localStorage.getItem(storageKey) === "true");

    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user?.wallet_address === walletAddress) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      })
      .catch(() => setIsAuthenticated(false));
  }, [walletAddress, eventId, urlToken]);

  const eventStartMs = eventDetail?.event_date ? new Date(eventDetail.event_date).getTime() : null;
  const windowOpenMs = eventStartMs !== null ? eventStartMs - 15 * 60 * 1000 : null;
  const windowCloseMs = eventStartMs !== null ? eventStartMs + 2 * 60 * 60 * 1000 : null;

  const isBeforeWindow = windowOpenMs !== null && nowTs < windowOpenMs;
  const isAfterWindow = windowCloseMs !== null && nowTs > windowCloseMs;
  const isAttendanceOpen = !isBeforeWindow && !isAfterWindow;

  const hasEnoughSol = solBalance !== null && solBalance >= REQUIRED_STAKE_SOL;

  // Etkinliğe 0.5 SOL taahhüt ile ön kayıt olma (bakiye kontrolü ile)
  const handleRegisterStake = async () => {
    if (!walletAddress || !eventId) return;

    if (solBalance === null || solBalance < REQUIRED_STAKE_SOL) {
      setErrorMsg(
        `Yetersiz Bakiye: Etkinliğe kayıt olmak için cüzdanınızda en az ${REQUIRED_STAKE_SOL} SOL bulunmalıdır (Mevcut bakiye: ${(
          solBalance ?? 0
        ).toFixed(4)} SOL).`
      );
      return;
    }

    setRegisterLoading(true);
    setErrorMsg(null);

    try {
      const storageKey = `comu_rsvp_${walletAddress}_${eventId}`;
      localStorage.setItem(storageKey, "true");
      setIsRegistered(true);
    } catch {
      setErrorMsg("Kayıt işlemi sırasında bir hata oluştu.");
    } finally {
      setRegisterLoading(false);
    }
  };

  const submitClaim = useCallback(
    async (qrTokenToUse: string, retryFailed = false) => {
      if (!walletAddress || !eventId) return;

      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }

      setClaiming(true);
      setErrorMsg(null);
      setCanRetryFailed(false);

      try {
        const response = await fetch("/api/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: eventId,
            qr_token: qrTokenToUse,
            walletAddress,
            ...(retryFailed ? { retry_failed: true } : {}),
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!isMountedRef.current) return;

        if (response.status === 202 || data.processing) {
          setProcessingChain(true);
          if (data.txSignature) {
            setTxSignature(data.txSignature);
          }

          const retryAfterSec = Number(response.headers.get("Retry-After")) || 3;
          pollTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              submitClaim(qrTokenToUse, false);
            }
          }, retryAfterSec * 1000);
          return;
        }

        if (response.ok && data.success) {
          setProcessingChain(false);
          setClaiming(false);
          setTxSignature(data.txSignature || null);
          setAssetId(data.assetId || null);
          setClaimed(true);
          return;
        }

        setProcessingChain(false);
        setClaiming(false);

        if (response.status === 401) {
          setIsAuthenticated(false);
          throw new Error("Rozet almadan önce ana sayfadan cüzdanınızı imzalayarak oturum açmalısınız.");
        }

        if (response.status === 409) {
          setCanRetryFailed(true);
        }

        throw new Error(data.message || "Rozet alma işlemi tamamlanamadı.");
      } catch (error: unknown) {
        if (!isMountedRef.current) return;
        setProcessingChain(false);
        setClaiming(false);
        const message = error instanceof Error ? error.message : "Bir hata oluştu.";
        setErrorMsg(message);
      }
    },
    [walletAddress, eventId]
  );

  useEffect(() => {
    if (
      urlToken &&
      walletAddress &&
      isAuthenticated === true &&
      !claimed &&
      !claiming &&
      !processingChain &&
      !errorMsg
    ) {
      submitClaim(urlToken, false);
    }
  }, [urlToken, walletAddress, isAuthenticated, claimed, claiming, processingChain, errorMsg, submitClaim]);

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
              setActiveToken(scannedToken);

              html5QrCode
                .stop()
                .then(() => html5QrCode.clear())
                .catch(() => {})
                .finally(() => {
                  setShowScanner(false);
                  submitClaim(scannedToken, false);
                });
              return;
            }

            if (isSameOrigin && isClaimPath && scannedEventId && scannedEventId !== eventId) {
              setScanError("Bu QR kod başka bir etkinliğe ait! Lütfen bu etkinliğin QR kodunu okutun.");
              return;
            }
          } catch {}

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
  }, [showScanner, eventId, submitClaim]);

  const displayTitle = eventDetail?.title || paramEventName;

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
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
        <h1 className="text-2xl font-bold mt-1 mb-2">{displayTitle}</h1>

        {eventDetail?.event_date && (
          <p className="text-xs text-purple-300/90 mb-3">
            Etkinlik Zamanı:{" "}
            {new Date(eventDetail.event_date).toLocaleString("tr-TR", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        )}

        <p className="text-slate-400 text-sm mb-6">
          Etkinliğe 0.5 SOL taahhüt ile kaydol, etkinlik günü QR kodu okutup hem 0.5 SOL iadeni hem de rozetini al.
        </p>

        {/* Stake-to-Attend Bilgi Kutusu */}
        <div className="mb-6 p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-left space-y-2 text-xs text-slate-300">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-purple-300 font-semibold">
              <Coins className="w-4 h-4 shrink-0" />
              <span>0.5 SOL Katılım Taahhüdü</span>
            </div>
            {publicKey && (
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                  hasEnoughSol
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-500/15 text-red-300"
                }`}
              >
                {balanceLoading
                  ? "Bakiye ölçülüyor..."
                  : `Bakiye: ${(solBalance ?? 0).toFixed(3)} SOL`}
              </span>
            )}
          </div>
          <p className="text-slate-400">
            Etkinliğe katılıp QR okuttuğunda <strong>0.5 SOL</strong> cüzdanına iade edilir ve cNFT rozetini kazanırsın.
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
        ) : isAuthenticated === false ? (
          <div className="p-4 bg-amber-950/50 border border-amber-500/40 rounded-xl space-y-3 text-xs text-amber-200">
            <p>
              Rozet alabilmek için önce ana sayfada cüzdanını imzalayarak Web3 oturumu açmalısın.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2.5 rounded-lg transition"
            >
              Ana Sayfaya Git ve Oturum Aç
            </Link>
          </div>
        ) : claimed ? (
          <div className="space-y-4">
            <div className="p-5 bg-green-950/60 border border-green-500/40 rounded-xl space-y-2">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
              <h2 className="font-bold text-green-400 text-base">
                Katılım Onaylandı & cNFT Rozet Kazanıldı!
              </h2>
              <p className="text-xs text-slate-300">
                cNFT rozetin Solana Devnet üzerinde basıldı ve koleksiyonuna eklendi.
              </p>
              {assetId && (
                <p className="text-[11px] font-mono text-green-300/80 break-all">
                  Asset ID: {assetId}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/#koleksiyonum"
                className="inline-flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold py-3 px-4 rounded-xl transition"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>Rozetlerimi Gör</span>
              </Link>

              {txSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold py-3 px-4 rounded-xl transition"
                >
                  <span>Solana Explorer&apos;da Doğrula</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <WalletMultiButton />
            </div>

            {processingChain && (
              <div className="p-4 bg-purple-950/50 border border-purple-500/40 rounded-xl space-y-2 text-xs text-purple-200">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400 mx-auto" />
                <p className="font-semibold">cNFT Blokzincirde Basılıyor...</p>
                <p className="text-purple-300/80">
                  Solana Devnet onayı bekleniyor (otomatik kontrol ediliyor, lütfen sayfayı kapatmayın).
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-red-950/50 border border-red-500/40 rounded-lg text-xs text-red-300 space-y-2">
                <div className="flex items-center justify-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                {canRetryFailed && (
                  <button
                    onClick={() => submitClaim(activeToken, true)}
                    disabled={claiming}
                    className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>İşlemi Tekrar Dene</span>
                  </button>
                )}
              </div>
            )}

            {!isRegistered ? (
              <div className="space-y-2">
                {!balanceLoading && !hasEnoughSol && (
                  <div className="p-3 bg-amber-950/50 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-center justify-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      Kayıt için cüzdanınızda en az <strong>0.5 SOL</strong> (Devnet) bulunmalıdır.
                    </span>
                  </div>
                )}

                <button
                  onClick={handleRegisterStake}
                  disabled={registerLoading || balanceLoading || !hasEnoughSol || isAfterWindow}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {registerLoading || balanceLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>{balanceLoading ? "Bakiye Kontrol Ediliyor..." : "Kayıt Yapılıyor..."}</span>
                    </>
                  ) : (
                    <>
                      <Coins className="w-5 h-5" />
                      <span>Katılacağım (0.5 SOL Taahhüt Et)</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Etkinliğe kayıtlısın (0.5 SOL taahhüt edildi)</span>
                </div>

                {isBeforeWindow && windowOpenMs !== null ? (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 space-y-1.5">
                    <div className="flex items-center justify-center gap-1.5 text-amber-400 font-semibold">
                      <Clock className="w-4 h-4" />
                      <span>Yoklama Henüz Başlamadı</span>
                    </div>
                    <p className="text-slate-400">
                      QR okutma ve rozet alma ekranı etkinlikten 15 dakika önce (
                      <strong className="text-slate-200">
                        {new Date(windowOpenMs).toLocaleString("tr-TR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </strong>
                      ) aktif olacaktır.
                    </p>
                  </div>
                ) : isAfterWindow ? (
                  <div className="p-4 bg-slate-950 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center justify-center gap-2">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>Bu etkinliğin yoklama ve rozet alma süresi sona ermiştir.</span>
                  </div>
                ) : showScanner ? (
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
                      if (activeToken) {
                        submitClaim(activeToken, false);
                      } else {
                        setShowScanner(true);
                      }
                    }}
                    disabled={claiming || processingChain || !isAttendanceOpen}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {claiming || processingChain ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>İşleniyor...</span>
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
    </main>
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
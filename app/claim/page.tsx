"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { Html5Qrcode } from "html5-qrcode";
import { startScannerSession } from "@/lib/qr-scanner";
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
  deposit_lamports?: number;
}

interface DepositRecord {
  id: string;
  event_id: string;
  state: string;
  lamports: number;
  treasury_address: string;
  payment_signature: string | null;
}

interface SolPayoutRecord {
  id: string;
  kind: "refund" | "bonus" | string;
  state: string;
  lamports: number;
  tx_signature: string | null;
}

function ClaimContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event") || "";
  const paramEventName = searchParams.get("name") || "ÇOMÜ Topluluk Etkinliği";
  const urlToken = searchParams.get("token") || "";

  const { publicKey, signTransaction } = useWallet();
  const walletAddress = publicKey ? publicKey.toBase58() : "";

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const balanceRequestRef = useRef(0);

  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Gerçek depozito & ödeme durumları
  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [payouts, setPayouts] = useState<SolPayoutRecord[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [rsvpProcessing, setRsvpProcessing] = useState(false);

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
  const rsvpPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const paymentRequestRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (rsvpPollRef.current) clearTimeout(rsvpPollRef.current);
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

  const refreshBalance = useCallback(() => {
    const requestId = ++balanceRequestRef.current;
    setSolBalance(null);
    setBalanceError(null);
    if (!walletAddress) { setBalanceLoading(false); return; }
    setBalanceLoading(true);
    fetch(`/api/wallet/balance?wallet=${encodeURIComponent(walletAddress)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Number.isSafeInteger(data.lamports) || data.lamports < 0) {
          throw new Error(data.message || "Bakiye alınamadı. Tekrar deneyin.");
        }
        if (isMountedRef.current && requestId === balanceRequestRef.current) setSolBalance(data.lamports / LAMPORTS_PER_SOL);
      })
      .catch((error) => {
        if (isMountedRef.current && requestId === balanceRequestRef.current) setBalanceError(error.message || "Bakiye alınamadı.");
      })
      .finally(() => {
        if (isMountedRef.current && requestId === balanceRequestRef.current) setBalanceLoading(false);
      });
  }, [walletAddress]);

  useEffect(() => {
    refreshBalance();
    return () => { balanceRequestRef.current++; };
  }, [refreshBalance]);

  // Sunucudan depozito ve iade/bonus durumunu çek
  const fetchRsvpStatus = useCallback(async () => {
    if (!eventId || !walletAddress) return;
    const requestId = paymentRequestRef.current;
    if (rsvpPollRef.current) {
      clearTimeout(rsvpPollRef.current);
      rsvpPollRef.current = null;
    }

    try {
      const res = await fetch(`/api/rsvp?event=${encodeURIComponent(eventId)}`);
      const data = await res.json().catch(() => ({}));
      if (!isMountedRef.current || paymentRequestRef.current !== requestId) return;

      if (data.deposit !== undefined) setDeposit(data.deposit);
      if (Array.isArray(data.payouts)) setPayouts(data.payouts);

      const pendingRefund = data.payouts?.find((p: SolPayoutRecord) => p.kind === "refund" && ["pending", "preparing", "prepared", "submitted"].includes(p.state));
      if (pendingRefund) {
        await fetch("/api/rsvp/refund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: eventId }) });
        if (!isMountedRef.current || paymentRequestRef.current !== requestId) return;
      }
      if (res.status === 202 || data.processing || pendingRefund) {
        setRsvpProcessing(res.status === 202 || !!data.processing);
        const retrySec = Number(res.headers.get("Retry-After")) || 3;
        rsvpPollRef.current = setTimeout(() => {
          if (isMountedRef.current && paymentRequestRef.current === requestId) fetchRsvpStatus();
        }, retrySec * 1000);
      } else {
        setRsvpProcessing(false);
        if (data.deposit?.state === "confirmed") {
          refreshBalance();
        }
      }
    } catch {
      if (isMountedRef.current) setRsvpProcessing(false);
    }
  }, [eventId, walletAddress, refreshBalance]);

  useEffect(() => {
    paymentRequestRef.current++;
    setRsvpLoading(false);
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    if (rsvpPollRef.current) {
      clearTimeout(rsvpPollRef.current);
      rsvpPollRef.current = null;
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
    setDeposit(null);
    setPayouts([]);
    setRsvpProcessing(false);

    if (!walletAddress || !eventId) {
      setIsAuthenticated(false);
      return;
    }

    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user?.wallet_address === walletAddress) {
          setIsAuthenticated(true);
          fetchRsvpStatus();
        } else {
          setIsAuthenticated(false);
        }
      })
      .catch(() => setIsAuthenticated(false));
  }, [walletAddress, eventId, urlToken, fetchRsvpStatus]);

  const eventStartMs = eventDetail?.event_date ? new Date(eventDetail.event_date).getTime() : null;
  const windowOpenMs = eventStartMs !== null ? eventStartMs - 15 * 60 * 1000 : null;
  const windowCloseMs = eventStartMs !== null ? eventStartMs + 2 * 60 * 60 * 1000 : null;

  const isBeforeWindow = windowOpenMs !== null && nowTs < windowOpenMs;
  const isAfterWindow = windowCloseMs !== null && nowTs > windowCloseMs;
  const isAttendanceOpen = !isBeforeWindow && !isAfterWindow;

  const requiredSol = eventDetail?.deposit_lamports
    ? eventDetail.deposit_lamports / LAMPORTS_PER_SOL
    : 0.5;
  const hasEnoughSol = solBalance !== null && solBalance >= requiredSol;
  const needsDeposit = Number(eventDetail?.deposit_lamports ?? 0) > 0;
  const isDepositConfirmed = !!eventDetail && (!needsDeposit || deposit?.state === "confirmed");

  const refundPayout = payouts.find((p) => p.kind === "refund");
  const bonusPayout = payouts.find((p) => p.kind === "bonus");

  // Gerçek 0.5 SOL depozito ödeme akışı (Phantom imzası + /api/rsvp/confirm)
  const handleRegisterStake = async () => {
    if (!walletAddress || !eventId) return;
    if (!signTransaction) {
      setErrorMsg("Cüzdanınız işlem imzalamayı desteklemiyor.");
      return;
    }

    const requestId = ++paymentRequestRef.current;
    setRsvpLoading(true);
    setErrorMsg(null);

    try {
      // 1. Sunucudan depozito niyeti ve hazır SOL transfer işlemini al
      const prepRes = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId }),
      });
      const prepData = await prepRes.json().catch(() => ({}));

      if (!prepRes.ok || !prepData.success) {
        throw new Error(prepData.message || "Depozito işlemi hazırlanamadı.");
      }

      if (paymentRequestRef.current !== requestId) return;
      if (prepData.deposit) {
        setDeposit(prepData.deposit);
      }

      // Zaten onaylıysa işlemi bitir
      if (prepData.deposit?.state === "confirmed") {
        await fetchRsvpStatus();
        return;
      }

      if (!prepData.transaction) {
        await fetchRsvpStatus();
        return;
      }

      // 2. Base64 işlemi çöz ve Phantom ile imzala
      const rawBytes = Uint8Array.from(atob(prepData.transaction), (c) => c.charCodeAt(0));
      const tx = Transaction.from(rawBytes);
      const signedTx = await signTransaction(tx);
      if (paymentRequestRef.current !== requestId) return;
      const signedBase64 = signedTx.serialize({ requireAllSignatures: false }).toString("base64");

      // 3. İmzalı işlemi sunucuya gönder ve onayla
      const confirmRes = await fetch("/api/rsvp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_id: prepData.deposit.id,
          signed_transaction: signedBase64,
        }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (paymentRequestRef.current !== requestId) return;

      if (!confirmRes.ok && confirmRes.status !== 202) {
        throw new Error(confirmData.message || "Depozito ödemesi doğrulanamadı.");
      }

      if (confirmData.deposit) {
        setDeposit(confirmData.deposit);
      }

      if (confirmRes.status === 202 || confirmData.processing) {
        setRsvpProcessing(true);
        rsvpPollRef.current = setTimeout(() => {
          if (isMountedRef.current) fetchRsvpStatus();
        }, 3000);
      } else {
        refreshBalance();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ödeme işlemi tamamlanamadı.";
      setErrorMsg(msg);
    } finally {
      if (isMountedRef.current && paymentRequestRef.current === requestId) setRsvpLoading(false);
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
          // İade ve bakiye durumunu güncelle
          fetchRsvpStatus();
          refreshBalance();
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
    [walletAddress, eventId, fetchRsvpStatus, refreshBalance]
  );

  useEffect(() => {
    if (
      urlToken &&
      walletAddress &&
      isAuthenticated === true &&
      isDepositConfirmed &&
      !claimed &&
      !claiming &&
      !processingChain &&
      !errorMsg
    ) {
      submitClaim(urlToken, false);
    }
  }, [
    urlToken,
    walletAddress,
    isAuthenticated,
    isDepositConfirmed,
    claimed,
    claiming,
    processingChain,
    errorMsg,
    submitClaim,
  ]);

  useEffect(() => {
    if (!showScanner) return;

    const scannerId = "claim-inline-qr-reader";
    const container = document.getElementById(scannerId);
    if (!container) return;

    let isCancelled = false;
    isProcessingQrRef.current = false;
    setScanError(null);
    setCameraError(null);

    const session = startScannerSession(
      container,
      () => new Html5Qrcode(scannerId),
      scanner => scanner.start(
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

              session.stop()
                .finally(() => {
                  if (isCancelled) return;
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
    );
    session.ready
      .catch((err) => {
        if (!isCancelled) {
          console.error("Kamera başlatılamadı:", err);
          setCameraError("Kameraya erişilemedi. Lütfen tarayıcı kamera izinlerini kontrol edin.");
        }
      });

    return () => {
      isCancelled = true;
      void session.stop();
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
          {needsDeposit ? `Etkinliğe ${requiredSol} SOL depozito ile kaydol. QR katılımı doğrulandığında tam iaden başlatılır ve rozetin hazırlanır.` : "Bu etkinlik depozitosuzdur. QR ile katılımını doğrulayıp rozetini alabilirsin."}
        </p>

        {/* Stake-to-Attend Bilgi Kutusu */}
        {needsDeposit && <div className="mb-6 p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-left space-y-2 text-xs text-slate-300">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-purple-300 font-semibold">
              <Coins className="w-4 h-4 shrink-0" />
              <span>{requiredSol} SOL Katılım Depozitosu</span>
            </div>
            {publicKey && (
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                  hasEnoughSol || isDepositConfirmed
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-500/15 text-red-300"
                }`}
              >
                {balanceLoading
                  ? "Bakiye ölçülüyor..."
                  : solBalance === null ? "Bakiye alınamadı" : `Bakiye: ${solBalance.toFixed(4)} SOL`}
              </span>
            )}
          </div>
          <p className="text-slate-400">
            Etkinliğe katılıp QR okuttuğunda <strong>{requiredSol} SOL</strong> cüzdanına iade edilir ve cNFT rozetini kazanırsın.
          </p>
          <div className="flex items-start gap-2 text-emerald-300/90 pt-1">
            <Users className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Kayıt olup gelmeyenlerin depozitoları, etkinliğe katılanlar arasında <strong>eşit olarak paylaştırılır</strong>.
            </span>
          </div>
          <p className="text-[11px] text-slate-500 pt-1">
            Gönderim, iade ve dağıtım ağ ücretlerini proje cüzdanı karşılar; öğrenciden yalnızca depozito çıkar.
          </p>
        </div>}

        {/* Kazanılan Ek No-Show Payı Kartı (Varsa) */}
        {bonusPayout && (
          <div className="mb-5 p-4 bg-amber-950/40 border border-amber-500/40 rounded-xl text-left space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-amber-300 font-semibold">
              <span>🎉 Gelmeyenlerin Havuzundan Ek Kazanç</span>
              <span className="font-mono">
                +{(bonusPayout.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
              </span>
            </div>
            <p className="text-amber-200/80">
              Durum:{" "}
              <strong>
                {bonusPayout.state === "confirmed" ? "Cüzdanına Aktarıldı" : "Blokzincir Onayı Bekliyor"}
              </strong>
            </p>
            {bonusPayout.tx_signature && (
              <a
                href={`https://explorer.solana.com/tx/${bonusPayout.tx_signature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-amber-300 underline hover:text-amber-200"
              >
                <span>Ek Kazanç İşlemini Explorer&apos;da Gör</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {!publicKey ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-slate-400">Devam etmek için Solana cüzdanını bağla:</p>
            <WalletMultiButton />
          </div>
        ) : isAuthenticated === false ? (
          <div className="p-4 bg-amber-950/50 border border-amber-500/40 rounded-xl space-y-3 text-xs text-amber-200">
            <p>
              Depozito yatırmak ve rozet alabilmek için önce ana sayfada cüzdanını imzalayarak Web3 oturumu açmalısın.
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
            <div className="p-5 bg-green-950/60 border border-green-500/40 rounded-xl space-y-2.5">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
              <h2 className="font-bold text-green-400 text-base">
                Katılım Onaylandı & cNFT Rozet Kazanıldı!
              </h2>
              <p className="text-xs text-slate-300">
                {needsDeposit ? `cNFT rozetin Solana Devnet üzerinde basıldı ve ${requiredSol} SOL depozito iade sürecin başlatıldı.` : "cNFT rozetin Solana Devnet üzerinde basıldı."}
              </p>

              {refundPayout && (
                <div className="p-2.5 bg-slate-950/60 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 space-y-1">
                  <div>
                    Depozito İadesi ({(refundPayout.lamports / LAMPORTS_PER_SOL).toFixed(2)} SOL):{" "}
                    <strong>
                      {refundPayout.state === "confirmed" ? "Cüzdanına İade Edildi" : "Onaylanıyor..."}
                    </strong>
                  </div>
                  {refundPayout.tx_signature && (
                    <a
                      href={`https://explorer.solana.com/tx/${refundPayout.tx_signature}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-300 underline hover:text-emerald-200"
                    >
                      <span>İade İşlemini Explorer&apos;da Gör</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

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
                  <span>cNFT İşlemini Doğrula</span>
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

            {!isDepositConfirmed ? (
              <div className="space-y-3">
                {rsvpProcessing && (
                  <div className="p-3 bg-blue-950/50 border border-blue-500/40 rounded-xl text-xs text-blue-200 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                    <span>0.5 SOL depozito ödemen Solana Devnet üzerinde kesinleşiyor...</span>
                  </div>
                )}

                {!balanceLoading && balanceError && (
                  <div className="p-3 text-amber-200 text-sm">
                    {balanceError}
                    <button type="button" onClick={refreshBalance} className="ml-2 underline">Bakiyeyi tekrar sorgula</button>
                  </div>
                )}
                {!balanceLoading && solBalance !== null && !hasEnoughSol && !rsvpProcessing && (
                  <div className="p-3 bg-amber-950/50 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-center justify-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      Kayıt için cüzdanınızda en az <strong>{requiredSol} SOL</strong> bulunmalıdır. Ağ ücretini proje karşılar.
                    </span>
                  </div>
                )}

                <button
                  onClick={handleRegisterStake}
                  disabled={
                    rsvpLoading ||
                    rsvpProcessing ||
                    balanceLoading ||
                    !hasEnoughSol ||
                    isAfterWindow
                  }
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {rsvpLoading || rsvpProcessing || balanceLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>
                        {balanceLoading
                          ? "Bakiye Kontrol Ediliyor..."
                          : rsvpProcessing
                          ? "Blokzincir Onayı Bekleniyor..."
                          : "Phantom Onayı Bekleniyor..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <Coins className="w-5 h-5" />
                      <span>Katılacağım ({requiredSol} SOL Depozito Yatır)</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 space-y-1">
                  <div className="flex items-center justify-center gap-2 font-medium">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{needsDeposit ? `Etkinliğe kayıtlısın (${requiredSol} SOL depozito onaylandı)` : "Bu etkinlik için depozito gerekmiyor"}</span>
                  </div>
                  {deposit?.payment_signature && (
                    <a
                      href={`https://explorer.solana.com/tx/${deposit.payment_signature}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-200/80 underline hover:text-white"
                    >
                      <span>Depozito İşlemini Explorer&apos;da Gör</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
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
                        <span>{needsDeposit ? `Rozetimi Al & ${requiredSol} SOL İadeyi Başlat (QR Okut)` : "Rozetimi Al (QR Okut)"}</span>
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
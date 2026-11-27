"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, ArrowLeft, AlertCircle, CheckCircle2 } from "lucide-react";

export default function ScanPage() {
  const router = useRouter();
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [matchedUrl, setMatchedUrl] = useState<string | null>(null);
  const isRedirectingRef = useRef(false);

  useEffect(() => {
    const scannerId = "comu-qr-reader";
    const container = document.getElementById(scannerId);
    if (container) {
      container.innerHTML = "";
    }

    const html5QrCode = new Html5Qrcode(scannerId);
    let isCancelled = false;
    let isStarted = false;

    html5QrCode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (isRedirectingRef.current || isCancelled) return;

          try {
            const parsed = new URL(decodedText, window.location.origin);
            const isSameOrigin = parsed.origin === window.location.origin;
            const isClaimPath = parsed.pathname === "/claim";
            const eventParam = parsed.searchParams.get("event");
            const tokenParam = parsed.searchParams.get("token");

            if (isSameOrigin && isClaimPath && eventParam && tokenParam) {
              isRedirectingRef.current = true;
              setScanError(null);
              const targetPath = `${parsed.pathname}${parsed.search}`;
              setMatchedUrl(targetPath);

              html5QrCode
                .stop()
                .catch(() => {})
                .finally(() => {
                  router.push(targetPath);
                });
              return;
            }
          } catch {
            // Geçerli URL değilse aşağıdaki uyarıya düşer
          }

          setScanError("Geçersiz QR kod! Lütfen yalnızca ÇOMÜ Badge etkinlik QR kodunu okutun.");
        },
        () => {
          // Karede QR bulunamadığında sessizce devam et
        }
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
          setCameraError(
            "Kameraya erişilemedi. Tarayıcı izinlerini kontrol edin veya masaüstündeyseniz etkinlik kartından doğrudan rozet sayfasına gidin."
          );
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
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 flex flex-col items-center justify-center">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-purple-400 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Ana Sayfaya Dön</span>
          </Link>
        </div>

        <div className="flex items-center gap-2 text-purple-400 font-bold text-lg mb-2">
          <Camera className="w-5 h-5" />
          <h1>Etkinlik QR Kodunu Okut</h1>
        </div>
        <p className="text-xs text-slate-400 mb-5">
          Etkinlik alanındaki ekranda yer alan ÇOMÜ Badge QR kodunu kameraya tutun.
        </p>

        {cameraError ? (
          <div className="p-4 bg-red-950/50 border border-red-500/40 rounded-xl text-xs text-red-300">
            {cameraError}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
            <div id="comu-qr-reader" className="w-full" />
          </div>
        )}

        {scanError && (
          <div className="mt-4 p-3 bg-amber-950/60 border border-amber-500/40 rounded-xl flex items-start gap-2 text-xs text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{scanError}</span>
          </div>
        )}

        {matchedUrl && (
          <div className="mt-4 p-3 bg-green-950/60 border border-green-500/40 rounded-xl flex items-center gap-2 text-xs text-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
            <span>Etkinlik QR doğrulandı, rozet ekranına yönlendiriliyorsunuz...</span>
          </div>
        )}
      </div>
    </main>
  );
}
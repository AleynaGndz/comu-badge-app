"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import { startScannerSession } from "@/lib/qr-scanner";
import { QrCode, ArrowLeft, AlertCircle, Camera } from "lucide-react";

export default function ScanPage() {
  const router = useRouter();
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const isRedirectingRef = useRef(false);

  useEffect(() => {
    const scannerId = "comu-qr-reader";
    const container = document.getElementById(scannerId);
    if (!container) return;

    let isCancelled = false;
    isRedirectingRef.current = false;

    const session = startScannerSession(
      container,
      () => new Html5Qrcode(scannerId),
      scanner => scanner.start(
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

              session.stop()
                .finally(() => {
                  if (isCancelled) return;
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
    );
    session.ready
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
      void session.stop();
    };
  }, [router]);

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
          <QrCode className="w-8 h-8" />
        </div>

        <h1 className="text-xl font-bold mb-2">Etkinlik QR Kodunu Okut</h1>
        <p className="text-slate-400 text-sm mb-6">
          Etkinlik alanındaki ekranda yer alan katılım QR kodunu kameraya gösterin.
        </p>

        {cameraError ? (
          <div className="p-4 bg-red-950/50 border border-red-500/40 rounded-xl text-xs text-red-300 space-y-2">
            <Camera className="w-6 h-6 text-red-400 mx-auto" />
            <p>{cameraError}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-purple-500/40 bg-black">
            <div id="standalone-qr-reader" className="w-full" />
          </div>
        )}

        {scanError && (
          <div className="mt-4 p-3 bg-amber-950/60 border border-amber-500/40 rounded-xl flex items-start gap-2 text-xs text-amber-200 text-left">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{scanError}</span>
          </div>
        )}
      </div>
    </main>
  );
}
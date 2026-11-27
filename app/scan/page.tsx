"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, ArrowLeft, AlertCircle } from "lucide-react";

export default function ScanPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const html5QrCode = new Html5Qrcode("qr-reader");
    scannerRef.current = html5QrCode;

    html5QrCode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          html5QrCode.stop().catch(() => {});
          try {
            const url = new URL(decodedText);
            if (url.pathname === "/claim") {
              router.push(`${url.pathname}${url.search}`);
              return;
            }
          } catch {
            // Tam URL değilse doğrudan yönlendir
          }
          window.location.href = decodedText;
        },
        () => {
          // Karede QR bulunamadığında sessizce devam et
        }
      )
      .catch(() => {
        setError("Kamera başlatılamadı. Tarayıcıdan kamera izni verdiğinden emin ol.");
      });

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
        <div className="flex justify-start mb-4">
          <Link href="/" className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Ana Sayfa</span>
          </Link>
        </div>

        <div className="w-12 h-12 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mx-auto mb-3">
          <Camera className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold mb-1">Etkinlik QR Kodunu Okut</h1>
        <p className="text-slate-400 text-xs mb-6">
          Kameranızı etkinlik alanındaki QR koda tutun, rozet ekranına otomatik yönlendirileceksiniz.
        </p>

        {error ? (
          <div className="p-4 bg-red-950/50 border border-red-500/40 rounded-xl text-red-400 text-xs flex items-center gap-2 text-left">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-purple-500/40 bg-black">
            <div id="qr-reader" className="w-full" />
          </div>
        )}
      </div>
    </main>
  );
}
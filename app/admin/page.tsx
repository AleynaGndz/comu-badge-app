"use client";

import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, CheckCircle2, ShieldCheck } from "lucide-react";

export default function AdminPage() {
  const [eventName, setEventName] = useState("Dev3pack Çanakkale Build Station");
  const [eventId, setEventId] = useState("dev3pack-2026");
  const [origin, setOrigin] = useState("");
  const [studentAddress, setStudentAddress] = useState("");
  const [verificationResult, setVerificationResult] = useState<null | {
    eligible: boolean;
    badgeCount: number;
  }>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const claimUrl = origin
    ? `${origin}/claim?event=${encodeURIComponent(eventId)}&name=${encodeURIComponent(eventName)}`
    : "";

  const handleVerifyStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentAddress.trim()) return;
    setVerificationResult({
      eligible: true,
      badgeCount: 3,
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-purple-400 mb-2">
          Topluluk & Sponsor Yönetim Paneli
        </h1>
        <p className="text-slate-400 mb-8 text-sm">
          Etkinlik katılım QR kodu oluşturun ve sponsor indirimleri için öğrenci cüzdanlarını doğrulayın.
        </p>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Sol Kart: Etkinlik QR Üretici */}
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 mb-4 text-purple-400 font-semibold">
              <QrCode className="w-5 h-5" />
              <h2>1. Etkinlik Rozet QR Üretici</h2>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Etkinlik Adı</label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Etkinlik Kodu (ID)</label>
                <input
                  type="text"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div className="flex flex-col items-center bg-white p-6 rounded-xl min-h-[240px] justify-center">
              {claimUrl ? (
                <>
                  <QRCodeSVG value={claimUrl} size={180} />
                  <p className="text-slate-900 font-semibold text-xs mt-3 text-center">
                    {eventName}
                  </p>
                </>
              ) : (
                <p className="text-slate-400 text-xs">QR Kod hazırlanıyor...</p>
              )}
            </div>
          </div>

          {/* Sağ Kart: Sponsor Doğrulama */}
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 mb-4 text-green-400 font-semibold">
              <ShieldCheck className="w-5 h-5" />
              <h2>2. Sponsor Kupon Doğrulama</h2>
            </div>

            <form onSubmit={handleVerifyStudent} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Öğrenci Cüzdan Adresi (Solana)
                </label>
                <input
                  type="text"
                  placeholder="Örn: A9VDvk1m..."
                  value={studentAddress}
                  onChange={(e) => setStudentAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 rounded-lg text-sm transition"
              >
                Rozetleri Sorgula
              </button>
            </form>

            {verificationResult && (
              <div className="mt-6 p-4 bg-green-950/50 border border-green-500/40 rounded-lg">
                <div className="flex items-center gap-2 text-green-400 font-semibold mb-1">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Kampanya Hakkı Onaylandı!</span>
                </div>
                <p className="text-xs text-slate-300">
                  Bu cüzdanda toplam <strong>{verificationResult.badgeCount} adet</strong> topluluk rozeti bulunuyor. Ücretsiz kahve kuponu kullanılabilir.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
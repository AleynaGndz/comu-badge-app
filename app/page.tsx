"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Calendar, Award, ArrowRight, Sparkles } from "lucide-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

interface EventItem {
  id: string;
  title: string;
  description: string;
  event_date: string;
}

interface BadgeItem {
  id: string;
  title: string;
  image_url?: string;
  claimed_at?: string;
  tx_signature?: string;
}

export default function Home() {
  const { publicKey } = useWallet();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [myBadges, setMyBadges] = useState<BadgeItem[]>([]);

  useEffect(() => {
    fetch("/api/events")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.events)) {
          setEvents(data.events);
        }
      })
      .catch((err) => console.error("Etkinlikler yüklenemedi:", err));
  }, []);

  useEffect(() => {
    if (!publicKey) {
      setMyBadges([]);
      return;
    }

    fetch(`/api/badges?wallet=${publicKey.toBase58()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.badges)) {
          setMyBadges(data.badges);
        }
      })
      .catch(() => {
        // Endpoint henüz eklenmediyse sessizce geç
      });
  }, [publicKey]);

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <nav className="flex justify-between items-center max-w-4xl mx-auto pb-8 border-b border-slate-800">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-purple-400">ÇOMÜ Badge</h1>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-white transition">
            Yönetim & QR
          </Link>
        </div>
        <WalletMultiButton />
      </nav>

      <div className="max-w-4xl mx-auto mt-10">
        {/* Cüzdan Durum Kartı */}
        <div className="text-center mb-10">
          {publicKey ? (
            <div className="p-6 bg-slate-900 rounded-xl border border-purple-500/30">
              <p className="text-green-400 font-semibold mb-1">Cüzdan Başarıyla Bağlandı!</p>
              <p className="text-xs text-slate-400 break-all">Adres: {publicKey.toBase58()}</p>
            </div>
          ) : (
            <div className="p-6 bg-slate-900/50 rounded-xl border border-slate-800">
              <p className="text-slate-300 font-medium">
                Etkinlik cNFT rozetlerini toplamak ve kampüs ödüllerini açmak için sağ üstten cüzdanını bağla.
              </p>
            </div>
          )}
        </div>

        {/* Kullanıcının Kazandığı Rozetler */}
        {publicKey && (
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-bold">Koleksiyonum ({myBadges.length} Rozet)</h2>
            </div>

            {myBadges.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {myBadges.map((badge) => (
                  <div
                    key={badge.id}
                    className="bg-slate-900 border border-purple-500/30 rounded-xl p-4 flex flex-col items-center text-center"
                  >
                    {badge.image_url ? (
                      <img
                        src={badge.image_url}
                        alt={badge.title}
                        className="w-20 h-20 object-cover rounded-lg mb-3"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mb-3">
                        <Award className="w-8 h-8" />
                      </div>
                    )}
                    <h3 className="font-semibold text-sm">{badge.title}</h3>
                    <span className="text-[11px] text-green-400 mt-1">Doğrulanmış cNFT</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-5 bg-slate-900/40 border border-dashed border-slate-800 rounded-xl text-center text-sm text-slate-400">
                Henüz cüzdanında rozet görünmüyor. Aşağıdaki etkinliklerden birine katılıp ilk rozetini alabilirsin!
              </div>
            )}
          </div>
        )}

        {/* Etkinlikler Listesi */}
        <div className="flex items-center gap-2 mb-6">
          <Calendar className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-bold">Aktif Kampüs Etkinlikleri</h2>
        </div>

        {events.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-4">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <span className="text-xs text-purple-400 font-medium">
                    {new Date(ev.event_date).toLocaleDateString("tr-TR")}
                  </span>
                  <h3 className="text-lg font-semibold mt-1">{ev.title}</h3>
                  <p className="text-sm text-slate-400 mt-2">{ev.description}</p>
                </div>

                <Link
                  href={`/claim?event=${encodeURIComponent(ev.id)}&name=${encodeURIComponent(ev.title)}`}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-purple-400 hover:text-purple-300"
                >
                  <Award className="w-4 h-4" />
                  <span>Rozet Sayfasına Git</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Henüz veritabanında etkinlik bulunamadı veya Supabase bağlantı anahtarları (.env.local) bekleniyor.
          </p>
        )}
      </div>
    </main>
  );
}
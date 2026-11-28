"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Calendar,
  Award,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Loader2,
  Pencil,
  Check,
  X,
  Gift,
  Lock,
  Unlock,
  AlertCircle,
} from "lucide-react";
import badgesCatalog from "../badges.json";

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

interface UserProfile {
  id: string;
  wallet_address: string;
  name?: string | null;
  role?: string | null;
}

interface RewardCampaign {
  id: string;
  title: string;
  description?: string | null;
  required_badges: number;
  expires_at?: string | null;
}

interface StudentCoupon {
  id: string;
  reward_id: string;
  code: string;
  status?: string;
  used_at?: string | null;
}

const BADGE_LABELS: Record<string, { title: string; desc: string }> = {
  dev3pack: {
    title: "Dev3pack Build Station",
    desc: "Solana & Web3 Geliştirici Katılım Rozeti",
  },
  movie_night: {
    title: "Kampüs Film Gecesi",
    desc: "Topluluk Sosyal Etkinlik Rozeti",
  },
  android: {
    title: "Android Geliştirme Atölyesi",
    desc: "Mobil Teknoloji Eğitim Rozeti",
  },
};

function IpfsBadgeImage({ uri, alt }: { uri: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="w-24 h-24 bg-purple-500/20 text-purple-400 rounded-xl flex items-center justify-center mb-3">
        <Award className="w-10 h-10" />
      </div>
    );
  }

  return (
    <img
      src={`/api/badge-image?uri=${encodeURIComponent(uri)}`}
      alt={alt}
      onError={() => setFailed(true)}
      className="w-28 h-28 object-contain rounded-xl mb-3 bg-slate-950 p-2"
    />
  );
}

export default function Home() {
  const { publicKey, signMessage } = useWallet();
  const prevWalletRef = useRef<string | null>(null);

  const [events, setEvents] = useState<EventItem[]>([]);
  const [myBadges, setMyBadges] = useState<BadgeItem[]>([]);
  const [rewards, setRewards] = useState<RewardCampaign[]>([]);
  const [myCoupons, setMyCoupons] = useState<StudentCoupon[]>([]);
  const [couponLoadingId, setCouponLoadingId] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Etkinlikleri ve açık sponsor kampanyalarını yükle
  useEffect(() => {
    fetch("/api/events")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.events)) {
          setEvents(data.events);
        }
      })
      .catch((err) => console.error("Etkinlikler yüklenemedi:", err));

    fetch("/api/rewards")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.rewards)) {
          setRewards(data.rewards);
        }
      })
      .catch((err) => console.error("Kampanyalar yüklenemedi:", err));
  }, []);

  // Cüzdan bağlantısı, hesap değişimi ve logout yönetimi
  useEffect(() => {
    const currentWallet = publicKey ? publicKey.toBase58() : null;
    const previousWallet = prevWalletRef.current;
    prevWalletRef.current = currentWallet;

    const logoutServerSession = async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        // Ağ hatası olsa bile yerel state temizlenir
      }
      setUserProfile(null);
      setMyCoupons([]);
    };

    // Cüzdan bağlantısı kesildiyse sunucu oturumunu kapat
    if (!currentWallet) {
      if (previousWallet) {
        logoutServerSession();
      } else {
        setUserProfile(null);
        setMyCoupons([]);
      }
      setMyBadges([]);
      return;
    }

    // Farklı bir cüzdana geçildiyse önce eski oturumu kapat
    if (previousWallet && previousWallet !== currentWallet) {
      logoutServerSession();
    } else {
      fetch("/api/auth/me")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.user?.wallet_address === currentWallet) {
            setUserProfile(data.user);
            setNameInput(data.user.name || "");
          } else if (data.success && data.user) {
            logoutServerSession();
          } else {
            setUserProfile(null);
          }
        })
        .catch(() => setUserProfile(null));
    }

    // Cüzdana ait doğrulanmış rozetleri çek
    fetch(`/api/badges?wallet=${encodeURIComponent(currentWallet)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.badges)) {
          setMyBadges(data.badges);
        } else {
          setMyBadges([]);
        }
      })
      .catch(() => setMyBadges([]));
  }, [publicKey]);

  // Oturum açıldığında öğrencinin mevcut kuponlarını çek
  useEffect(() => {
    if (!userProfile) {
      setMyCoupons([]);
      return;
    }

    fetch("/api/coupons")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.coupons)) {
          setMyCoupons(data.coupons);
        }
      })
      .catch(() => {});
  }, [userProfile]);

  const handleWalletLogin = async () => {
    if (!publicKey || !signMessage) {
      setAuthError("Cüzdan mesaj imzalamayı desteklemiyor.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);

    try {
      const walletAddress = publicKey.toBase58();

      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });
      const nonceData = await nonceRes.json();

      if (!nonceRes.ok || !nonceData.success) {
        throw new Error(nonceData.message || "Nonce alınamadı.");
      }

      const encodedMessage = new TextEncoder().encode(nonceData.message);
      const signatureBytes = await signMessage(encodedMessage);

      const loginRes = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: walletAddress,
          nonce: nonceData.nonce,
          signature: Array.from(signatureBytes),
        }),
      });
      const loginData = await loginRes.json();

      if (!loginRes.ok || !loginData.success) {
        throw new Error(loginData.message || "Giriş doğrulanamadı.");
      }

      setUserProfile(loginData.user);
      setNameInput(loginData.user.name || "");
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : "";
      if (rawMsg.toLowerCase().includes("rejected")) {
        setAuthError("İmza isteği cüzdandan iptal edildi. Giriş yapmak için tekrar deneyebilirsin.");
      } else {
        setAuthError(rawMsg || "İmza işlemi tamamlanamadı.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    setSavingName(true);
    setAuthError(null);

    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "İsim kaydedilemedi.");
      }

      setUserProfile(data.user);
      setIsEditingName(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu.";
      setAuthError(msg);
    } finally {
      setSavingName(false);
    }
  };

  const handleClaimCoupon = async (rewardId: string) => {
    if (!userProfile) {
      setCouponError("Kupon oluşturmak için önce cüzdanınızla imzalı oturum açın.");
      return;
    }

    setCouponLoadingId(rewardId);
    setCouponError(null);

    try {
      const res = await fetch("/api/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reward_id: rewardId }),
      });
      const data = await res.json();

      if (!res.ok || !data.success || !data.coupon) {
        throw new Error(data.message || "Kupon oluşturulamadı.");
      }

      setMyCoupons((prev) => {
        const exists = prev.some((c) => c.reward_id === rewardId);
        if (exists) {
          return prev.map((c) => (c.reward_id === rewardId ? data.coupon : c));
        }
        return [...prev, data.coupon];
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Kupon alma başarısız.";
      setCouponError(msg);
    } finally {
      setCouponLoadingId(null);
    }
  };

  const catalogEntries = Object.entries(badgesCatalog);
  const badgeCount = myBadges.length;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <nav className="flex flex-wrap justify-between items-center gap-4 max-w-4xl mx-auto pb-8 border-b border-slate-800">
        <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-xl font-bold text-purple-400 hover:text-purple-300 transition"
            >
              ÇOMÜ Badge
            </Link>

            {(userProfile?.role === "admin" || userProfile?.role === "sponsor") && (
              <Link
                href="/admin"
                className="text-xs text-slate-300 hover:text-purple-400 transition"
              >
                Yönetim &amp; QR
              </Link>
            )}
          </div>
        <WalletMultiButton />
      </nav>

      <div className="max-w-4xl mx-auto mt-10">
        {/* Cüzdan & Kimlik Doğrulama Kartı */}
        <div className="text-center mb-10">
          {publicKey ? (
            <div className="p-6 bg-slate-900 rounded-xl border border-purple-500/30 space-y-3">
              <div className="flex items-center justify-center gap-2 text-green-400 font-semibold">
                <ShieldCheck className="w-5 h-5" />
                <span>
                  {userProfile
                    ? "Web3 Oturumu Doğrulandı (Supabase Kayıtlı)"
                    : "Cüzdan Bağlandı — Oturum Doğrulaması Bekleniyor"}
                </span>
              </div>

              {userProfile && (
                <div className="pt-1 flex items-center justify-center gap-2">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Adınız ve Soyadınız"
                        className="bg-slate-950 border border-purple-500/50 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                      />
                      <button
                        onClick={handleSaveName}
                        disabled={savingName}
                        className="p-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-white cursor-pointer"
                        title="Kaydet"
                      >
                        {savingName ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setIsEditingName(false);
                          setNameInput(userProfile.name || "");
                        }}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 cursor-pointer"
                        title="İptal"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-slate-200">
                      <span>
                        {userProfile.role === "admin"
                          ? "Admin:"
                          : userProfile.role === "sponsor"
                          ? "Sponsor:"
                          : "Öğrenci:"}{" "}
                        <strong className="text-purple-300">
                          {userProfile.name || "İsim Belirtilmedi"}
                        </strong>
                      </span>
                      <button
                        onClick={() => setIsEditingName(true)}
                        className="text-xs text-slate-400 hover:text-purple-400 inline-flex items-center gap-1 underline cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Düzenle</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-slate-400 break-all">Adres: {publicKey.toBase58()}</p>

              {!userProfile && (
                <div className="pt-2">
                  <button
                    onClick={handleWalletLogin}
                    disabled={authLoading}
                    className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition cursor-pointer"
                  >
                    {authLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>İmza Bekleniyor...</span>
                      </>
                    ) : (
                      <span>Cüzdanı İmzala ve Giriş Yap</span>
                    )}
                  </button>
                </div>
              )}

              {authError && <p className="text-xs text-red-400 mt-2">{authError}</p>}
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
          <div id="koleksiyonum" className="mb-12 scroll-mt-8">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-bold">Koleksiyonum ({badgeCount} Rozet)</h2>
            </div>

            {myBadges.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {myBadges.map((badge) => (
                  <div
                    key={badge.id}
                    className="bg-slate-900 border border-purple-500/30 rounded-xl p-4 flex flex-col items-center text-center"
                  >
                    {badge.image_url ? (
                      <IpfsBadgeImage uri={badge.image_url} alt={badge.title} />
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
                Henüz cüzdanında rozet görünmüyor. Etkinlik alanındaki QR kodu okutarak ilk rozetini alabilirsin!
              </div>
            )}
          </div>
        )}

        {/* Kampüs Sponsor İndirimleri & Ödüller (Gerçek API) */}
        <div className="mb-12">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold">Kampüs Sponsor İndirimleri & Ödüller</h2>
            </div>
            <span className="text-xs text-slate-400">
              Mevcut Bakiyen: <strong className="text-purple-300">{badgeCount} Rozet</strong>
            </span>
          </div>

          {couponError && (
            <div className="mb-4 p-3 bg-red-950/50 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{couponError}</span>
            </div>
          )}

          {rewards.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {rewards.map((reward) => {
                const isUnlocked = badgeCount >= reward.required_badges;
                const missing = Math.max(0, reward.required_badges - badgeCount);
                const progressPct = Math.min(
                  100,
                  Math.round((badgeCount / reward.required_badges) * 100)
                );
                const existingCoupon = myCoupons.find((c) => c.reward_id === reward.id);
                const isUsed = existingCoupon?.status === "used" || Boolean(existingCoupon?.used_at);

                return (
                  <div
                    key={reward.id}
                    className={`rounded-xl p-5 border flex flex-col justify-between transition ${
                      isUnlocked
                        ? "bg-slate-900 border-emerald-500/40 shadow-lg shadow-emerald-950/20"
                        : "bg-slate-900/60 border-slate-800"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div
                          className={`p-2 rounded-lg ${
                            isUnlocked
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          <Gift className="w-5 h-5" />
                        </div>

                        <span
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${
                            isUnlocked
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {isUnlocked ? (
                            <>
                              <Unlock className="w-3 h-3" />
                              <span>Kilit Açıldı</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3 h-3" />
                              <span>{reward.required_badges} Rozet</span>
                            </>
                          )}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white">{reward.title}</h3>
                      {reward.description && (
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                          {reward.description}
                        </p>
                      )}
                    </div>

                    <div className="mt-5 pt-4 border-t border-slate-800/80">
                      {existingCoupon ? (
                        <div
                          className={`p-2.5 border rounded-lg text-center ${
                            isUsed
                              ? "bg-slate-950 border-slate-700"
                              : "bg-emerald-950/70 border-emerald-500/40"
                          }`}
                        >
                          <span className="block text-[10px] text-emerald-300 uppercase tracking-wider">
                            {isUsed ? "Kullanılmış Kupon" : "Tek Kullanımlık Kupon Kodu"}
                          </span>
                          <span
                            className={`font-mono font-bold text-sm select-all ${
                              isUsed ? "text-slate-500 line-through" : "text-white"
                            }`}
                          >
                            {existingCoupon.code}
                          </span>
                        </div>
                      ) : isUnlocked ? (
                        <button
                          onClick={() => handleClaimCoupon(reward.id)}
                          disabled={couponLoadingId === reward.id}
                          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold py-2.5 rounded-lg transition cursor-pointer inline-flex items-center justify-center gap-2"
                        >
                          {couponLoadingId === reward.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Kupon Oluşturuluyor...</span>
                            </>
                          ) : (
                            <span>Kupon Kodumu Oluştur</span>
                          )}
                        </button>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>İlerleme</span>
                            <span>
                              {badgeCount}/{reward.required_badges} ({missing} rozet daha)
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-5 bg-slate-900/40 border border-dashed border-slate-800 rounded-xl text-center text-sm text-slate-400">
              Şu an aktif sponsor kampanyası bulunmuyor. Sponsorlar kampanya açtığında burada listelenecektir.
            </div>
          )}
        </div>

        {/* Tasarım Kataloğu: Kazanılabilir Kampüs Rozetleri */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-bold">Kazanılabilir Kampüs Rozetleri (IPFS)</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {catalogEntries.map(([key, imageUrl]) => {
              const info = BADGE_LABELS[key] || {
                title: key,
                desc: "ÇOMÜ Topluluk Katılım Rozeti",
              };
              return (
                <div
                  key={key}
                  className="bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-xl p-4 flex flex-col items-center text-center transition"
                >
                  <IpfsBadgeImage uri={imageUrl} alt={info.title} />
                  <h3 className="font-semibold text-sm text-white">{info.title}</h3>
                  <p className="text-xs text-slate-400 mt-1">{info.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

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
                    {new Date(ev.event_date).toLocaleString("tr-TR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  <h3 className="text-lg font-semibold mt-1">{ev.title}</h3>
                  <p className="text-sm text-slate-400 mt-2">{ev.description}</p>
                </div>

                <Link
                  href={`/claim?event=${encodeURIComponent(ev.id)}&name=${encodeURIComponent(ev.title)}`}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-purple-400 hover:text-purple-300"
                >
                  <Award className="w-4 h-4" />
                  <span>Etkinliğe Katıl / Rozet Al</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Henüz veritabanında etkinlik bulunamadı.
          </p>
        )}
      </div>
    </main>
  );
}
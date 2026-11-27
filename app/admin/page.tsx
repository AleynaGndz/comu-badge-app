"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { QRCodeSVG } from "qrcode.react";
import {
  QrCode,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  PlusCircle,
  ArrowLeft,
  Loader2,
  Trash2,
  Lock,
  AlertCircle,
  Gift,
  Ticket,
  X,
} from "lucide-react";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

interface EventItem {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  club_id?: string | null;
  badge_key?: string | null;
}

interface ClubItem {
  id: string;
  name: string;
}

interface CatalogBadge {
  badge_key: string;
  metadata_uri: string;
}

interface UserProfile {
  id: string;
  wallet_address: string;
  name?: string | null;
  role?: string | null;
}

interface RewardItem {
  id: string;
  title: string;
  description?: string | null;
  required_badges: number;
  active?: boolean;
}

export default function AdminPage() {
  const { publicKey, signMessage } = useWallet();
  const prevWalletRef = useRef<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [origin, setOrigin] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [clubs, setClubs] = useState<ClubItem[]>([]);
  const [badgeCatalog, setBadgeCatalog] = useState<CatalogBadge[]>([]);

  // Canlı QR Modal / Ekran State'leri
  const [activeQrEvent, setActiveQrEvent] = useState<EventItem | null>(null);
  const [claimUrl, setClaimUrl] = useState("");
  const [qrError, setQrError] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Yeni Etkinlik Formu
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDate, setNewDate] = useState("");
  const [selectedClubId, setSelectedClubId] = useState("");
  const [selectedBadgeKey, setSelectedBadgeKey] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [createMessage, setCreateMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Sponsor Kampanya & Kupon State'leri
  const [sponsorRewards, setSponsorRewards] = useState<RewardItem[]>([]);
  const [newRewardTitle, setNewRewardTitle] = useState("");
  const [newRewardDesc, setNewRewardDesc] = useState("");
  const [newRewardBadges, setNewRewardBadges] = useState(1);
  const [creatingReward, setCreatingReward] = useState(false);
  const [rewardMsg, setRewardMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Sponsor Uygunluk Sorgulama
  const [selectedRewardId, setSelectedRewardId] = useState("");
  const [studentAddress, setStudentAddress] = useState("");
  const [verifyingStudent, setVerifyingStudent] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [eligibilityResult, setEligibilityResult] = useState<null | {
    eligible: boolean;
    badgeCount: number;
    required_badges: number;
    coupon_status?: string;
  }>(null);

  // Sponsor Kupon Kullanma (Redeem)
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [redeemingCoupon, setRedeemingCoupon] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (data.success && Array.isArray(data.events)) {
        setEvents(data.events);
      }
    } catch (err) {
      console.error("Etkinlikler yüklenemedi:", err);
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    loadEvents();

    fetch("/api/badges/catalog")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.badges)) {
          setBadgeCatalog(data.badges);
          if (data.badges.length > 0) {
            setSelectedBadgeKey(data.badges[0].badge_key);
          }
        }
      })
      .catch(() => {});
  }, [loadEvents]);

  // Cüzdan bağlantısı, hesap değişimi ve logout yönetimi
  useEffect(() => {
    const currentWallet = publicKey ? publicKey.toBase58() : null;
    const previousWallet = prevWalletRef.current;
    prevWalletRef.current = currentWallet;

    const logoutSession = async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {}
      setUserProfile(null);
      setClubs([]);
      setSponsorRewards([]);
      setActiveQrEvent(null);
      setClaimUrl("");
    };

    if (!currentWallet) {
      if (previousWallet) {
        logoutSession();
      } else {
        setUserProfile(null);
      }
      return;
    }

    if (previousWallet && previousWallet !== currentWallet) {
      logoutSession();
    } else {
      fetch("/api/auth/me")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.user?.wallet_address === currentWallet) {
            setUserProfile(data.user);
          } else if (data.success && data.user) {
            logoutSession();
          } else {
            setUserProfile(null);
          }
        })
        .catch(() => setUserProfile(null));
    }
  }, [publicKey]);

  // Oturum açıldığında kulüpleri ve sponsor kampanyalarını çek
  useEffect(() => {
    if (!userProfile) {
      setClubs([]);
      setSponsorRewards([]);
      return;
    }

    fetch("/api/clubs")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.clubs)) {
          setClubs(data.clubs);
          if (data.clubs.length > 0) {
            setSelectedClubId(data.clubs[0].id);
          }
        }
      })
      .catch(() => {});

    fetch("/api/rewards?mine=true")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.rewards)) {
          setSponsorRewards(data.rewards);
          if (data.rewards.length > 0) {
            setSelectedRewardId(data.rewards[0].id);
          }
        }
      })
      .catch(() => {});
  }, [userProfile]);

  const handleAdminLogin = async () => {
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
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : "";
      if (rawMsg.toLowerCase().includes("rejected")) {
        setAuthError("İmza isteği iptal edildi.");
      } else {
        setAuthError(rawMsg || "Oturum açılamadı.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // Seçili etkinlik için canlı QR kodunu sunucudan çek (yedek QR yok)
  const handleOpenLiveQr = async (ev: EventItem) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setActiveQrEvent(ev);
    setClaimUrl("");
    setQrError(null);
    setLoadingQr(true);

    try {
      const res = await fetch(`/api/events/qr?event=${encodeURIComponent(ev.id)}`);
      const data = await res.json();

      if (res.ok && data.success && data.claim_path) {
        setClaimUrl(`${origin}${data.claim_path}`);
      } else {
        setQrError(
          data.message === "Unauthorized"
            ? "QR kodunu görmek için önce cüzdanınızla oturum açmalısınız."
            : data.message === "Admin access required" || data.message === "Club access denied"
            ? "Bu etkinliğin QR kodunu açmak için ilgili kulübün yöneticisi (admin) olmalısınız."
            : data.message || "QR kodu alınamadı."
        );
      }
    } catch {
      setQrError("QR servisine bağlanılamadı.");
    } finally {
      setLoadingQr(false);
    }
  };

  const handleDeleteEvent = async (ev: EventItem) => {
    setDeletingEventId(ev.id);
    setListMessage(null);

    try {
      const res = await fetch(`/api/events?id=${encodeURIComponent(ev.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Etkinlik silinemedi.");
      }

      setEvents((prev) => prev.filter((item) => item.id !== ev.id));
      if (activeQrEvent?.id === ev.id) {
        setActiveQrEvent(null);
        setClaimUrl("");
      }
      setListMessage({
        type: "success",
        text: `"${ev.title}" etkinliği silindi.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Etkinlik silinemedi.";
      setListMessage({ type: "error", text: msg });
    } finally {
      setDeletingEventId(null);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDate) return;

    setCreatingEvent(true);
    setCreateMessage(null);

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          event_date: new Date(newDate).toISOString(),
          ...(selectedClubId ? { club_id: selectedClubId } : {}),
          ...(selectedBadgeKey ? { badge_key: selectedBadgeKey } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Etkinlik oluşturulamadı.");
      }

      const created: EventItem = data.event;
      setEvents((prev) => [created, ...prev]);
      setNewTitle("");
      setNewDescription("");
      setNewDate("");
      setCreateMessage({
        type: "success",
        text: `"${created.title}" etkinliği oluşturuldu! Aşağıdaki listeden QR kodunu açabilirsiniz.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu.";
      setCreateMessage({ type: "error", text: msg });
    } finally {
      setCreatingEvent(false);
    }
  };

  // Yeni Sponsor Kampanyası Oluşturma
  const handleCreateReward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRewardTitle.trim()) return;

    setCreatingReward(true);
    setRewardMsg(null);

    try {
      const res = await fetch("/api/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newRewardTitle.trim(),
          description: newRewardDesc.trim(),
          required_badges: Number(newRewardBadges) || 1,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success || !data.reward) {
        throw new Error(data.message || "Kampanya oluşturulamadı.");
      }

      setSponsorRewards((prev) => [data.reward, ...prev]);
      if (!selectedRewardId) {
        setSelectedRewardId(data.reward.id);
      }
      setNewRewardTitle("");
      setNewRewardDesc("");
      setNewRewardBadges(1);
      setRewardMsg({
        type: "success",
        text: `"${data.reward.title}" sponsor kampanyası yayınlandı!`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Kampanya oluşturulamadı.";
      setRewardMsg({ type: "error", text: msg });
    } finally {
      setCreatingReward(false);
    }
  };

  // Gerçek Sponsor Uygunluk Sorgulama (POST /api/rewards/eligibility)
  const handleVerifyEligibility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentAddress.trim() || !selectedRewardId) return;

    setVerifyingStudent(true);
    setVerifyError(null);
    setEligibilityResult(null);

    try {
      const res = await fetch("/api/rewards/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reward_id: selectedRewardId,
          wallet_address: studentAddress.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Doğrulama şu an kullanılamıyor.");
      }

      setEligibilityResult({
        eligible: Boolean(data.eligible),
        badgeCount: Number(data.badgeCount ?? 0),
        required_badges: Number(data.required_badges ?? 1),
        coupon_status: data.coupon_status,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Doğrulama şu an kullanılamıyor.";
      setVerifyError(msg);
    } finally {
      setVerifyingStudent(false);
    }
  };

  // Tek Kullanımlık Sponsor Kupon Kodu Bozdurma (POST /api/coupons/redeem)
  const handleRedeemCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCodeInput.trim()) return;

    setRedeemingCoupon(true);
    setRedeemResult(null);

    try {
      const res = await fetch("/api/coupons/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCodeInput.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Kupon doğrulanamadı veya daha önce kullanılmış.");
      }

      setCouponCodeInput("");
      setRedeemResult({
        type: "success",
        text: "Kupon başarıyla doğrulandı ve kullanıldı (used) olarak işaretlendi!",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Kupon bozdurma başarısız.";
      setRedeemResult({ type: "error", text: msg });
    } finally {
      setRedeemingCoupon(false);
    }
  };

  const getEventStatusBadge = (eventDateStr: string) => {
    const startMs = new Date(eventDateStr).getTime();
    const now = Date.now();
    const openMs = startMs - 15 * 60 * 1000;
    const closeMs = startMs + 2 * 60 * 60 * 1000;

    if (now < openMs) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
          Yaklaşan
        </span>
      );
    }
    if (now <= closeMs) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Yoklama Aktif
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400">
        Tamamlandı
      </span>
    );
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6 pb-4 border-b border-slate-800">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-purple-400 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Ana Sayfaya Dön</span>
          </Link>
          <WalletMultiButton />
        </div>

        {/* Oturum Durum Çubuğu */}
        <div className="mb-8 p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            {!publicKey ? (
              <span className="text-slate-400">
                Kulüp yöneticisi veya sponsor işlemlerini yapmak için cüzdanınızı bağlayın.
              </span>
            ) : userProfile ? (
              <div className="flex items-center gap-2 text-green-400 font-medium">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  Oturum Açık ({userProfile.name || userProfile.wallet_address.slice(0, 8) + "..."}) — Rol:{" "}
                  <strong className="uppercase">{userProfile.role || "student"}</strong>
                </span>
              </div>
            ) : (
              <span className="text-amber-300">
                Cüzdan bağlandı. Yönetim ve sponsor API&apos;leri için imza ile oturum açın.
              </span>
            )}
            {authError && <p className="text-xs text-red-400 mt-1">{authError}</p>}
          </div>

          {publicKey && !userProfile && (
            <button
              onClick={handleAdminLogin}
              disabled={authLoading}
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg transition cursor-pointer"
            >
              {authLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>İmza Bekleniyor...</span>
                </>
              ) : (
                <span>Cüzdanı İmzala ve Giriş Yap</span>
              )}
            </button>
          )}
        </div>

        <h1 className="text-2xl font-bold text-purple-400 mb-2">
          Topluluk & Sponsor Yönetim Paneli
        </h1>
        <p className="text-slate-400 mb-8 text-sm">
          Etkinlik oluşturun, alttaki listeden etkinlik zamanı geldiğinde canlı QR ekranını yansıtın ve sponsor kuponlarını doğrulayın.
        </p>

        {/* Canlı QR Ekranı Kutusu (Bir etkinlik seçildiğinde üstte belirgin açılır) */}
        {activeQrEvent && (
          <div className="mb-8 bg-slate-900 border-2 border-purple-500/60 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2 text-purple-300 font-bold">
                <QrCode className="w-5 h-5" />
                <span>Canlı Katılım QR Ekranı — {activeQrEvent.title}</span>
              </div>
              <button
                onClick={() => {
                  setActiveQrEvent(null);
                  setClaimUrl("");
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Ekranı Kapat</span>
              </button>
            </div>

            {loadingQr ? (
              <div className="flex flex-col items-center justify-center bg-slate-950 rounded-xl p-10">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-2" />
                <p className="text-xs text-slate-400">QR yetkisi doğrulanıyor...</p>
              </div>
            ) : claimUrl ? (
              <div className="flex flex-col items-center bg-white p-8 rounded-xl">
                <QRCodeSVG value={claimUrl} size={230} />
                <p className="text-slate-900 font-bold text-base mt-4">{activeQrEvent.title}</p>
                <p className="text-slate-500 text-xs mt-1">
                  Öğrenciler etkinlik sayfasından kameralarını açarak bu kodu okutabilir.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center bg-slate-950 border border-amber-500/40 rounded-xl p-8 text-center">
                <Lock className="w-8 h-8 text-amber-400 mb-2" />
                <p className="text-amber-300 text-sm font-medium max-w-md">
                  {qrError || "Bu QR kodunu açmak için yetkili kulüp yöneticisi oturumu gereklidir."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Üst Bölüm: 1. Yeni Etkinlik Ekleme & 2. Sponsor İşlemleri */}
        <div className="grid md:grid-cols-2 gap-8 mb-10">
          {/* Sol: Yeni Kampüs Etkinliği Ekle */}
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 mb-4 text-purple-400 font-semibold">
              <PlusCircle className="w-5 h-5" />
              <h2>1. Yeni Kampüs Etkinliği Ekle</h2>
            </div>

            <form onSubmit={handleCreateEvent} className="space-y-4">
              {clubs.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Kulüp Seçimi</label>
                  <select
                    value={selectedClubId}
                    onChange={(e) => setSelectedClubId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  >
                    {clubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Etkinlik Başlığı</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Solana Geliştirici Buluşması"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Etkinlik Başlangıç Tarih ve Saati
                </label>
                <input
                  type="datetime-local"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              {badgeCatalog.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Verilecek cNFT Rozet Tasarımı
                  </label>
                  <select
                    value={selectedBadgeKey}
                    onChange={(e) => setSelectedBadgeKey(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  >
                    {badgeCatalog.map((b) => (
                      <option key={b.badge_key} value={b.badge_key}>
                        {b.badge_key}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Açıklama</label>
                <textarea
                  rows={2}
                  placeholder="Etkinlik hakkında kısa bilgi..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <button
                type="submit"
                disabled={creatingEvent}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {creatingEvent ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Kaydediliyor...</span>
                  </>
                ) : (
                  <span>Etkinliği Oluştur</span>
                )}
              </button>
            </form>

            {createMessage && (
              <div
                className={`mt-4 p-3 rounded-lg text-xs border ${
                  createMessage.type === "success"
                    ? "bg-green-950/50 border-green-500/40 text-green-300"
                    : "bg-red-950/50 border-red-500/40 text-red-300"
                }`}
              >
                {createMessage.text}
              </div>
            )}
          </div>

          {/* Sağ: Sponsor Kupon Bozdurma & Uygunluk Doğrulama */}
          <div className="space-y-6">
            {/* Kupon Kodu Bozdurma */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2 mb-4 text-emerald-400 font-semibold">
                <Ticket className="w-5 h-5" />
                <h2>2. Sponsor Kupon Kodu Kullan (Redeem)</h2>
              </div>

              <form onSubmit={handleRedeemCoupon} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Öğrencinin Gösterdiği Kupon Kodu
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: CPN-9F3A..."
                    value={couponCodeInput}
                    onChange={(e) => setCouponCodeInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={redeemingCoupon}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition cursor-pointer"
                >
                  {redeemingCoupon ? "Kupon İşleniyor..." : "Kuponu Doğrula ve Kullan"}
                </button>
              </form>

              {redeemResult && (
                <div
                  className={`mt-3 p-3 rounded-lg text-xs border ${
                    redeemResult.type === "success"
                      ? "bg-green-950/50 border-green-500/40 text-green-300"
                      : "bg-red-950/50 border-red-500/40 text-red-300"
                  }`}
                >
                  {redeemResult.text}
                </div>
              )}
            </div>

            {/* Öğrenci Uygunluk Sorgulama */}
            <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2 mb-4 text-green-400 font-semibold">
                <ShieldCheck className="w-5 h-5" />
                <h2>3. Öğrenci Kampanya Uygunluğu</h2>
              </div>

              <form onSubmit={handleVerifyEligibility} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Kampanya Seçin</label>
                  <select
                    value={selectedRewardId}
                    onChange={(e) => setSelectedRewardId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                  >
                    {sponsorRewards.length === 0 && (
                      <option value="">Sponsor kampanyası bulunamadı</option>
                    )}
                    {sponsorRewards.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} (Min. {r.required_badges} Rozet)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Öğrenci Cüzdan Adresi
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: A9VDvk1m..."
                    value={studentAddress}
                    onChange={(e) => setStudentAddress(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifyingStudent || !selectedRewardId}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition cursor-pointer"
                >
                  {verifyingStudent ? "Sorgulanıyor..." : "Uygunluğu Sorgula"}
                </button>
              </form>

              {verifyError && (
                <div className="mt-3 p-3 bg-amber-950/50 border border-amber-500/40 rounded-lg flex items-center gap-2 text-xs text-amber-300">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              {eligibilityResult && (
                <div
                  className={`mt-4 p-4 border rounded-lg ${
                    eligibilityResult.eligible
                      ? "bg-green-950/50 border-green-500/40"
                      : "bg-slate-950 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold mb-1 text-sm">
                    {eligibilityResult.eligible ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                        <span className="text-green-400">Kampanyaya Uygun!</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-5 h-5 text-amber-400" />
                        <span className="text-amber-300">Yetersiz Rozet</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-300">
                    Kazanılmış Rozet: <strong>{eligibilityResult.badgeCount}</strong> / Gerekli:{" "}
                    <strong>{eligibilityResult.required_badges}</strong>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Alt Bölüm: Yönetilen Etkinlikler Listesi ve Canlı QR Tetikleyicileri */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-10">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
            <div className="flex items-center gap-2 text-purple-400 font-semibold">
              <Calendar className="w-5 h-5" />
              <h2>Kayıtlı Etkinlikler Listesi ({events.length})</h2>
            </div>
            <span className="text-xs text-slate-400">
              Etkinlik zamanı geldiğinde sağdaki butondan canlı QR ekranını açabilirsiniz.
            </span>
          </div>

          {listMessage && (
            <div
              className={`mb-4 p-3 rounded-lg text-xs border ${
                listMessage.type === "success"
                  ? "bg-green-950/50 border-green-500/40 text-green-300"
                  : "bg-red-950/50 border-red-500/40 text-red-300"
              }`}
            >
              {listMessage.text}
            </div>
          )}

          {events.length > 0 ? (
            <div className="divide-y divide-slate-800">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="py-4 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-semibold text-white text-sm">{ev.title}</h3>
                      {getEventStatusBadge(ev.event_date)}
                    </div>
                    <p className="text-xs text-slate-400">
                      {new Date(ev.event_date).toLocaleString("tr-TR", {
                        dateStyle: "long",
                        timeStyle: "short",
                      })}
                      {ev.badge_key ? ` • Rozet: ${ev.badge_key}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenLiveQr(ev)}
                      className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition cursor-pointer"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Canlı QR Aç</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(ev)}
                      disabled={deletingEventId === ev.id}
                      title="Etkinliği Sil"
                      className="p-2 bg-red-950/60 hover:bg-red-600 border border-red-500/40 text-red-300 hover:text-white rounded-lg transition cursor-pointer disabled:opacity-50"
                    >
                      {deletingEventId === ev.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Henüz kayıtlı etkinlik bulunmuyor.</p>
          )}
        </div>

        {/* Sponsor Yeni Kampanya Oluşturma */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-4">
            <Gift className="w-5 h-5" />
            <h2>Yeni Sponsor Kampanyası Oluştur (Sponsor Hesabı)</h2>
          </div>

          <form onSubmit={handleCreateReward} className="grid sm:grid-cols-4 gap-3 items-end">
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Kampanya Başlığı</label>
              <input
                type="text"
                required
                placeholder="Örn: Kordon Kahve %20 İndirim"
                value={newRewardTitle}
                onChange={(e) => setNewRewardTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Gerekli Rozet Sayısı</label>
              <input
                type="number"
                min={1}
                max={10000}
                required
                value={newRewardBadges}
                onChange={(e) => setNewRewardBadges(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={creatingReward}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition cursor-pointer"
            >
              {creatingReward ? "Ekleniyor..." : "Kampanya Yayınla"}
            </button>
          </form>

          {rewardMsg && (
            <div
              className={`mt-3 p-3 rounded-lg text-xs border ${
                rewardMsg.type === "success"
                  ? "bg-green-950/50 border-green-500/40 text-green-300"
                  : "bg-red-950/50 border-red-500/40 text-red-300"
              }`}
            >
              {rewardMsg.text}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
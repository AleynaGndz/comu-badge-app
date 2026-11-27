import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { randomBytes } from "crypto";

const UUID_REGEX =
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function fail(message: string, status: number) {
    return NextResponse.json(
        { success: false, message },
        { status }
    );
}

// ADMIN YETKI KONTROLU
async function requireAdmin(): Promise<
    { userId: string } | { response: NextResponse }
> {
    const session = await getSession();

    if (!session) {
        return {
            response: fail(
                "Oturum açmanız gerekiyor.",
                401
            )
        };
    }

    const { data: user, error } = await supabase
        .from("users")
        .select("id, role")
        .eq("id", session.userId)
        .eq("wallet_address", session.walletAddress)
        .maybeSingle();

    if (error) throw error;

    if (!user || user.role !== "admin") {
        return {
            response: fail(
                "Admin yetkisi gerekiyor.",
                403
            )
        };
    }

    return { userId: user.id };
}

// ETKINLIK LISTELEME
export async function GET() {
    const { data, error } = await supabase
        .from("events")
        .select("id, title, description, event_date")
        .order("event_date", { ascending: true });

    if (error) {
        console.error(error);
        return fail("Etkinlikler getirilemedi.", 500);
    }

    return NextResponse.json(
        {
            success: true,
            events: data
        },
        {
            headers: {
                "Cache-Control": "no-store"
            }
        }
    );
}

// ETKINLIK OLUSTURMA
export async function POST(request: Request) {
    try {

        const auth = await requireAdmin();

        if ("response" in auth) {
            return auth.response;
        }

        const body = await request.json().catch(() => null);

        if (!body) {
            return fail("Geçersiz istek.", 400);
        }

        const {
            title,
            description,
            event_date,
            club_id
        } = body;

        // Baslik kontrolu
        if (
            typeof title !== "string" ||
            title.trim().length < 3 ||
            title.trim().length > 150
        ) {
            return fail(
                "Etkinlik adı 3-150 karakter olmalıdır.",
                400
            );
        }

        // Aciklama kontrolu
        if (
            description != null &&
            (
                typeof description !== "string" ||
                description.length > 2000
            )
        ) {
            return fail("Geçersiz açıklama.", 400);
        }

        // Tarih kontrolu
        if (
            typeof event_date !== "string" ||
            !/(Z|[+-]\d{2}:\d{2})$/.test(event_date)
        ) {
            return fail(
                "Geçerli etkinlik tarihi ve saati giriniz.",
                400
            );
        }

        const date = new Date(event_date);

        if (
            isNaN(date.getTime()) ||
            date.getTime() <= Date.now()
        ) {
            return fail(
                "Etkinlik tarihi gelecekte olmalıdır.",
                400
            );
        }

        // Kulup yetkisi
        let clubQuery = supabase
            .from("clubs")
            .select("id")
            .eq("admin_id", auth.userId);

        if (club_id !== undefined) {

            if (
                typeof club_id !== "string" ||
                !UUID_REGEX.test(club_id)
            ) {
                return fail("Geçersiz kulüp ID.", 400);
            }

            clubQuery = clubQuery.eq("id", club_id);
        }

        const { data: clubs, error: clubError } =
            await clubQuery.limit(2);

        if (clubError) throw clubError;

        if (!clubs || clubs.length === 0) {
            return fail("Kulüp yetkiniz bulunmuyor.", 403);
        }

        if (clubs.length > 1) {
            return fail("Lütfen bir kulüp seçiniz.", 400);
        }

        // QR token olusturma
        const qr_token = randomBytes(16).toString("hex");

        // Etkinligi kaydet
        const { data, error } = await supabase
            .from("events")
            .insert({
                club_id: clubs[0].id,
                title: title.trim(),
                description:
                    typeof description === "string"
                        ? description.trim()
                        : "",
                event_date: date.toISOString(),
                qr_token
            })
            .select(
                "id, title, description, event_date, qr_token"
            )
            .single();

        if (error) throw error;

        return NextResponse.json(
            {
                success: true,
                message: "Etkinlik oluşturuldu.",
                event: data
            },
            {
                status: 201,
                headers: {
                    "Cache-Control": "no-store"
                }
            }
        );

    } catch (error) {

        console.error(error);

        return fail("Etkinlik oluşturulamadı.", 500);
    }
}

// ETKINLIK SILME
export async function DELETE(request: Request) {
    try {

        const auth = await requireAdmin();

        if ("response" in auth) {
            return auth.response;
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id || !UUID_REGEX.test(id)) {
            return fail("Geçersiz etkinlik ID.", 400);
        }

        // Etkinligi bul
        const { data: event, error: eventError } =
            await supabase
                .from("events")
                .select("id, club_id, event_date")
                .eq("id", id)
                .maybeSingle();

        if (eventError) throw eventError;

        if (!event) {
            return fail("Etkinlik bulunamadı.", 404);
        }

        // Kulup sahipligi kontrolu
        const { data: club, error: clubError } =
            await supabase
                .from("clubs")
                .select("id")
                .eq("id", event.club_id)
                .eq("admin_id", auth.userId)
                .maybeSingle();

        if (clubError) throw clubError;

        if (!club) {
            return fail("Bu etkinliği silme yetkiniz yok.", 403);
        }

        // Katilim kaydi kontrolu
        const { data: attendance, error: attendanceError } =
            await supabase
                .from("attendance")
                .select("id")
                .eq("event_id", id)
                .limit(1);

        if (attendanceError) throw attendanceError;

        if (attendance && attendance.length > 0) {
            return fail(
                "Katılım kaydı olan etkinlik silinemez.",
                409
            );
        }

        // Katilima acilmis etkinlikleri koru
        const cutoff = new Date(
            Date.now() + 15 * 60 * 1000
        ).toISOString();

        // Etkinligi sil
        const { data: deleted, error } =
            await supabase
                .from("events")
                .delete()
                .eq("id", id)
                .eq("club_id", club.id)
                .gt("event_date", cutoff)
                .select("id")
                .maybeSingle();

        if (error?.code === "23503") {
            return fail(
                "İlişkili kayıtları olan etkinlik silinemez.",
                409
            );
        }

        if (error) throw error;

        if (!deleted) {
            return fail(
                "Katılıma açılmış etkinlik silinemez.",
                409
            );
        }

        return NextResponse.json({
            success: true,
            message: "Etkinlik silindi."
        });

    } catch (error) {

        console.error(error);

        return fail("Etkinlik silinemedi.", 500);
    }
}
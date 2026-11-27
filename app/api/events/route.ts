import { managedClubs } from "@/lib/clubs";
import { apiError, body as readBody, json, requireUser, uuid } from "@/lib/api";
import { metadataForBadge } from "@/lib/badge-catalog";
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
export async function GET(request: Request) {
    try {
        let query = supabase.from("events")
            .select("id, club_id, title, description, event_date, badge_key")
            .order("event_date", { ascending: true });
        if (new URL(request.url).searchParams.get("managed") === "true") {
            const user = await requireUser("admin");
            const clubs = await managedClubs(user.id);
            if (!clubs.length) return json({ success: true, events: [] });
            query = query.in("club_id", clubs.map(club => club.id));
        }
        const { data, error } = await query;
        if (error) throw error;
        return json({ success: true, events: data });
    } catch (error) { return apiError(error); }
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
            club_id,
            badge_key
        } = body;

        if (badge_key != null) metadataForBadge(badge_key);

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

        // Include every club this administrator belongs to.
        if (club_id !== undefined && (typeof club_id !== "string" || !UUID_REGEX.test(club_id))) {
            return fail("Geçersiz kulüp ID.", 400);
        }
        const memberships = await managedClubs(auth.userId);
        const clubs = club_id === undefined ? memberships : memberships.filter(club => club.id === club_id);

        if (!clubs || clubs.length === 0) {
            return fail("Kulüp yetkiniz bulunmuyor.", 403);
        }

        if (clubs.length > 1) {
            return fail("Lütfen bir kulüp seçiniz.", 400);
        }

        // QR token olusturma
        const qr_token = randomBytes(16).toString("hex");

        // Etkinligi kaydet
        const { data, error } = await supabase.rpc("create_club_event", {
            p_admin_id: auth.userId, p_club_id: clubs[0].id, p_title: title.trim(),
            p_description: typeof description === "string" ? description.trim() : "",
            p_event_date: date.toISOString(), p_qr_token: qr_token, p_badge_key: badge_key ?? null
        });

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

        return apiError(error);
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

        const { error } = await supabase.rpc("delete_club_event", {
            p_admin_id: auth.userId, p_event_id: id
        });
        if (error?.code === "23503") return fail("İlişkili kayıtları olan etkinlik silinemez.", 409);
        if (error) throw error;

        return NextResponse.json({
            success: true,
            message: "Etkinlik silindi."
        });

    } catch (error) {

        console.error(error);

        return apiError(error);
    }
}
// Assign a catalog badge to an existing event before attendance starts.
export async function PATCH(request: Request) {
    try {
        const user = await requireUser("admin");
        const input = await readBody(request);
        const eventId = uuid(input.event_id);
        metadataForBadge(input.badge_key);
        const { error } = await supabase.rpc("assign_event_badge", {
            p_admin_id: user.id, p_event_id: eventId, p_badge_key: input.badge_key
        });
        if (error) throw error;
        return json({ success: true });
    } catch (error) { return apiError(error); }
}

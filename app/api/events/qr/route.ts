import { requireClubAdmin } from "@/lib/clubs";
import { apiError } from "@/lib/api";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {

    try {

        // Oturum kontrolu
        const session = await getSession();

        if (!session) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Admin kontrolu
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, role")
            .eq("id", session.userId)
            .eq("wallet_address", session.walletAddress)
            .maybeSingle();

        if (userError) throw userError;

        if (!user || user.role !== "admin") {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Etkinlik ID'sini al
        const url = new URL(request.url);
        const eventId = url.searchParams.get("event");

        if (
            !eventId ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId)
        ) {
            return NextResponse.json(
                { success: false, message: "Invalid event ID" },
                { status: 400 }
            );
        }

        // Etkinligi bul
        const { data: event, error: eventError } = await supabase
            .from("events")
            .select("id, title, club_id, qr_token")
            .eq("id", eventId)
            .maybeSingle();

        if (eventError) throw eventError;

        if (!event) {
            return NextResponse.json(
                { success: false, message: "Event not found" },
                { status: 404 }
            );
        }

        await requireClubAdmin(user.id, event.club_id);

        // QR kodun icerecegi baglantiyi olustur
        const params = new URLSearchParams({
            event: event.id,
            name: event.title,
            token: event.qr_token
        });

        const claimPath = `/claim?${params.toString()}`;

        return NextResponse.json(
            {
                success: true,
                event_id: event.id,
                title: event.title,
                claim_path: claimPath
            },
            {
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
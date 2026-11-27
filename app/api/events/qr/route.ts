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

        // Kulup sahipligini kontrol et
        const { data: club, error: clubError } = await supabase
            .from("clubs")
            .select("id")
            .eq("id", event.club_id)
            .eq("admin_id", user.id)
            .maybeSingle();

        if (clubError) throw clubError;

        if (!club) {
            return NextResponse.json(
                { success: false, message: "Club access denied" },
                { status: 403 }
            );
        }

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

        return NextResponse.json(
            { success: false, message: "QR creation failed" },
            { status: 500 }
        );
    }
}
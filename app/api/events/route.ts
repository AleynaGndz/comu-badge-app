import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

// ETKINLIK LISTELEME
export async function GET() {

    const { data, error } = await supabase
        .from("events")
        .select("id, title, description, event_date")
        .order("event_date", { ascending: true });

    if (error) {
        return NextResponse.json(
            { success: false, message: "Events could not be retrieved" },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        events: data
    });
}

// ETKINLIK OLUSTURMA
export async function POST(request: Request) {

    try {

        // 1. Oturum kontrolu
        const session = await getSession();

        if (!session) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // 2. Admin kontrolu
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, role")
            .eq("id", session.userId)
            .eq("wallet_address", session.walletAddress)
            .maybeSingle();

        if (userError) {
            throw userError;
        }

        if (!user || user.role !== "admin") {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // 3. Etkinlik bilgilerini al
        const body = await request.json().catch(() => null);

        if (!body) {
            return NextResponse.json(
                { success: false, message: "Invalid JSON" },
                { status: 400 }
            );
        }

        const { title, description, event_date, club_id } = body;

        if (
            typeof title !== "string" ||
            !title.trim() ||
            title.length > 150 ||
            typeof event_date !== "string" ||
            typeof club_id !== "string" ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(club_id) ||
            (description != null &&
                (typeof description !== "string" ||
                 description.length > 2000))
        ) {
            return NextResponse.json(
                { success: false, message: "Invalid event data" },
                { status: 400 }
            );
        }

        const date = new Date(event_date);

        if (
            isNaN(date.getTime()) ||
            !/(Z|[+-]\d{2}:\d{2})$/.test(event_date) ||
            date.getTime() <= Date.now()
        ) {
            return NextResponse.json(
                { success: false, message: "Invalid event date" },
                { status: 400 }
            );
        }

        // 4. Kulup yetkisini kontrol et
        const { data: club, error: clubError } = await supabase
            .from("clubs")
            .select("id")
            .eq("id", club_id)
            .eq("admin_id", user.id)
            .maybeSingle();

        if (clubError) {
            throw clubError;
        }

        if (!club) {
            return NextResponse.json(
                { success: false, message: "Club access denied" },
                { status: 403 }
            );
        }

        // 5. Benzersiz QR token olustur
        const qr_token = randomUUID();

        // 6. Etkinligi veritabanina kaydet
        const { data: event, error } = await supabase
            .from("events")
            .insert({
                club_id,
                title: title.trim(),
                description: description ?? null,
                event_date: date.toISOString(),
                qr_token
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return NextResponse.json(
            {
                success: true,
                message: "Event created successfully",
                event
            },
            {
                status: 201,
                headers: { "Cache-Control": "no-store" }
            }
        );

    } catch (error) {

        console.error(error);

        return NextResponse.json(
            { success: false, message: "Event creation failed" },
            { status: 500 }
        );
    }
}
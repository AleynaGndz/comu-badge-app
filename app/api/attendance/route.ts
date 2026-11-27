import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
    try {

        // 1. Oturum kontrolu
        const session = await getSession();

        if (!session) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Unauthorized"
                },
                { status: 401 }
            );
        }

        // 2. Kullanici kontrolu
        const { data: user, error: userError } =
            await supabase
                .from("users")
                .select("id, role")
                .eq("id", session.userId)
                .eq("wallet_address", session.walletAddress)
                .maybeSingle();

        if (userError) throw userError;

        if (!user || user.role !== "student") {
            return NextResponse.json(
                {
                    success: false,
                    message: "Student access required"
                },
                { status: 403 }
            );
        }

        // 3. QR bilgilerini al
        const body = await request.json().catch(() => null);

        const event_id = body?.event_id;
        const qr_token = body?.qr_token;

        if (
            typeof event_id !== "string" ||
            !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event_id) ||
            typeof qr_token !== "string" ||
            !qr_token ||
            qr_token.length > 128
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid QR data"
                },
                { status: 400 }
            );
        }

        // 4. Etkinligi bul
        const { data: event, error: eventError } =
            await supabase
                .from("events")
                .select("id, title, qr_token, event_date")
                .eq("id", event_id)
                .maybeSingle();

        if (eventError) throw eventError;

        if (!event) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Event not found"
                },
                { status: 404 }
            );
        }

        // 5. QR token kontrolu
        if (event.qr_token !== qr_token) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid QR token"
                },
                { status: 403 }
            );
        }

        // 6. Katilim zamani kontrolu
        const now = Date.now();
        const start = new Date(event.event_date).getTime();

        const opensAt = start - 15 * 60 * 1000;
        const closesAt = start + 2 * 60 * 60 * 1000;

        if (now < opensAt || now > closesAt) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Attendance is closed"
                },
                { status: 403 }
            );
        }

        // 7. Katilim kaydini olustur
        const { data: attendance, error } =
            await supabase
                .from("attendance")
                .insert({
                    user_id: user.id,
                    event_id: event.id,
                    mint_status: "pending"
                })
                .select("id, event_id, mint_status")
                .single();

        // Ayni etkinlige ikinci kez katilim
        if (error?.code === "23505") {
            return NextResponse.json(
                {
                    success: false,
                    message: "Already attended"
                },
                { status: 409 }
            );
        }

        if (error) throw error;

        return NextResponse.json(
            {
                success: true,
                message: "Attendance recorded successfully",
                attendance
            },
            { status: 201 }
        );

    } catch (error) {
        console.error(error);

        return NextResponse.json(
            {
                success: false,
                message: "Attendance failed"
            },
            { status: 500 }
        );
    }
}
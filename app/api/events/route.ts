import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
    const { data, error } = await supabase
        .from("events")
        .select("id, title, description, event_date")
        .order("event_date", { ascending: true });

    if (error) {
            console.error("Supabase Insert Hatası:", error);
            return NextResponse.json(
                { 
                    success: false, 
                    message: `Veritabanı hatası: ${error.message}` 
                },
                { status: 500 }
            );
        }

    return NextResponse.json({
        success: true,
        events: data
    });
}

export async function POST(request: Request) {
    try {
        const { title, description, event_date } = await request.json();

        if (typeof title !== "string" || title.trim().length < 3) {
            return NextResponse.json(
                { success: false, message: "Etkinlik adı en az 3 karakter olmalıdır." },
                { status: 400 }
            );
        }

        if (typeof event_date !== "string" || !event_date.trim()) {
            return NextResponse.json(
                { success: false, message: "Etkinlik tarihi zorunludur." },
                { status: 400 }
            );
        }

        const { data, error } = await supabase
            .from("events")
            .insert({
                title: title.trim(),
                description: typeof description === "string" ? description.trim() : "",
                event_date: new Date(event_date).toISOString(),
            })
            .select("id, title, description, event_date")
            .single();

        if (error) {
            console.error(error);
            return NextResponse.json(
                { success: false, message: "Etkinlik veritabanına eklenemedi." },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Etkinlik oluşturuldu.",
            event: data,
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json(
            { success: false, message: "Geçersiz istek." },
            { status: 400 }
        );
    }
}
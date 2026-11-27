import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { randomBytes } from "crypto";

export async function GET() {
    const { data, error } = await supabase
        .from("events")
        .select("id, title, description, event_date, qr_token")
        .order("event_date", { ascending: true });

    if (error) {
        console.error(error);
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

        const qr_token = randomBytes(16).toString("hex");

        const { data, error } = await supabase
            .from("events")
            .insert({
                title: title.trim(),
                description: typeof description === "string" ? description.trim() : "",
                event_date: new Date(event_date).toISOString(),
                qr_token,
            })
            .select("id, title, description, event_date, qr_token")
            .single();

        if (error) {
            console.error("Supabase Insert Hatası:", error);
            return NextResponse.json(
                {
                    success: false,
                    message: `Veritabanı hatası: ${error.message}`,
                },
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
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { success: false, message: "Silinecek etkinlik ID'si belirtilmedi." },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from("events")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Supabase Delete Hatası:", error);
            return NextResponse.json(
                { success: false, message: `Silme hatası: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Etkinlik silindi.",
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json(
            { success: false, message: "Geçersiz silme isteği." },
            { status: 400 }
        );
    }
}
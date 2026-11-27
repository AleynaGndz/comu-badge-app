import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {

    const { data, error } = await supabase
        .from("events")
        .select("id, title, description, event_date")
        .order("event_date", { ascending: true });

    if (error) {
        console.error(error);

        return NextResponse.json(
            {
                success: false,
                message: "Events could not be retrieved"
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        events: data
    });
}
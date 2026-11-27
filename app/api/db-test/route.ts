import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
    const { error } = await supabase
        .from("users")
        .select("id")
        .limit(1);

    if (error) {
        console.error(error);

        return NextResponse.json(
            {
                success: false,
                message: "Database connection failed"
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        message: "Database connection successful!"
    });
}
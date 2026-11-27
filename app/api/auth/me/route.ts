import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {

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

    const { data: user, error } = await supabase
        .from("users")
        .select("id, wallet_address, name, role")
        .eq("id", session.userId)
        .eq("wallet_address", session.walletAddress)
        .maybeSingle();

    if (error) {
        return NextResponse.json(
            { success: false, message: "Database error" },
            { status: 500 }
        );
    }

    if (!user) {
        return NextResponse.json(
            { success: false, message: "User not found" },
            { status: 401 }
        );
    }

    return NextResponse.json({
        success: true,
        user
    });
}
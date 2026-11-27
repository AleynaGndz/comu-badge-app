import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { randomBytes } from "crypto";
import bs58 from "bs58";

export async function POST(request: Request) {
    try {
        const { wallet_address } = await request.json();

        if (typeof wallet_address !== "string") {
            return NextResponse.json(
                { success: false, message: "Invalid wallet address" },
                { status: 400 }
            );
        }

        try {
            if (bs58.decode(wallet_address).length !== 32) {
                throw new Error();
            }
        } catch {
            return NextResponse.json(
                { success: false, message: "Invalid Solana wallet" },
                { status: 400 }
            );
        }

        const nonce = randomBytes(32).toString("hex");

        const expiresAt = new Date(
            Date.now() + 5 * 60 * 1000
        ).toISOString();

        const { error } = await supabase
            .from("auth_nonces")
            .insert({
                wallet_address,
                nonce,
                expires_at: expiresAt
            });

        if (error) {
            console.error(error);
            return NextResponse.json(
                { success: false, message: "Nonce creation failed" },
                { status: 500 }
            );
        }

        const message =
            `CampusPass Login\nWallet: ${wallet_address}\nNonce: ${nonce}`;

        return NextResponse.json({
            success: true,
            nonce,
            message,
            expires_at: expiresAt
        });

    } catch {
        return NextResponse.json(
            { success: false, message: "Invalid request" },
            { status: 400 }
        );
    }
}
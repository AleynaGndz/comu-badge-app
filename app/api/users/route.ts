import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SignJWT } from "jose";

export async function POST(request: Request) {
    try {
        const { wallet_address, nonce, signature } =
            await request.json();

        if (
            typeof wallet_address !== "string" ||
            typeof nonce !== "string" ||
            !Array.isArray(signature) ||
            signature.length !== 64 ||
            !signature.every(
                (n) => Number.isInteger(n) && n >= 0 && n <= 255
            )
        ) {
            return NextResponse.json(
                { success: false, message: "Invalid request" },
                { status: 400 }
            );
        }

        let publicKey: Uint8Array;

        try {
            publicKey = bs58.decode(wallet_address);

            if (publicKey.length !== 32) {
                throw new Error();
            }
        } catch {
            return NextResponse.json(
                { success: false, message: "Invalid wallet" },
                { status: 400 }
            );
        }

        const message =
            `CampusPass Login\nWallet: ${wallet_address}\nNonce: ${nonce}`;

        const verified = nacl.sign.detached.verify(
            new TextEncoder().encode(message),
            Uint8Array.from(signature),
            publicKey
        );

        if (!verified) {
            return NextResponse.json(
                { success: false, message: "Invalid signature" },
                { status: 401 }
            );
        }

        const secret = process.env.JWT_SECRET;

        if (!secret || secret.length < 32) {
            throw new Error("JWT_SECRET is missing");
        }

        // Nonce kontrolü ve tek kullanımlık tüketim

        const { data: challenge, error: nonceError } =
            await supabase
                .from("auth_nonces")
                .update({ used: true })
                .eq("wallet_address", wallet_address)
                .eq("nonce", nonce)
                .eq("used", false)
                .gt("expires_at", new Date().toISOString())
                .select("id")
                .maybeSingle();

        if (nonceError) {
            throw nonceError;
        }

        if (!challenge) {
            return NextResponse.json(
                { success: false, message: "Invalid or expired nonce" },
                { status: 401 }
            );
        }

        // Kullanıcı daha önce kayıtlı değilse oluştur

        const { error: insertError } = await supabase
            .from("users")
            .upsert(
                { wallet_address },
                {
                    onConflict: "wallet_address",
                    ignoreDuplicates: true
                }
            );

        if (insertError) {
            throw insertError;
        }

        const { data: user, error: userError } =
            await supabase
                .from("users")
                .select("id, wallet_address, name, role")
                .eq("wallet_address", wallet_address)
                .single();

        if (userError) {
            throw userError;
        }

        // JWT oturumu oluştur

        const token = await new SignJWT({
            wallet_address: user.wallet_address
        })
            .setProtectedHeader({ alg: "HS256" })
            .setSubject(user.id)
            .setIssuer("campuspass")
            .setAudience("campuspass")
            .setIssuedAt()
            .setExpirationTime("2h")
            .sign(new TextEncoder().encode(secret));

        const response = NextResponse.json({
            success: true,
            message: "Login successful",
            user
        });

        response.cookies.set("campuspass_session", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7200,
            path: "/"
        });

        return response;

    } catch (error) {
        console.error(error);

        return NextResponse.json(
            { success: false, message: "Login failed" },
            { status: 500 }
        );
    }
}
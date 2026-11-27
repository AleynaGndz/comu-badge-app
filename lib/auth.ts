import "server-only";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export async function getSession() {

    const cookieStore = await cookies();

    const token = cookieStore.get(
        "campuspass_session"
    )?.value;

    if (!token) {
        return null;
    }

    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET is missing");
    }

    try {

        const { payload } = await jwtVerify(
            token,
            new TextEncoder().encode(secret),
            {
                algorithms: ["HS256"],
                issuer: "campuspass",
                audience: "campuspass"
            }
        );

        if (
            typeof payload.sub !== "string" ||
            typeof payload.wallet_address !== "string"
        ) {
            return null;
        }

        return {
            userId: payload.sub,
            walletAddress: payload.wallet_address
        };

    } catch {
        return null;
    }
}
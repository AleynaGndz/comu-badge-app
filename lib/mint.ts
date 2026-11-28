import "server-only";

import { createUmi } from
    "@metaplex-foundation/umi-bundle-defaults";

import {
    keypairIdentity,
    publicKey,
    none
} from "@metaplex-foundation/umi";

import {
    mplBubblegum,
    mintV2
} from "@metaplex-foundation/mpl-bubblegum";

// SOLANA BAGLANTISI
export function getUmi() {

    const rpcUrl = process.env.SOLANA_RPC_URL;
    const secret = process.env.MINT_SECRET_KEY;

    if (!rpcUrl || !secret) {
        throw new Error(
            "Solana environment variables are missing"
        );
    }

    const umi = createUmi(rpcUrl)
        .use(mplBubblegum());

    const parsed: unknown = JSON.parse(secret);
    if (!Array.isArray(parsed) || parsed.length !== 64 ||
        !parsed.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
        throw new Error("MINT_SECRET_KEY must contain 64 bytes");
    }
    const secretKey = Uint8Array.from(parsed);

    const keypair =
        umi.eddsa.createKeypairFromSecretKey(
            secretKey
        );

    umi.use(keypairIdentity(keypair));

    return umi;
}

// CNFT MINT ISLEMINI HAZIRLA
export function buildBadgeMint(
    walletAddress: string,
    title: string,
    metadataUri: string
) {

    const umi = getUmi();

    const treeAddress =
        process.env.MERKLE_TREE_ADDRESS;

    if (!treeAddress) {
        throw new Error(
            "Merkle Tree address is missing"
        );
    }

    // NFT ismi en fazla 32 byte
    let name = "";

    for (const char of title) {

        if (Buffer.byteLength(name + char) > 32) {
            break;
        }

        name += char;
    }

    const builder = mintV2(umi, {

        leafOwner: publicKey(walletAddress),

        merkleTree: publicKey(treeAddress),

        treeCreatorOrDelegate: umi.identity,

        metadata: {
            name,
            uri: metadataUri,
            sellerFeeBasisPoints: 0,
            collection: none(),
            creators: [
                {
                    address: umi.identity.publicKey,
                    verified: false,
                    share: 100
                }
            ]
        }
    });

    return { umi, builder };
}
// Sign before broadcasting so the exact transaction can be persisted and resent.
export async function prepareBadgeMint(walletAddress: string, title: string, metadataUri: string) {
    const { umi, builder } = buildBadgeMint(walletAddress, title, metadataUri);
    const blockhash = await umi.rpc.getLatestBlockhash({ commitment: "finalized" });
    const transaction = await builder.setBlockhash(blockhash).buildAndSign(umi);
    return {
        signed_transaction: Buffer.from(umi.transactions.serialize(transaction)).toString("base64"),
        tx_signature: (await import("bs58")).default.encode(transaction.signatures[0]),
        last_valid_block_height: blockhash.lastValidBlockHeight,
        rpc_url: process.env.SOLANA_RPC_URL!,
        tree_address: process.env.MERKLE_TREE_ADDRESS!,
    };
}

const readClients = new Map<string, ReturnType<typeof createUmi>>();

// This also works after key rotation: resending a persisted transaction needs no signer.
export function mintRpc(rpcUrl: string) {
    let umi = readClients.get(rpcUrl);
    if (!umi) { umi = createUmi(rpcUrl).use(mplBubblegum()); readClients.set(rpcUrl, umi); }
    return umi;
}

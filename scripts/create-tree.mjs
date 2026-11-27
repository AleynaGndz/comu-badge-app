import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

import {
    generateSigner,
    keypairIdentity
} from "@metaplex-foundation/umi";

import {
    mplBubblegum,
    createTreeV2
} from "@metaplex-foundation/mpl-bubblegum";

import bs58 from "bs58";

async function main() {

    // 1. Daha once tree olusturulmus mu?
    if (process.env.MERKLE_TREE_ADDRESS) {
        throw new Error("Merkle Tree zaten mevcut.");
    }

    // 2. Solana Devnet baglantisi
    const umi = createUmi(
        "https://api.devnet.solana.com"
    ).use(mplBubblegum());

    // 3. Mint Wallet'i yukle
    const secretKey = Uint8Array.from(
        JSON.parse(process.env.MINT_SECRET_KEY)
    );

    const keypair =
        umi.eddsa.createKeypairFromSecretKey(secretKey);

    umi.use(keypairIdentity(keypair));

    console.log("Mint Wallet:", umi.identity.publicKey);

    // 4. Bakiye kontrolu
    const balance = await umi.rpc.getBalance(
        umi.identity.publicKey
    );

    const solBalance =
        Number(balance.basisPoints) / 1e9;

    console.log("Balance:", solBalance, "SOL");

    if (solBalance < 0.4) {
        throw new Error("En az 0.4 Devnet SOL gerekli.");
    }

    // 5. Merkle Tree olustur
    const merkleTree = generateSigner(umi);

    console.log("Merkle Tree:", merkleTree.publicKey);
    console.log("Merkle Tree olusturuluyor...");

    const builder = await createTreeV2(umi, {
        merkleTree,
        maxDepth: 14,
        maxBufferSize: 64,
        canopyDepth: 8,
        public: false
    });

    // 6. Blockchain islemini gonder
    const result = await builder.sendAndConfirm(umi);

    if (result.result.value.err) {
        throw new Error("Blockchain islemi basarisiz.");
    }

    console.log("Merkle Tree basariyla olusturuldu!");
    console.log("Tree Address:", merkleTree.publicKey);
    console.log("Transaction:", bs58.encode(result.signature));

}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
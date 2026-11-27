# 🎓 COMU Badge App (Campus Badges & Sponsor Rewards)

**A Solana-based campus engagement platform that turns university event attendance into verifiable Compressed NFT (cNFT) badges and local sponsor rewards, powered by Metaplex Bubblegum.**

> *Built for the Dev3pack Global Hackathon – Çanakkale Build Station (YGK & Comuchain).*

## Integration status

Backend API contracts, database migration, setup, tests, and recovery instructions
are documented in [docs/backend.md](docs/backend.md). The wallet login → QR
attendance → Devnet mint → collection and reward/coupon backend flows have been
live-tested. The latest frontend is merged, but integration work remains:

- Claim requests must handle HTTP 202 by polling the same claim until HTTP 200.
- Devnet deposits use a separate server custody wallet: confirmed 0.5 SOL payment,
  QR-triggered refund, and admin-triggered equal no-show distribution are implemented.
  This is a test custody flow, not a deployed escrow smart contract; see backend docs.
- Sponsor cards currently contain demo promo codes; connect them to the real
  rewards, eligibility and coupon APIs before offering real rewards.
- Connect wallet disconnect/account change to server logout. Fix the admin form
  datetime format and remove fallback QR/sponsor success behavior.

---

## 🎯 The Problem
University student clubs still rely on manual, fragmented, and easily forged processes to track event attendance and issue certificates. Meanwhile, local sponsors (cafes, businesses) supporting campus events lack a transparent way to verify whether their perks and discounts actually reach participating students.

## 💡 The Solution
**COMU Badge App** transforms campus event participation into on-chain, verifiable **Compressed NFT (cNFT)** badges in seconds:

1. **Event & QR Management (`/admin`):** Student club organizers create new events via the admin panel and generate unique attendance QR codes.
2. **Instant Badge Claiming (`/claim`):** Students scan the event QR code, connect their Solana wallet (Phantom), verify ownership via cryptographic signature, and claim their cNFT badge directly to their wallet.
3. **QR Scanning & Reward Verification (`/scan`):** Students who collect a set number of badges (e.g., 3 event badges = a free coffee voucher) can verify their on-chain badges at partner local venues using the built-in in-browser QR scanner to redeem rewards.

---

## ⚡ Key Technical Highlights
* **Ultra-Low-Cost cNFT Minting:** Powered by **Metaplex Bubblegum, Umi, and Merkle Trees** on Solana Devnet (with Helius/Shyft RPC/API support), enabling scalable badge distribution to thousands of students at minimal cost.
* **Cryptographic Security:** Uses **TweetNaCl** (Ed25519 signature verification), **bs58**, and **JOSE (JWT)** for secure wallet authentication and session integrity.
* **End-to-End QR Experience:** Dynamic QR generation with `qrcode.react` paired with a built-in browser QR scanner (`html5-qrcode`) on `/scan`—no external scanner app required.
* **Decentralized Metadata:** All badge artwork and JSON metadata are hosted on **IPFS via Pinata** and mapped through `badges.json`.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Framework & UI** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Lucide Icons |
| **Blockchain & cNFT** | Solana (Devnet), `@solana/web3.js`, Metaplex Bubblegum (`mpl-bubblegum`), Metaplex Umi, Helius/Shyft API |
| **Wallet & Auth** | Solana Wallet Adapter (Phantom), `tweetnacl`, `bs58`, `jose` (JWT) |
| **Database & API** | Supabase (`@supabase/supabase-js`), Next.js Route Handlers |
| **QR & Storage** | `qrcode.react`, `html5-qrcode`, Pinata (IPFS) |

---

## 📂 Project Structure

```text
comu-badge-app/
├── app/
│   ├── admin/                      # Club event creation and management dashboard
│   ├── api/
│   │   ├── badges/                 # Wallet badge lookup and verification API
│   │   ├── events/                 # Event creation and listing API
│   │   └── health/                 # Service health check endpoint
│   ├── claim/                      # QR-triggered cNFT badge claim page
│   ├── scan/                       # In-browser QR scanner and verification page
│   ├── WalletContextProvider.tsx   # Solana Wallet Adapter configuration
│   ├── layout.tsx                  # Root layout and context providers
│   └── page.tsx                    # Home page and event feed
├── lib/
│   └── supabase.ts                 # Supabase client configuration
├── public/                         # Static assets and visuals
└── badges.json                     # Pinata (IPFS) badge metadata mapping
```

---

## 🚀 Getting Started

### Prerequisites
* Node.js 22 or newer
* Phantom Wallet browser extension (configured to **Solana Devnet**)

### 1. Clone the Repository
```bash
git clone https://github.com/AleynaGndz/comu-badge-app.git
cd comu-badge-app
```

### 2. Install Dependencies
Install the versions recorded in the lockfile:
```bash
npm ci
```

### 3. Configure Environment Variables (`.env.local`)
Create a `.env.local` file in the root directory and add your Supabase, Solana/RPC, and JWT credentials:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

JWT_SECRET=your_random_secret_at_least_32_characters
SOLANA_RPC_URL=https://api.devnet.solana.com
MINT_SECRET_KEY=your_64_byte_json_key_array
MERKLE_TREE_ADDRESS=your_bubblegum_v2_tree_address
```

### 4. Run the Development Server
```bash
npm run dev
```

Open `http://localhost:3000` in your browser to view the application.

---

## 👥 Team
* **Özber Var** (`@ozbervar`) — **Web3, Backend  & Pitch Delivery:** Solana Devnet configuration, Helius/Shyft API setup, Merkle Tree creation, cNFT minting API endpoint development and pitch & Demo Day presentations .
* **Aleyna Gündüz** (`@AleynaGndz`) — **Frontend & Integration:** Next.js project setup, Phantom wallet integration, QR code generation/scanning interfaces, and student/sponsor UI pages.
* **Berra Çalım** (`@calimberra`) — **Design, Metadata & Presentation Prep:** Badge artwork design, Pinata (IPFS) hosting & JSON metadata preparation (`badges.json`), preparing the pitch & Demo Day presentation decks and live testing management.

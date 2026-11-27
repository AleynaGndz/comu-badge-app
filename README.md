# 🎓 COMU Badge App (Campus Badges & Sponsor Rewards)

**A Solana-based campus engagement platform that turns university event attendance into verifiable Compressed NFT (cNFT) badges and local sponsor rewards, powered by Metaplex Bubblegum.**

> *Built for the Dev3pack Global Hackathon – Çanakkale Build Station (YGK & Comuchain).*

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
* Node.js (v20+ LTS recommended)
* Phantom Wallet browser extension (configured to **Solana Devnet**)

### 1. Clone the Repository
```bash
git clone [https://github.com/AleynaGndz/comu-badge-app.git](https://github.com/AleynaGndz/comu-badge-app.git)
cd comu-badge-app
```

### 2. Install Dependencies
Use `--legacy-peer-deps` to resolve peer dependency conflicts between `@solana/web3.js` v3 and the Solana Wallet Adapter packages:
```bash
npm install --legacy-peer-deps
```

### 3. Configure Environment Variables (`.env.local`)
Create a `.env.local` file in the root directory and add your Supabase, Solana/RPC, and JWT credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Add your Solana / Helius / Merkle Tree / JWT environment variables here
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
# ÇOMÜ CampusPass backend

Next.js App Router + Supabase PostgreSQL + Solana Bubblegum V2 compressed NFT.
Frontend files are maintained separately; this backend does not require changing
wallet adapters or redesigning the UI.

## Setup

1. `npm ci` (Node 22 or newer).
2. Copy `.env.example` to `.env.local` and fill the server credentials. Keep the
   existing `.env.local` if it already contains credentials.
3. Apply `supabase/migrations/20261127200639_backend_completion.sql` to the app's
   Supabase project using its SQL Editor, or the linked Supabase CLI migration
   workflow. The migration supports an empty database and the existing seven
   tables. It adds uniqueness, RLS, mint jobs, and service-only transactional RPCs.
   Duplicate legacy data causes a rollback; it is never deleted automatically.
   Existing single-column status checks retain their legacy values and also
   permit the final `minted` status used by this backend.
4. `JWT_SECRET`: at least 32 characters; generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   `MINT_SECRET_KEY`: JSON array of 64 byte values, server-only. Do not reuse a
   funded mainnet wallet for development.
5. `SOLANA_RPC_URL` and `MERKLE_TREE_ADDRESS` must be on the same network. The
   current frontend uses **Devnet**. Use an existing Bubblegum V2 tree delegated
   to the mint signer, or run `npm run create-tree` once with a funded Devnet
   signer. This command submits a real tree-creation transaction; save its printed
   tree address in `.env.local`. Restart the server after changing configuration.
6. Assign users' `admin` / `sponsor` roles and `clubs.admin_id` through trusted
   database administration. Public registration always defaults to `student`;
   there is no public role-escalation endpoint.
7. `npm run dev`.

`SUPABASE_SERVICE_ROLE_KEY`, JWT secrets, RPC credentials, and mint keys must never
be prefixed `NEXT_PUBLIC_`. Database access is server-only. Custom wallet JWTs
are validated by Next.js, not Supabase Auth; `anon` / `authenticated` cannot read
or mutate these tables or call the backend RPCs. Service-role functions use
`SECURITY INVOKER` with a fixed search path.

## Checks

- `npm run test:backend`: route tests, signature/JWT checks, mint recovery tests,
  and real PostgreSQL engine tests using in-memory PGlite. No live DB writes or
  blockchain transactions are made by the test suite.
- `npm run lint:backend`
- `npm run check:backend`: read-only environment/migration readiness check. It
  reports variable names and missing schema objects, never credential values.
  `supabase/verify_backend.sql` provides additional SQL Editor checks for indexes,
  RLS, defaults, and RPC privileges after migration.
- `npm run typecheck:backend`: checks API and server helpers independently of
  generated `.next` duplicates and unrelated frontend lint errors.
- `.github/workflows/backend.yml` runs those checks on push / pull request.
- `npm run build` validates the full application, including frontend code.

The tests mock RPC/network responses; they do not prove that a configured tree,
funded signer, or production deployment works. Validate these on Devnet before
release. The README is configuration guidance, not a claim that a migration or
on-chain transaction has already been performed.

## API and frontend handoff

All authenticated calls use the same-origin `campuspass_session` HTTP-only cookie.
All JSON API responses below use `Cache-Control: no-store`. Failed requests return
`{ success: false, message }` and an appropriate non-2xx status. Do not replace
failures with demo data or assume an HTTP 202 means a successful mint.

### Login / logout

- `POST /api/auth/nonce` `{ wallet_address }` → `{ nonce, message, expires_at }`.
  Sign the returned message with the connected wallet.
- `POST /api/users` `{ wallet_address, nonce, signature: number[] }` verifies the
  signature and consumes the unexpired nonce once, then sets the session cookie.
- `GET /api/auth/me` returns the authenticated user.
- `PATCH /api/users` `{ name }` changes only the session user's display name.
- `POST /api/auth/logout` expires the cookie and returns `{ success: true }`.
  Frontend must call it on wallet disconnect/account change and require a fresh
  signed login for another account. Clearing local React state alone is not logout.

Nonce issuance is transactionally limited to 5 per wallet/minute and 300 globally
per minute. `TRUST_PROXY=true` additionally enables 30/minute per HMAC-hashed
source from `x-forwarded-for`; use only behind a proxy that overwrites the header.
Expired nonces older than one day are removed during issuance, without removing
recent history used for rate limiting.

### Clubs, events, and QR

- `GET /api/clubs` (admin): own `{ clubs: [{ id, name }] }` for the club picker.
- `GET /api/badges/catalog`: available `{ badges: [{ badge_key, metadata_uri }] }`.
- `GET /api/events`: public event list, including `club_id`, `badge_key`, without
  QR secrets.
- `POST /api/events` (admin): `{ title, description?, event_date, club_id?, badge_key? }`.
  `event_date` must contain a timezone and be in the future. Use a `datetime-local`
  field and send `new Date(value).toISOString()`. `club_id` is required when the
  admin manages multiple clubs. `badge_key` is optional for compatibility; an
  unmapped event cannot mint until assigned a catalog key.
- `PATCH /api/events` (owning admin): `{ event_id, badge_key }` sets the badge.
  Badge assignment is frozen once attendance exists. One initial assignment is
  allowed for a legacy unmapped event whose attendance is still pending and has
  no mint job, asset, or transaction.
- `DELETE /api/events?id=UUID` (owning admin): refuses events already open for
  attendance or with attendance records.
- `GET /api/events/qr?event=UUID` (owning admin): `{ claim_path }` including `event`,
  `name`, `token`. Show a QR only on a successful API response. Clear the old QR
  when selection changes; cancel stale requests. The scanner must accept only
  this application's origin and `/claim` path with valid `event` and `token`.

### Attendance → claim → badges

- `POST /api/attendance` (student): `{ event_id, qr_token }` creates attendance
  from 15 minutes before until 2 hours after the event. Duplicate attendance is
  HTTP 409. Role, token, time and uniqueness are checked in the database transaction.
- `POST /api/claim` (student): `{ event_id, qr_token, retry_failed?: boolean }`.
  It can create attendance itself, so calling `/api/attendance` first is optional.
  `eventId` and `token` aliases are supported. If `walletAddress` is supplied it
  must match the signed-in wallet; the backend derives the recipient from the
  session. Existing attendance permits later claim/retry without another QR.
- HTTP **202**: `{ success: false, processing: true, mint_status, txSignature }`.
  Wait for `Retry-After` (3 seconds), then POST the same claim again. Do not show
  the “badge sent” screen yet.
- HTTP **200**: `{ success: true, processing: false, mint_status: 'confirmed',
  txSignature, assetId }`. Only returned after finalized chain success and an
  atomic database update. Repeated completed claims return the same result.
- HTTP **409** for a finalized failure: the owner may explicitly retry with
  `retry_failed: true`. The backend independently rechecks the finalized failure
  before atomically archiving the old signature and preparing another attempt.
- `GET /api/badges?wallet=ADDRESS&offset=0`: `{ badges, next_offset, source }`.
  Each entry contains `id`, `title`, `image_url` (metadata URI compatible with
  `/api/badge-image`), `claimed_at`, `tx_signature`, `asset_id`. Follow pagination;
  page size is 100. Only confirmed mint jobs are listed.

This list records **badges earned/issued by this application**, not all assets
currently owned by a wallet. It does not use a DAS indexer and does not track
later transfers/burns. Sponsor eligibility uses the same earned-badge definition;
external NFTs cannot inflate the count.

The claim UI must read the QR `token`, authenticate before claiming, and reset
claim/result state when account or event changes. A tokenless public event link
is a detail link; it is not proof of attendance.

### Rewards / coupons

- `GET /api/rewards`: open campaigns; `?mine=true` requires a sponsor and returns
  that sponsor's campaigns, including closed ones.
- `POST /api/rewards` (sponsor): `{ title, description?, required_badges: 1..10000,
  expires_at?: ISODate }`. Ownership comes from the session.
- `PATCH /api/rewards` (owning sponsor): `{ reward_id, active: boolean }`.
- `POST /api/rewards/eligibility` (owning sponsor): `{ reward_id, wallet_address }`
  → `{ eligible, badgeCount, required_badges, coupon_status, basis }`.
  Frontend must actually branch on `eligible`; errors and zero badges are never
  automatic approval. This endpoint checks eligibility; it does not redeem a coupon.
- `POST /api/coupons` (student): `{ reward_id }`. The server checks confirmed
  earned badges and campaign availability, then issues one unpredictable coupon
  per user/campaign. Repeated calls return the same coupon, including its used
  status; they never grant another entitlement.
- `GET /api/coupons` (student): own coupons.
- `POST /api/coupons/redeem` (owning sponsor): `{ code }`. Consumes the coupon
  atomically, records `used_at` / `used_by`, and rejects a second redemption
  with HTTP 409. A sponsor cannot consume another sponsor's coupons.

## Mint recovery and legacy data

Before broadcasting, a lease-protected worker persists the signed bytes,
signature, RPC URL, tree and blockhash expiry. Concurrent requests cannot prepare
two transactions. Retries of a broadcast reuse identical bytes/signature, including
after process crashes. A stale preparer cannot replace a newer lease's transaction.
A failed preparation may retry because nothing has been broadcast. A finalized
chain error can retry only after explicit `retry_failed` and independent verification.

An expired transaction missing from RPC history becomes `review_required` (HTTP
409); absence is not proof that the mint failed. An operator must investigate
that saved signature on its recorded network. Re-POSTing the claim can reconcile
a later-visible finalized success; it will never create a replacement transaction
for an ambiguous result. Do not manually clear a signature to “unstick” a claim.
Legacy attendance with an existing mint status/signature/asset but no job is
blocked from a second mint and requires verified migration/reconciliation.

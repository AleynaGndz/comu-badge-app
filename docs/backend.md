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
  `eventId`, `qrToken`, and `token` aliases are supported. If `walletAddress` is supplied it
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


## Multiple club administrators

Apply `supabase/migrations/20261127214121_club_admin_memberships.sql` after the
initial backend migration. It preserves `clubs.admin_id` as the club owner,
backfills owners into `club_admins`, and allows any explicitly assigned management
team member to create/delete events, assign badges, and access QR tokens for that
club. A global admin without club membership cannot manage the club.

- `GET /api/clubs` returns all clubs managed by the current administrator, including
  membership-based access. Use this source for frontend authorization hints.
- `GET /api/events?managed=true` (admin) returns only events in the user's clubs.
  The unfiltered public event listing remains available for students.
- `GET /api/clubs/admins?club_id=UUID` lists the team for club administrators.
- `POST /api/clubs/admins` with `{ club_id, wallet_address }` adds a registered
  user; **only the club owner** may do this. A student becomes an application admin
  in the same transaction. Sponsor accounts are rejected rather than silently
  changing their role.
- `DELETE /api/clubs/admins` with the same JSON body removes a team member;
  only the owner can remove members, and the owner cannot remove themselves.
  Other club memberships remain intact. The user's global admin role is retained,
  but it does not grant access to the removed club.

Do not gate QR access by comparing `club.admin_id` with the current user in the
frontend: that field identifies the owner, not the whole management team. Use the
managed clubs endpoint; the server enforces membership on every action. Refresh
`/api/auth/me` after granting a role. Only explicitly selected wallets should be
added; never add all globally registered admins to every club automatically.


## Devnet deposits, refunds and no-show distribution

This demo uses a separate **server custody wallet**, not an escrow smart contract.
Only Solana Devnet is supported: every payment/payout connection verifies the
Devnet genesis hash. Never fund this wallet with mainnet SOL. Keep its key and
original RPC configuration available until all deposits have been resolved.

Apply migrations in filename order, including
`20261127214121_club_admin_memberships.sql` and
`20261127231007_devnet_deposits.sql`. Existing events stay free (`deposit_lamports=0`);
new events created through the API require **500,000,000 lamports (0.5 Devnet SOL)**.
Add a separate 64-byte JSON keypair as `DEPOSIT_SECRET_KEY` in `.env.local`.
It must differ from `MINT_SECRET_KEY`; never commit or expose either key.
Fund the custody wallet with free Devnet SOL for network fees (at least 0.01 SOL
before collecting deposits). Students need only 0.5 Devnet SOL. The custody wallet sponsors the incoming fee.
Outgoing fees are paid separately by custody, never deducted from refunds/bonuses.

Authenticated API contracts:

| Endpoint | Role and input | Result |
| --- | --- | --- |
| `POST /api/rsvp` | student; `{event_id}` | Own deposit plus exact unsigned legacy transaction; sign with wallet `signTransaction` only. |
| `POST /api/rsvp/confirm` | student; `{deposit_id,signed_transaction}` (base64) | Verifies the student partial signature and stored proposal, adds custody fee-payer signature, binds before broadcast; 202 pending or 200 finalized. |
| `GET /api/rsvp?event=UUID` | student | Own deposit and sanitized refund/bonus jobs; also reconciles submitted payments. Poll every 5 seconds. |
| `POST /api/rsvp/refund` | student; `{event_id}` | Advances own refund only after verified paid attendance; 202 until finalized. |
| `POST /api/deposits/reconcile` | event club administrator; `{event_id}` | Reconciles at most 10 incoming payments and 10 payouts per call. Repeat while work remains. |
| `POST /api/events/distribute` | event club administrator; `{event_id}` | Freezes allocation after attendance closes (event time + 2 hours); advances at most 10 bonus jobs per call. |

QR attendance requires a finalized deposit for paid events. The attendance
transaction queues the full 0.5 SOL refund exactly once, **before mint completion**.
Claim/attendance APIs attempt the payout immediately; a mint failure does not
cancel that refund. The claim page polls pending refunds. No-show deposits are
split equally among attendees with finalized paid registration. Integer lamport
remainders go in deterministic wallet/user order, so the entire pool is allocated.
No attendees means funds remain held for operator review. Unresolved incoming
payments block allocation. Repeat allocation calls do not create new jobs.

`success:true` on distribution means allocation was created/reused, **not that all
transfers finalized**. Inspect individual payout states. This quick demo has no
hosted background worker: refunds advance during claim/polling or admin reconcile;
a club admin explicitly starts distribution and repeats batch reconciliation.
If a browser/server closes, resume reconciliation; do not promise unattended payouts.

Signed bytes and signatures are stored before any broadcast. Retries resend the
same transaction. Expired ambiguous signatures become `review_required`; finalized
failures become `failed`. Neither creates an automatic replacement transfer.
Investigate the saved signature with an independent Devnet RPC/explorer before
any manual recovery; never reset these rows just because a request timed out.
This follows Solana's [transaction retry guidance](https://solana.com/developers/cookbook/transactions/retry).
Only sanitized job data is returned; RPC credentials and signed transaction bytes
remain service-only behind RLS. Live wallet signing/chain transfers are a separate
verification step from the automated PostgreSQL, signature and payout tests.

Payment proposals include an explicit compute limit and priority fee so Phantom
keeps the stored transaction message unchanged when signing (see [Phantom priority
fees](https://github.com/phantom/docs/blob/master/development-powertools/solana-priority-fees.md)).
Older unsigned proposals without those instructions are refreshed before signing;
exact message matching remains enforced by the backend.

### Verified Devnet run (2026-11-28, Europe/Istanbul)

Event `190b0a75-5b2d-44b9-bc9c-d35ea6f2c51a`: the student signed a 500,000,000
lamport deposit in Phantom; the backend finalized it, QR attendance queued the
refund, and a separate finalized transfer returned exactly 500,000,000 lamports
to the same student. Student and custody each paid a 5,100 lamport network fee.
The cNFT mint also finalized. No-show distribution is covered by PostgreSQL tests
(including exact remainder allocation and repeat-call protection); it has not yet
been exercised with a live multi-student no-show pool.

### Sponsored deposit fees

New payment proposals name the custody wallet as fee payer and the student as SOL
sender. The browser collects the student's partial signature and serializes with
`requireAllSignatures:false`. The backend verifies the authenticated owner, exact
stored proposal and student signature before co-signing with custody. It persists
the fully signed transaction before broadcasting and never returns the custody
signature/raw signed payment to the client. Retries reconcile the same saved
payment. Pending old student-paid proposals are refreshed; already submitted or
confirmed old payments keep their original signature and fee history.

The student pays no transaction fee in this new flow: deposit outflow is exactly
0.5 SOL, and verified attendance returns exactly 0.5 SOL. All deposit, refund and
bonus network fees come from custody's additional operating balance. The club
must fund that balance separately; student principal remains refundable in full.
Custody is the fee payer for now, not each club president's Phantom wallet. A
per-club sponsor wallet would require separate club-specific configuration and
signing; never collect presidents' private keys in the frontend.

Reference: [Solana fee sponsorship and partial signing](https://solana.com/docs/payments/send-payments/payment-processing/fee-abstraction).


### Readable coupon codes

New coupons use `CP-XXXX-XXXX-XX`: ten cryptographically random characters from
32 symbols (50 bits), excluding 0/O and 1/I. The database unique index prevents
duplicates; generation retries at most three times on collisions. Sponsor redeem
accepts lowercase or omitted separators and normalizes to the stored format.
Existing 48-character hex codes remain redeemable; requesting an existing coupon
returns that original coupon. Codes are not converted or reissued automatically.
Eligibility, reward ownership, campaign expiry and single-use checks are unchanged.


### Spendable badge credits (frontend integration)

Apply `20261128110020_coupon_badge_spending.sql` after the existing migrations.
Physical cNFTs stay in the collection. Each new coupon consumes `required_badges`
credits and saves that price in `coupons.badge_cost`. Issuance locks the student
row before checking confirmed app-issued mints minus all coupon costs; different
simultaneous reward requests cannot spend the same credit twice. Reissuing the
same coupon consumes nothing further. A redeemed/expired coupon still counts as
spent; there is no automatic credit refund. Campaign price edits affect only new
coupons. Existing coupons are backfilled once using the campaign's current price;
historical prices were not previously recorded and cannot be reconstructed.
Already overspent historical balances are shown as zero available; coupons and
NFTs are retained. `GET /api/coupons` includes `badge_cost` and a `balance` object
with `total`, `spent` and `available`. Sponsor eligibility also checks this balance
(or accepts an existing unused coupon). Collection count remains the total NFT
count. The frontend uses saved costs, including coupons from closed campaigns.


### RPC history-query throttling recovery

Deposit, refund and mint confirmation read finalized `getTransaction` receipts,
not the provider's independently throttled history-status endpoint. Read errors
preserve the signed job and return processing; they are never interpreted as an
absent transaction or a successful payment. Receipt metadata must include `err`.
A student signature whose proposal already expired is rejected before custody
co-signing/binding so the student can request a fresh unsigned proposal.

Expired *bound* payments still require operator review. For the Coffee Talk test
incident, two unlanded attempts were backed up privately and reset with signature-
matched updates only after verifying: no finalized transaction receipt, an invalid
blockhash beyond its last valid height, and absence from the treasury's complete
finalized transaction history. No transfers were sent during that repair; the
confirmed payment was left intact. Never clear an ambiguous payment just because
one RPC request timed out, and never create a new signature for a confirmed job.


RPC connections are reused per endpoint across deposit/refund routes, rather than
creating a fresh keep-alive pool on every poll. Concurrent Devnet genesis checks
are coalesced and revalidated once per minute. The SDK's rapid automatic 429
retries are disabled; rate-limited clients enforce a five-second cooldown and
return a sanitized HTTP 503 with `Retry-After` instead of exposing raw provider
errors. Custody balance is read once per preparation. Read-only mint clients are
also reused. Signed transaction persistence and no-duplicate-transfer rules remain
unchanged. After changing this code in development, restart the dev server to
release keep-alive pools created by older modules.

### Private Devnet RPC and wallet balances

Set `SOLANA_RPC_URL` in `.env.local` to your provider's **Devnet** HTTPS endpoint,
then restart `npm run dev`. Never commit that URL or prefix it with `NEXT_PUBLIC_`.
Each developer must configure their own local environment; Git does not carry it.
The shared public Devnet endpoint in `.env.example` is a development fallback,
not a guarantee against provider throttling. All configured mint/tree settings
must remain on Devnet. Existing submitted jobs retain their original RPC URL for audit. Processing uses
the currently configured RPC (with a verified Devnet genesis), falling back to the
recorded URL only when no current endpoint is configured. Signed transactions,
signatures, amounts and expiry heights remain unchanged during provider rotation.

The claim page reads `/api/wallet/balance`, not a credential-bearing browser RPC.
This authenticated, read-only endpoint only accepts the signed-in wallet. It
coalesces requests and caches successful balances for 15 seconds (bounded to 512
entries per process). Failed reads are not cached as zero. The UI clears outdated
balances, ignores responses for a previous wallet, and offers a manual retry.
Existing RPC connection reuse and rate-limit cooldown also apply to balance reads.
A free provider plan still has quotas; monitor usage when scaling beyond tests.

### Rewards restricted to a badge

Apply `supabase/migrations/20261128122657_reward_required_badge.sql` before
running this version. `rewards.required_badge_key` is nullable: omitted/null keeps
existing general rewards. `POST /api/rewards` accepts an exact key from
`badges.json` (case and spaces matter); unknown/empty keys return HTTP 400.
Example: `{ "title": "Coffee discount", "required_badges": 1,
"required_badge_key": "coffee talk" }`.

`GET /api/rewards` and `?mine=true` include `required_badge_key`. Students can
request `GET /api/rewards?eligibility=true` to additionally receive
`has_required_badge` per reward. This flag covers only the specific badge gate;
active/expiry, remaining credit cost and existing coupon status still apply.
`POST /api/rewards/eligibility` includes the key/flag in its existing sponsor-only
eligibility result. An already issued unused coupon remains valid.

`POST /api/coupons` keeps its existing request shape (`reward_id`). The database
checks the specific badge inside the same locked transaction as credit spending.
Missing ownership returns HTTP 403 with `code: "REQUIRED_BADGE_MISSING"` and a
Turkish message. Pending/failed mint jobs and attendance alone do not qualify.
Already issued coupons are returned idempotently without spending again.

Ownership means a confirmed app-issued mint linked through attendance to an event
with that exact badge key, consistent with existing badge-credit accounting.
It does not query current on-chain holders or arbitrary external NFTs. Any event
using the same key qualifies; this is a badge restriction, not an event-ID filter.
The badge condition does not add an extra credit charge or burn the NFT.
Frontend form/selectors/cards are intentionally left for the frontend developer.

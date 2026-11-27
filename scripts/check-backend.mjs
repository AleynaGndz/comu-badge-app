import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

let missing = false;
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET',
  'SOLANA_RPC_URL', 'MINT_SECRET_KEY', 'MERKLE_TREE_ADDRESS']) {
  const present = Boolean(process.env[key]);
  console.log(`${key}: ${present ? 'configured' : 'MISSING'}`);
  if (!present) missing = true;
}
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const response = await fetch(new URL('/rest/v1/', process.env.SUPABASE_URL), {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('schema request failed');
    const schema = await response.json();
    const columns = { club_admins: ['club_id', 'user_id'], events: ['badge_key'], auth_nonces: ['requester_hash'],
      badge_mint_jobs: ['signed_transaction', 'failed_attempts'],
      rewards: ['active', 'expires_at'], coupons: ['used_by'] };
    for (const [table, names] of Object.entries(columns)) {
      for (const name of names) {
        const found = Boolean(schema.definitions?.[table]?.properties?.[name]);
        console.log(`database ${table}.${name}: ${found ? 'OK' : 'MIGRATION REQUIRED'}`);
        if (!found) missing = true;
      }
    }
    for (const name of ['record_attendance', 'issue_login_nonce', 'complete_badge_mint',
      'assign_event_badge', 'can_manage_club', 'managed_clubs', 'set_club_admin', 'create_club_event', 'delete_club_event', 'reset_failed_badge_mint', 'issue_reward_coupon', 'redeem_reward_coupon']) {
      const found = Boolean(schema.paths?.[`/rpc/${name}`]);
      console.log(`database RPC ${name}: ${found ? 'OK' : 'MIGRATION REQUIRED'}`);
      if (!found) missing = true;
    }
  } catch {
    // Do not print fetch errors that might contain credential-bearing URLs.
    console.error('Could not inspect database schema; verify URL, service key and connectivity.');
    missing = true;
  }
}
if (missing) process.exitCode = 1;

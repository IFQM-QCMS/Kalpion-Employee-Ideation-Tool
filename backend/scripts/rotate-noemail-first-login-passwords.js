/*
 * One-off: replace the guessable first-login password (first 4 letters of a name + last 4
 * digits of a phone number) on every no-email account that has never completed its first
 * sign-in, with an unguessable one nobody is ever shown. Those employees now activate their
 * account through the "First time signing in?" OTP flow instead (see authService's
 * password-reset-by-code pipeline, purpose 'registration_phone').
 *
 * Deliberately scoped to `email IS NULL AND activated_at IS NULL` - an employee who already
 * signed in and chose their own password is untouched, whatever their password looked like
 * when it was issued.
 *
 * Usage (from backend/): node scripts/rotate-noemail-first-login-passwords.js [--dry-run]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { randomTempPassword } from '../src/services/userImportService.js';
import { buildDbSsl } from '../src/config/dbSsl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUNDS = 10; // matches the rounds bulk import already hashes these at

/** Rotate one tenant schema's never-activated, no-email users. Returns the count changed. */
export async function rotateTenant(conn, dbName, { dryRun = false } = {}) {
  if (!/^ifqm[a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Refusing to touch unexpected schema name "${dbName}".`);
  }
  const [rows] = await conn.query(
    `SELECT id FROM \`${dbName}\`.users WHERE email IS NULL AND activated_at IS NULL`
  );
  if (dryRun || !rows.length) return rows.length;

  for (const { id } of rows) {
    const hash = await bcrypt.hash(randomTempPassword(), ROUNDS);
    await conn.execute(`UPDATE \`${dbName}\`.users SET password_hash = ? WHERE id = ?`, [hash, id]);
  }
  return rows.length;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const dryRun = process.argv.includes('--dry-run');
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
  const { default: mysql } = await import('mysql2/promise');

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MASTER_DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      ssl: buildDbSsl(process.env),
      user: process.env.MASTER_DB_USER || 'root',
      password: process.env.MASTER_DB_PASS || '',
      multipleStatements: true,
      charset: 'utf8mb4',
    });

    const masterName = process.env.MASTER_DB_NAME || 'ifqm_master';
    const [tenants] = await conn.query(`SELECT slug, db_name FROM \`${masterName}\`.tenants`);

    let total = 0;
    for (const t of tenants) {
      const n = await rotateTenant(conn, t.db_name, { dryRun });
      if (n) {
        console.log(`[rotate] ${t.slug} (${t.db_name}): ${n} account(s) `
          + `${dryRun ? 'would be rotated' : 'rotated'}`);
      }
      total += n;
    }
    console.log(dryRun
      ? `[rotate] dry run - ${total} account(s) across ${tenants.length} tenant(s) would be rotated.`
      : `[rotate] done - ${total} account(s) across ${tenants.length} tenant(s) rotated.`);
  } catch (e) {
    console.error(`[rotate] FATAL: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await conn?.end().catch(() => {});
  }
}

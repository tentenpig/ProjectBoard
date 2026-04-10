import fs from 'fs';
import path from 'path';
import pool from './database';
import { RowDataPacket } from 'mysql2';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

export async function runMigrations(): Promise<void> {
  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[Migrations] No migrations directory, skipping');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[Migrations] No migration files found');
    return;
  }

  const [appliedRows] = await pool.query<RowDataPacket[]>('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.filename));

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    // Split on semicolons but ignore empty statements
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`[Migrations] Applying ${file} (${statements.length} statement${statements.length === 1 ? '' : 's'})`);
    try {
      for (const stmt of statements) {
        await pool.query(stmt);
      }
      await pool.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      appliedCount++;
      console.log(`[Migrations] ✓ ${file}`);
    } catch (err) {
      console.error(`[Migrations] ✗ ${file} failed:`, err);
      throw err;
    }
  }

  if (appliedCount === 0) {
    console.log(`[Migrations] All ${files.length} migration(s) already applied`);
  } else {
    console.log(`[Migrations] Applied ${appliedCount} new migration(s)`);
  }
}

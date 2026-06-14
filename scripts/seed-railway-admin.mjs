#!/usr/bin/env node
/**
 * One-shot seed for a fresh Railway deploy.
 *
 *   - Inserts one organization, one station, one admin auth_user, one
 *     station_members row joining them.
 *   - Hashes the admin password with PBKDF2-SHA256 at 600,000 iterations
 *     (matches src/server/auth/password.ts DEFAULT_PBKDF2_ITERATIONS).
 *   - Prints the username + plain password ONCE to stdout; the password
 *     itself never lands in env files or git.
 *
 * Idempotent: skips rows that already exist (ON CONFLICT DO NOTHING).
 *
 * Usage:
 *   DATABASE_URL='postgresql://…' node scripts/seed-railway-admin.mjs
 *
 * Optional env:
 *   ADMIN_USERNAME=admin              (defaults to 'admin')
 *   ADMIN_PASSWORD=<plaintext>        (defaults to a fresh random 20-char value)
 *   ORG_ID=sonic-bloom                (defaults; override with care)
 *   ORG_NAME=Sonic Bloom
 *   ORG_PLAN=pro                      (free | starter | pro | enterprise)
 *   STATION_ID=urban-radio
 *   STATION_SLUG=urban-radio
 *   STATION_NAME=Urban Radio
 *   STATION_TIMEZONE=Asia/Bangkok
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { webcrypto } from 'node:crypto';

import pg from 'pg';

const { Pool } = pg;

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder().encode(password);
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    enc,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

async function hashPassword(plain) {
  const salt = new Uint8Array(SALT_LENGTH);
  webcrypto.getRandomValues(salt);
  const derived = await deriveKey(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${bytesToHex(salt)}:${bytesToHex(derived)}`;
}

function generatePassword(len = 20) {
  // 20 alphanumeric characters from a 64-char alphabet ≈ 120 bits of entropy.
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }

  const orgId = (process.env.ORG_ID ?? 'sonic-bloom').trim();
  const orgName = (process.env.ORG_NAME ?? 'Sonic Bloom').trim();
  const orgPlan = (process.env.ORG_PLAN ?? 'pro').trim();
  const stationId = (process.env.STATION_ID ?? 'urban-radio').trim();
  const stationSlug = (process.env.STATION_SLUG ?? stationId).trim();
  const stationName = (process.env.STATION_NAME ?? 'Urban Radio').trim();
  const stationTimezone = (process.env.STATION_TIMEZONE ?? 'Asia/Bangkok').trim();

  // Pentest L-09: NFKC-normalize the username so the stored value matches what
  // the login route compares against (it NFKC-normalizes submitted usernames
  // before the `lower(username) = lower($1)` lookup). Without this, a username
  // seeded in a Unicode compatibility/full-width form would never match a
  // canonical-form login attempt. For ASCII usernames like 'admin' this is a
  // no-op.
  const adminUsername = (process.env.ADMIN_USERNAME ?? 'admin')
    .normalize('NFKC')
    .trim();
  const adminUserId = `user-${randomUUID().slice(0, 8)}`;
  const adminPassword = process.env.ADMIN_PASSWORD ?? generatePassword(20);
  const adminPasswordHash = await hashPassword(adminPassword);
  const passwordProvidedByUser = Boolean(process.env.ADMIN_PASSWORD);

  const now = new Date().toISOString().replace(/\.\d+/, '');

  const pool = new Pool({ connectionString: dbUrl });

  try {
    // Default categories the radio scheduler expects (matches D1 migration 0005 seed).
    const categories = [
      ['cat-music', 'Music', '#3b82f6', 90],
      ['cat-jingle', 'Jingle', '#f97316', 0],
      ['cat-sweeper', 'Sweeper', '#a855f7', 0],
      ['cat-id', 'Station ID', '#10b981', 0],
      ['cat-spot', 'Spot', '#ef4444', 30],
    ];

    // Transaction: all-or-nothing. ON CONFLICT keeps re-runs safe.
    await pool.query('BEGIN');

    await pool.query(
      `INSERT INTO organizations (id, name, plan, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [orgId, orgName, orgPlan, now],
    );

    await pool.query(
      `INSERT INTO stations (id, org_id, slug, name, timezone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [stationId, orgId, stationSlug, stationName, stationTimezone, now],
    );

    // Categories — best-effort, station_id FK is the only requirement.
    for (const [id, name, color, rpm] of categories) {
      await pool.query(
        `INSERT INTO categories (id, station_id, name, color, repeat_protection_minutes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, stationId, name, color, rpm, now],
      );
    }

    // Auth user. Check first because we want to PRINT existing creds only
    // when we're sure we minted them fresh.
    const existing = await pool.query(
      `SELECT id FROM auth_users WHERE lower(username) = lower($1) LIMIT 1`,
      [adminUsername],
    );

    let createdNewUser = false;
    let actualUserId = adminUserId;
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO auth_users (id, username, password_hash, created_at)
         VALUES ($1, $2, $3, $4)`,
        [adminUserId, adminUsername, adminPasswordHash, now],
      );
      createdNewUser = true;
    } else {
      actualUserId = existing.rows[0].id;
    }

    await pool.query(
      `INSERT INTO station_members (station_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (station_id, user_id) DO NOTHING`,
      [stationId, actualUserId, 'admin', now],
    );

    await pool.query('COMMIT');

    console.log('');
    console.log('=== Seed complete ===');
    console.log(`organization: ${orgId}  (plan: ${orgPlan})`);
    console.log(`station:      ${stationId}  (slug: ${stationSlug}, tz: ${stationTimezone})`);
    console.log(`categories:   ${categories.map((c) => c[0]).join(', ')}`);
    console.log('');
    if (createdNewUser) {
      console.log('=== Admin credentials (printed once) ===');
      console.log(`username: ${adminUsername}`);
      console.log(
        `password: ${
          passwordProvidedByUser ? '(from ADMIN_PASSWORD env)' : adminPassword
        }`,
      );
      console.log('');
      console.log(
        'Login at: https://sonic-bloom-web-production.up.railway.app/login',
      );
      console.log('Change the password from Settings after first login.');
    } else {
      console.log(
        `Admin user "${adminUsername}" already existed; left untouched.`,
      );
      console.log('Station membership ensured.');
    }
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

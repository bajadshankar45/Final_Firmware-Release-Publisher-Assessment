import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import duckdb from 'duckdb';

const root = process.env.PUBLISHER_PROJECT_ROOT
  ? path.resolve(process.env.PUBLISHER_PROJECT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'fixtures', 'build_manifest.csv');
const databasePath = path.join(root, 'releases.duckdb');
const gatewayUrl = process.env.PUBLISHER_GATEWAY_URL || 'http://127.0.0.1:7070';
const manifestColumns = ['entry_id', 'bundle_id', 'component_id', 'version', 'size_bytes', 'record_type', 'supersedes_id', 'recorded_at'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.endsWith('\r') ? field.slice(0, -1) : field); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function run(database, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    const callback = (error) => error ? reject(error) : resolve();
    if (parameters.length === 0) database.run(sql, callback);
    else database.run(sql, ...parameters, callback);
  });
}

function all(database, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    const callback = (error, rows) => error ? reject(error) : resolve(rows);
    if (parameters.length === 0) database.all(sql, callback);
    else database.all(sql, ...parameters, callback);
  });
}

function close(database) {
  return new Promise((resolve, reject) => database.close((error) => error ? reject(error) : resolve()));
}

async function loadManifest(database) {
  const rows = parseCsv(await fs.readFile(manifestPath, 'utf8'));
  if (rows.length === 0 || rows[0].join(',') !== manifestColumns.join(',')) throw new Error('Malformed manifest header');
  await run(database, 'DROP TABLE IF EXISTS raw_manifest');
  await run(database, 'CREATE TABLE raw_manifest (entry_id VARCHAR, bundle_id VARCHAR, component_id VARCHAR, version VARCHAR, size_bytes BIGINT, record_type VARCHAR, supersedes_id VARCHAR, recorded_at VARCHAR)');
  for (const values of rows.slice(1)) {
    if (values.length !== manifestColumns.length || values.every((value) => value === '')) throw new Error('Malformed manifest row');
    const size = Number(values[4]);
    if (!Number.isSafeInteger(size) || size < 0 || !['BUILD', 'WITHDRAWAL'].includes(values[5])) throw new Error(`Malformed manifest entry ${values[0]}`);
    await run(database, 'INSERT INTO raw_manifest VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [values[0], values[1], values[2], values[3], size, values[5], values[6], values[7]]);
  }
}

async function reconcile(database) {
  return all(database, `WITH distinct_rows AS (
    SELECT DISTINCT entry_id, bundle_id, component_id, version, size_bytes, record_type, supersedes_id, recorded_at FROM raw_manifest
  ), surviving_builds AS (
    SELECT build.* FROM distinct_rows AS build
    WHERE build.record_type = 'BUILD' AND NOT EXISTS (
      SELECT 1 FROM distinct_rows AS withdrawal
      WHERE withdrawal.record_type = 'WITHDRAWAL' AND withdrawal.supersedes_id = build.entry_id
    )
  )
  SELECT bundle_id, COUNT(*) AS artifact_count, SUM(size_bytes) AS total_bytes
  FROM surviving_builds GROUP BY bundle_id ORDER BY bundle_id`);
}

function descriptor(bundle) {
  return JSON.stringify({ artifact_count: Number(bundle.artifact_count), bundle_id: bundle.bundle_id, total_bytes: Number(bundle.total_bytes) });
}

function sign(payload, certificatePath, algorithm) {
  if (algorithm !== 'sha256WithRSAEncryption') throw new Error(`Unsupported signing algorithm: ${algorithm}`);
  const keyPath = process.env.PUBLISHER_KEY_PATH || path.join(path.dirname(certificatePath), 'current.key.pem');
  const scratch = fsSync.mkdtempSync(path.join(os.tmpdir(), 'release-publisher-'));
  const input = path.join(scratch, 'descriptor.bin');
  const output = path.join(scratch, 'signature.pem');
  try {
    fsSync.writeFileSync(input, Buffer.from(payload, 'utf8'));
    execFileSync('openssl', ['cms', '-sign', '-in', input, '-signer', certificatePath, '-inkey', keyPath, '-md', 'sha256', '-outform', 'PEM', '-binary', '-out', output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fsSync.readFileSync(output, 'utf8');
  } finally { fsSync.rmSync(scratch, { recursive: true, force: true }); }
}

async function request(url, options) {
  const response = await fetch(url, options);
  let body;
  try { body = await response.json(); } catch { throw new Error(`Gateway returned non-JSON response (${response.status})`); }
  if (!response.ok) throw new Error(`Gateway request failed (${response.status}): ${body.error || 'unknown error'}`);
  return body;
}

async function publish(database, bundle, key) {
  const token = `token-${bundle.bundle_id}`;
  const existing = await all(database, 'SELECT publication_id FROM publications WHERE request_token = ? AND status = ? LIMIT 1', [token, 'PUBLISHED']);
  if (existing.length > 0) return { publicationId: existing[0].publication_id, token };
  const payload = descriptor(bundle);
  const signature = sign(payload, key.certificate_ref, key.algorithm);
  const receipt = await request(`${gatewayUrl}/v1/publications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descriptor: payload, signature, request_token: token }) });
  if (receipt.status !== 'PUBLISHED' || receipt.request_token !== token || typeof receipt.publication_id !== 'string') throw new Error(`Invalid receipt for ${bundle.bundle_id}`);
  await run(database, `INSERT INTO publications (bundle_id, request_token, publication_id, status, key_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (request_token) DO UPDATE SET bundle_id = excluded.bundle_id, publication_id = excluded.publication_id, status = excluded.status, key_id = excluded.key_id`, [bundle.bundle_id, token, receipt.publication_id, receipt.status, key.key_id]);
  return { publicationId: receipt.publication_id, token };
}

async function main() {
  const database = new duckdb.Database(databasePath);
  try {
    await run(database, 'CREATE TABLE IF NOT EXISTS publications (bundle_id VARCHAR NOT NULL, request_token VARCHAR NOT NULL UNIQUE, publication_id VARCHAR NOT NULL, status VARCHAR NOT NULL, key_id VARCHAR NOT NULL)');
    await loadManifest(database);
    const bundles = await reconcile(database);
    const key = await request(`${gatewayUrl}/v1/signing-key/current`);
    if (!key.key_id || !key.algorithm || !key.certificate_ref || key.status !== 'current') throw new Error('Invalid current signing-key metadata');
    const output = [];
    for (const bundle of bundles) {
      const publication = await publish(database, bundle, key);
      output.push(`BUNDLE ${bundle.bundle_id} SIGNED KEY=${key.key_id}`);
      output.push(`BUNDLE ${bundle.bundle_id} PUBLISHED RECEIPT=${publication.publicationId} TOKEN=${publication.token} STATUS=PUBLISHED`);
    }
    process.stdout.write(`${output.join('\n')}\n`);
  } finally { await close(database); }
}

if (process.argv.includes('--report')) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

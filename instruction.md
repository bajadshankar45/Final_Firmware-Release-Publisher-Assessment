# Firmware Release Publisher

Implement `publisher/release-publisher.mjs` in the candidate environment. The program is run from `/app` with `npm run report`.

## Input and reconciliation

Read `fixtures/build_manifest.csv` with columns:

`entry_id,bundle_id,component_id,version,size_bytes,record_type,supersedes_id,recorded_at`

Use DuckDB at runtime in `releases.duckdb`. Load the raw rows and perform reconciliation in SQL:

- Collapse only exact duplicate rows, considering every manifest column.
- A `WITHDRAWAL` cancels the `BUILD` whose `entry_id` equals its `supersedes_id`.
- Count only surviving `BUILD` rows.
- Publish a bundle only when at least one build survives.
- Derive `artifact_count` and `total_bytes` with SQL, grouped by `bundle_id` and ordered ascending by `bundle_id`.

The supplied fixture should publish `BND-101`, `BND-102`, and `BND-103`; `BND-104` is fully withdrawn and must not be published. Do not hardcode these values, counts, or totals.

## Signing key and descriptor

Discover the active key with:

`GET http://127.0.0.1:7070/v1/signing-key/current`

Use the returned `key_id`, `algorithm`, `certificate_ref`, and `status`. The current key is the only trusted key. Never use the revoked key or access gateway private data.

For each publishable bundle, create exactly this descriptor object:

`artifact_count`, `bundle_id`, `total_bytes`

Serialize it as UTF-8 JSON with lexicographically sorted keys and no unnecessary whitespace. Create the canonical string once. Sign the exact UTF-8 bytes of that string and send the same string unchanged to the gateway.

Create a detached CMS signature with the OpenSSL CLI and the current certificate/private key. The gateway verifies the PEM CMS signature against the current certificate.

## Publication and persistence

Submit over HTTP only:

`POST http://127.0.0.1:7070/v1/publications`

with JSON:

`{"descriptor": "...", "signature": "...", "request_token": "token-<bundle_id>"}`

A successful response contains `publication_id`, the same `request_token`, and `status: "PUBLISHED"`. Treat all other responses, including `UNTRUSTED_SIGNATURE`, as failures.

Persist each successful publication in `releases.duckdb` with:

- `bundle_id`
- `request_token`
- `publication_id`
- `status`
- `key_id`

Use a uniqueness constraint or equivalent protection for `request_token`. On rerun, reuse a locally persisted successful publication and do not submit it again. Request tokens must never be random or time-based.

## Output

For every published bundle, print exactly these two lines, in ascending `bundle_id` order:

`BUNDLE <bundle_id> SIGNED KEY=<key_id>`

`BUNDLE <bundle_id> PUBLISHED RECEIPT=<publication_id> TOKEN=<request_token> STATUS=PUBLISHED`

Do not print debug, SQL, timestamps, progress, or extra report lines. Receipt IDs are dynamic and must not be hardcoded.

## Validation

The distribution gateway is provided under `distribution-gateway/`. It listens on port `7070` and can be tested with `cd distribution-gateway && node --test tests/`. A current-key signature must be accepted; a revoked-key signature must be rejected with `UNTRUSTED_SIGNATURE`.

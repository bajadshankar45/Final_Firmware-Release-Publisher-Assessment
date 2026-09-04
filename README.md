# Firmware Release Publisher Task

This repository contains a Firmware Release Publisher task-authoring package.

## Task Overview

The candidate must implement a firmware release publisher that:

- Reads a CSV build manifest.
- Loads the manifest into DuckDB.
- Reconciles duplicate and withdrawn builds using SQL.
- Discovers the current signing key through HTTP.
- Creates canonical JSON release descriptors.
- Signs descriptors with detached OpenSSL CMS signatures.
- Publishes signed releases through the distribution gateway.
- Persists publication receipts in DuckDB.
- Uses deterministic request tokens.
- Supports idempotent reruns.
- Produces deterministic report output.

## Candidate Deliverable

The candidate's only implementation file is:

```text
environment/publisher/release-publisher.mjs

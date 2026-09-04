# Author Notes

## Scope
This task package defines a Firmware Release Publisher assessment. The candidate-facing brief is `instruction.md`; the companion approach guide is `CANDIDATE_GUIDE.md`.

## Confirmed author decisions
- The candidate environment must not contain the reference publisher.
- The reference publisher is stored under `solution/reference/release-publisher.mjs`.
- `solution/publish.sh` executes the reference publisher with `PUBLISHER_PROJECT_ROOT` set to `environment/`.
- The candidate environment contains the manifest, expected report, DuckDB dependency, and the HTTP gateway.
- The gateway's private ledger is off-limits to the publisher.
- The reference behavior is validated using SQL reconciliation, current-key detached CMS signing, HTTP publication, DuckDB persistence, deterministic tokens, and idempotent reruns.

## Proof status
The repository does not contain the official submission grader or a clean-container orchestration that emits Proof A and Proof B rewards. The available `tests/test.sh` is a generic shell wrapper, and its previous `test_outputs.py` was unrelated to this task. Therefore no reward-0 or reward-1 proof is claimed here.

## Known package limitations
`SUBMISSION_HANDBOOK.md` was not available in the repository or adjacent workspace during authoring. Its six required parts and any Handbook-specific formatting rules are consequently not asserted here. This note records only requirements confirmed by the rejection feedback and available task materials.

## Validation boundary
The supplied gateway tests are authoritative for gateway behavior. The Firmware-specific verifier checks the candidate flow without relying on the reference implementation. Dynamic receipt IDs are compared by masking only the receipt value.

## Final author checklist
- Candidate `environment/publisher/` is empty.
- Reference implementation exists only in `solution/reference/`.
- `solution/publish.sh` is not a stub.
- `instruction.md` is candidate-facing and does not expose the reference implementation.
- Generated DuckDB and log files are not part of the task package.
- Gateway, Dockerfile, fixtures, expected report, and task metadata remain unchanged.

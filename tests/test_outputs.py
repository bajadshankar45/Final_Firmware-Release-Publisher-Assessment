"""Firmware Release Publisher acceptance checks."""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

import duckdb

ROOT = Path.cwd()
ENV = ROOT / "environment" if (ROOT / "environment" / "package.json").exists() else ROOT
EXPECTED = ENV / "reports" / "publications.expected.txt"


def get_json(url: str) -> tuple[int, dict]:
    with urlopen(url, timeout=5) as response:
        return response.status, json.loads(response.read())


def run_publisher() -> str:
    environment = os.environ.copy()
    environment["PUBLISHER_PROJECT_ROOT"] = str(ENV)
    result = subprocess.run(
        ["npm", "run", "--silent", "report"],
        cwd=ENV,
        text=True,
        capture_output=True,
        env=environment,
        check=True,
    )
    assert result.stderr == ""
    return result.stdout


def test_firmware_publisher_flow():
    gateway = subprocess.Popen(
        ["node", "distribution-gateway/server.js"],
        cwd=ENV,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=os.environ.copy(),
    )
    try:
        for _ in range(50):
            try:
                status, health = get_json("http://127.0.0.1:7070/healthz")
                if status == 200 and health == {"status": "ok"}:
                    break
            except Exception:
                time.sleep(0.1)
        else:
            raise AssertionError("gateway did not become ready")

        status, key = get_json("http://127.0.0.1:7070/v1/signing-key/current")
        assert status == 200
        assert key["key_id"] == "fw-signing-2026-current"
        assert key["status"] == "current"

        first = run_publisher()
        second = run_publisher()
        assert first == second

        expected = EXPECTED.read_text(encoding="utf-8")
        mask = lambda value: re.sub(r"RECEIPT=[^ ]+", "RECEIPT=<id>", value)
        assert mask(first) == mask(expected)
        assert "BND-101 SIGNED KEY=fw-signing-2026-current" in first
        assert "BND-102 SIGNED KEY=fw-signing-2026-current" in first
        assert "BND-103 SIGNED KEY=fw-signing-2026-current" in first
        assert "BND-104" not in first
        assert "STATUS=PUBLISHED" in first
        assert "TOKEN=token-BND-101" in first
        assert "TOKEN=token-BND-102" in first
        assert "TOKEN=token-BND-103" in first

        database = duckdb.connect(str(ENV / "releases.duckdb"))
        rows = database.execute(
            "SELECT bundle_id, request_token, publication_id, status, key_id "
            "FROM publications ORDER BY bundle_id"
        ).fetchall()
        database.close()
        assert [row[0] for row in rows] == ["BND-101", "BND-102", "BND-103"]
        assert len({row[1] for row in rows}) == 3
        assert len({row[2] for row in rows}) == 3
        assert all(row[1] == f"token-{row[0]}" for row in rows)
        assert all(row[3] == "PUBLISHED" for row in rows)
        assert all(row[4] == "fw-signing-2026-current" for row in rows)
    finally:
        gateway.terminate()
        gateway.wait(timeout=5)

"""Adapter self-tests (stdlib unittest only — no extra dependencies).

Run:  python3 test_adapter.py
Covers: auth enforcement, input validation, session state handling and
capability truthfulness, with the official ``needle`` runtime stubbed out
so no model weights are required.
"""

import json
import threading
import unittest
from http.client import HTTPConnection
from unittest import mock

import app as adapter


def _start_server(token: str):
    adapter.AUTH_TOKEN = token
    server = adapter.ThreadingHTTPServer(("127.0.0.1", 0), adapter._Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class _FakeAgent:
    instances: list = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.complete_calls: list = []
        self.closed = False
        self.reset_count = 0
        _FakeAgent.instances.append(self)

    def complete(self, text="", max_new_tokens=512):
        self.complete_calls.append(text)
        if text.startswith("{"):
            return {
                "type": "respond",
                "success": True,
                "error": None,
                "error_code": None,
                "function_calls": [],
                "reasoning": "done",
                "confidence": 0.9,
            }
        return {
            "type": "call",
            "success": True,
            "error": None,
            "error_code": None,
            "function_calls": [
                {"name": "help", "arguments": {"query": "ping"}}
            ],
            "reasoning": "need usage",
            "confidence": 0.95,
        }

    def reset(self):
        self.reset_count += 1

    def close(self):
        self.closed = True


class AdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = _start_server("secret-token")
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        adapter._sessions.clear()
        _FakeAgent.instances.clear()

    def _request(self, method, path, body=None, token="secret-token"):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        payload = json.dumps(body).encode() if body is not None else None
        if payload is not None:
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        raw = resp.read().decode()
        try:
            data = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            data = None
        conn.close()
        return resp.status, data

    def test_health_unauthenticated(self):
        with mock.patch.object(
            adapter, "NEEDLE_AVAILABLE", True
        ), mock.patch.object(adapter, "NEEDLE_VERSION", "3.0.1"):
            status, data = self._request("GET", "/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ok")

    def test_capabilities_require_auth(self):
        status, _ = self._request("GET", "/capabilities", token="wrong")
        self.assertEqual(status, 401)

    def test_capabilities_truthful(self):
        with mock.patch.object(
            adapter, "NEEDLE_AVAILABLE", True
        ), mock.patch.object(adapter, "NEEDLE_VERSION", "3.0.1"):
            status, data = self._request("GET", "/capabilities")
        self.assertEqual(status, 200)
        self.assertTrue(data["toolCalling"])
        self.assertFalse(data["mcp"])
        self.assertFalse(data["skills"])

    def test_capabilities_degraded_without_runtime(self):
        # Without the needle package installed the service must report
        # truthfully (toolCalling false) rather than fake support.
        status, data = self._request("GET", "/capabilities")
        self.assertEqual(status, 200)
        self.assertFalse(data["toolCalling"])

    def test_complete_validation(self):
        status, _ = self._request("POST", "/v1/agent/complete", {"nope": 1})
        self.assertEqual(status, 400)

    def test_complete_and_multiturn_state(self):
        with mock.patch.object(adapter, "NEEDLE_AVAILABLE", True), mock.patch.object(
            adapter, "_Needle", _FakeAgent
        ):
            tools = [
                {
                    "name": "help",
                    "description": "help",
                    "parameters": {"type": "object", "properties": {}},
                }
            ]
            status, data = self._request(
                "POST",
                "/v1/agent/complete",
                {
                    "session_id": "s1",
                    "system": "sys",
                    "tools": tools,
                    "input": "hello",
                },
            )
            self.assertEqual(status, 200)
            self.assertEqual(data["result"]["type"], "call")
            # Second turn reuses the SAME agent instance (stateful multi-turn).
            status, data = self._request(
                "POST",
                "/v1/agent/complete",
                {
                    "session_id": "s1",
                    "system": "sys",
                    "tools": tools,
                    "input": '{"key": "abc"}',
                },
            )
            self.assertEqual(status, 200)
            self.assertEqual(data["result"]["type"], "respond")
            self.assertEqual(len(_FakeAgent.instances), 1)
            self.assertEqual(len(_FakeAgent.instances[0].complete_calls), 2)

    def test_reset(self):
        with mock.patch.object(adapter, "NEEDLE_AVAILABLE", True), mock.patch.object(
            adapter, "_Needle", _FakeAgent
        ):
            tools = [
                {
                    "name": "help",
                    "description": "help",
                    "parameters": {"type": "object", "properties": {}},
                }
            ]
            self._request(
                "POST",
                "/v1/agent/complete",
                {"session_id": "s9", "tools": tools, "input": "hi"},
            )
            status, data = self._request(
                "POST", "/v1/agent/reset", {"session_id": "s9"}
            )
            self.assertEqual(status, 200)
            self.assertTrue(data["reset"])
            self.assertEqual(_FakeAgent.instances[0].reset_count, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)

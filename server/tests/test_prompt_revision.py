import unittest
from unittest.mock import AsyncMock, patch

import agent_server


class PromptRevisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_advertises_in_place_prompt_revision_contract(self) -> None:
        health = await agent_server.health()
        self.assertEqual(
            health["capabilities"]["prompt_revision_v2"],
            {"available": True, "version": 2},
        )

    def test_only_an_ordinary_user_turn_can_be_revised(self) -> None:
        ordinary = {"id": "prompt-1", "type": "turn_started", "purpose": None}
        with patch.object(agent_server, "reversed_jsonl_events", return_value=iter([ordinary])):
            self.assertIsNotNone(agent_server.editable_prompt_revision_target("chat", "prompt-1"))

        rejected = [
            {**ordinary, "type": "assistant_text"},
            {**ordinary, "purpose": "scheduled_job"},
            {**ordinary, "provider_generated": True},
            {**ordinary, "prompt_revision_reply": True},
            {**ordinary, "shared_chat_id": "interactive_" + "a" * 32},
        ]
        for candidate in rejected:
            with self.subTest(candidate=candidate), patch.object(
                agent_server,
                "reversed_jsonl_events",
                return_value=iter([candidate]),
            ):
                self.assertIsNone(agent_server.editable_prompt_revision_target("chat", "prompt-1"))

    def test_missing_prompt_revision_target_is_rejected(self) -> None:
        with patch.object(agent_server, "reversed_jsonl_events", return_value=iter([])):
            self.assertIsNone(agent_server.editable_prompt_revision_target("chat", "missing"))

    async def test_revision_keeps_the_prompt_in_place_and_starts_a_hidden_reply(self) -> None:
        stored = {
            "seq": 9,
            "id": "revision-1",
            "session_id": "chat",
            "type": "prompt_revised",
            "ts": "2026-11-06T00:00:00Z",
            "replaces_prompt_event_id": "prompt-1",
            "prompt": "Revised",
            "file_ids": [],
            "chat_references": [],
            "team_references": [],
        }
        append = AsyncMock(return_value=stored)
        start = AsyncMock()
        request = agent_server.PromptRevisionRequest(prompt="Revised")
        with (
            patch.dict(agent_server.STORE.sessions, {"chat": {"id": "chat"}}),
            patch.object(agent_server, "editable_prompt_revision_target", return_value={
                "id": "prompt-1", "seq": 2, "ts": "2026-11-05T00:00:00Z",
                "run_id": "run-1", "backend": "codex",
            }),
            patch.object(agent_server, "append_durable_event", append),
            patch.object(agent_server, "start_turn", start),
        ):
            response = await agent_server.revise_prompt("chat", "prompt-1", request)

        self.assertEqual(response["event"], stored)
        self.assertTrue(response["reply_started"])
        append.assert_awaited_once_with("chat", "prompt_revised", {
            "replaces_prompt_event_id": "prompt-1",
            "replaces_prompt_event_seq": 2,
            "replaces_prompt_event_ts": "2026-11-05T00:00:00Z",
            "replaces_prompt_run_id": "run-1",
            "replaces_prompt_backend": "codex",
            "prompt": "Revised",
            "file_ids": [],
            "chat_references": [],
            "team_references": [],
            "run_id": "run-1",
            "backend": "codex",
        })
        start.assert_awaited_once()
        reply = start.await_args.args[1]
        self.assertEqual(start.await_args.args[0], "chat")
        self.assertEqual(reply.prompt, "Revised")
        self.assertEqual(reply.display_prompt, "")
        self.assertTrue(reply.prompt_revision_reply)
        self.assertEqual(reply.chat_references, [])
        self.assertEqual(reply.team_references, [])

    async def test_blank_revision_does_not_start_a_reply(self) -> None:
        append = AsyncMock(return_value={"id": "revision-1", "type": "prompt_revised"})
        start = AsyncMock()
        request = agent_server.PromptRevisionRequest(prompt="   ")
        with (
            patch.dict(agent_server.STORE.sessions, {"chat": {"id": "chat"}}),
            patch.object(agent_server, "editable_prompt_revision_target", return_value={
                "id": "prompt-1", "seq": 2, "ts": "2026-11-05T00:00:00Z",
            }),
            patch.object(agent_server, "append_durable_event", append),
            patch.object(agent_server, "start_turn", start),
        ):
            await agent_server.revise_prompt("chat", "prompt-1", request)
        start.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()

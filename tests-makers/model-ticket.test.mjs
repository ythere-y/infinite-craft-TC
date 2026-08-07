import assert from "node:assert/strict";
import test from "node:test";

import {
  signModelTicket,
  verifyModelTicket,
} from "../edge-functions/_lib/model-ticket.js";

test("model tickets round-trip and reject tampering or expiry", async () => {
  const now = 1_700_000_000_000;
  const ticket = await signModelTicket("ticket-secret", {
    kind: "model_request",
    exp: now + 60_000,
    provider: "makers",
    payload: { messages: [{ role: "user", content: "combine" }] },
  });

  assert.equal(
    (await verifyModelTicket("ticket-secret", ticket, { now })).provider,
    "makers",
  );
  assert.equal(
    await verifyModelTicket(
      "ticket-secret",
      `${ticket.slice(0, -1)}x`,
      { now },
    ),
    null,
  );
  assert.equal(
    await verifyModelTicket("ticket-secret", ticket, {
      now: now + 60_001,
    }),
    null,
  );
});

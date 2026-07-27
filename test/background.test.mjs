import test from "node:test";
import assert from "node:assert/strict";
import { createMessageHandler } from "../src/background/messages.mjs";
import { createActionHandler } from "../src/background/action.mjs";
import { KEYS } from "../src/platform/storage.mjs";
import { showRouteOutcome } from "../src/content/route-outcome.mjs";

function messageFixture(initial = {}) {
  const values = { ...initial };
  const handler = createMessageHandler({
    getStorage: async (_area, keys) => Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])),
    initializeStorage: async () => {},
    openOptionsTab: async () => {},
    removeStorage: async (_area, keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    setStorage: async (_area, next) => Object.assign(values, next)
  });
  const send = (message, tabId) => new Promise((resolve) => {
    assert.equal(handler(message, tabId == null ? {} : { tab: { id: tabId } }, resolve), true);
  });
  return { send, values };
}

test("keeps concurrent route attempts isolated by their sender tabs", async () => {
  const { send, values } = messageFixture();
  const first = { id: "contacts", requestedAt: 100 };
  const second = { id: "deals", requestedAt: 200 };

  await Promise.all([
    send({ action: "record-route-attempt", attempt: first }, 11),
    send({ action: "record-route-attempt", attempt: second }, 22)
  ]);
  assert.deepEqual(values, {
    [`${KEYS.attemptPrefix}11`]: first,
    [`${KEYS.attemptPrefix}22`]: second
  });

  assert.deepEqual(await send({ action: "consume-route-attempt" }, 22), { ok: true, attempt: second });
  assert.deepEqual(await send({ action: "consume-route-attempt" }, 11), { ok: true, attempt: first });
  assert.deepEqual(values, {});
});

test("uses and removes the legacy global attempt once", async () => {
  const legacy = { id: "legacy", requestedAt: 1 };
  const { send, values } = messageFixture({ [KEYS.attempt]: legacy });

  assert.deepEqual(await send({ action: "consume-route-attempt" }, 33), { ok: true, attempt: legacy });
  assert.equal(KEYS.attempt in values, false);
  assert.equal(`${KEYS.attemptPrefix}33` in values, false);
  assert.deepEqual(await send({ action: "consume-route-attempt" }, 33), { ok: true, attempt: undefined });
});

test("rejects route diagnostics that do not have a sender tab", async () => {
  const { send } = messageFixture();
  assert.deepEqual(await send({ action: "record-route-attempt", attempt: {} }), {
    ok: false,
    error: "The sending HubSpot tab could not be identified."
  });
});

test("ignores stale route attempts before rendering an outcome", async () => {
  let rendered = false;
  await showRouteOutcome({
    ensureRoot: () => { rendered = true; },
    sendMessage: async () => ({ ok: true, attempt: { requestedAt: 1 } }),
    now: () => 31_002,
    wait: async () => assert.fail("stale attempts must not wait")
  });
  assert.equal(rendered, false);
});

test("shows reload guidance when a HubSpot content script is disconnected", async () => {
  const feedback = [];
  const toggle = createActionHandler({
    sendMessage: async () => { throw new Error("Receiving end does not exist"); },
    showFeedback: async (tab, state) => feedback.push({ tab, state })
  });
  const tab = { id: 44, url: "https://app.hubspot.com/contacts/12345678" };

  await toggle(tab);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].tab, tab);
  assert.equal(feedback[0].state.text, "!");
  assert.match(feedback[0].state.title, /Reload this HubSpot tab/);
});

test("does not activate on public marketing pages that lack an app context", async () => {
  const feedback = [];
  let sent = false;
  const toggle = createActionHandler({
    sendMessage: async () => { sent = true; },
    showFeedback: async (tab, state) => feedback.push({ tab, state })
  });

  await toggle({ id: 45, url: "https://www.hubspot.com/products" });
  assert.equal(sent, false);
  assert.equal(feedback[0].state.text, "HS");
});

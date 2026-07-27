import test from "node:test";
import assert from "node:assert/strict";
import { createStorageRepository, KEYS } from "../src/platform/storage.mjs";

function area(initial = {}) {
  const values = structuredClone(initial);
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    values,
    calls,
    get(keys, callback) {
      calls.get += 1;
      if (keys == null) return callback({ ...values });
      const selected = Array.isArray(keys) ? keys : [keys];
      callback(Object.fromEntries(selected.filter((key) => key in values).map((key) => [key, values[key]])));
    },
    set(next, callback) {
      calls.set += 1;
      Object.assign(values, structuredClone(next));
      callback?.();
    },
    remove(keys, callback) {
      calls.remove += 1;
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      callback?.();
    }
  };
}

function fixture({ local = area(), sync = area(), session = area(), version = "2.0.0", fetchFn } = {}) {
  const chromeApi = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version }),
      getURL: (file) => file
    },
    storage: { local, sync, session }
  };
  return {
    local,
    sync,
    session,
    repository: createStorageRepository({ chromeApi, fetchFn, now: () => 1234, idFactory: () => "migrated-id" })
  };
}

function catalog(routes = [{ id: "contacts", keyword: "Contacts", path: "/contacts/INSTANCE_ID/objects/0-1" }]) {
  return async () => ({ ok: true, status: 200, json: async () => ({ navigation: routes }) });
}

test("moves defaults to local storage and migrates legacy custom routes exactly once", async () => {
  const local = area();
  const sync = area({
    [KEYS.legacyDefaults]: [{ keyword: "Old", path: "/old" }],
    [KEYS.legacyCustom]: [{ keyword: "My Contacts", path: "/contacts/INSTANCE_ID/objects/0-1" }]
  });
  const { repository } = fixture({ local, sync, fetchFn: catalog() });

  await repository.initializeStorage();
  const writesAfterMigration = sync.calls.set;
  await repository.initializeStorage();
  sync.values[`${KEYS.customPrefix}unsafe`] = { id: "unsafe", keyword: "Unsafe", path: "https://example.com" };
  const state = await repository.loadState();

  assert.equal(state.defaults.length, 1);
  assert.equal(state.custom.length, 1);
  assert.equal(state.routes.length, 2);
  assert.equal(local.values[KEYS.defaultsVersion], "2.0.0");
  assert.equal(local.values[KEYS.schema], 2);
  assert.equal(sync.values[KEYS.legacyDefaults], undefined);
  assert.equal(sync.values[KEYS.legacyCustom], undefined);
  assert.equal(sync.calls.set, writesAfterMigration);
  assert.deepEqual(Object.keys(sync.values).filter((key) => key.startsWith(KEYS.customPrefix)), [`${KEYS.customPrefix}migrated-id`]);
});

test("uses a cached catalog until the extension version changes", async () => {
  const local = area();
  const sync = area();
  let fetches = 0;
  const fetchFn = async () => {
    fetches += 1;
    return { ok: true, status: 200, json: async () => ({ navigation: [{ id: `home-${fetches}`, keyword: "Home", path: "/global-home/INSTANCE_ID" }] }) };
  };

  await fixture({ local, sync, fetchFn }).repository.initializeStorage();
  await fixture({ local, sync, fetchFn }).repository.initializeStorage();
  assert.equal(fetches, 1);
  assert.equal(local.values[KEYS.defaults][0].id, "home-1");

  await fixture({ local, sync, fetchFn, version: "2.0.8" }).repository.initializeStorage();
  assert.equal(fetches, 2);
  assert.equal(local.values[KEYS.defaults][0].id, "home-2");
  assert.equal(local.values[KEYS.defaultsVersion], "2.0.8");
});

test("does not replace cached defaults after a failed catalog refresh", async () => {
  const original = [{ id: "old", keyword: "Old", path: "/old" }];
  const local = area({ [KEYS.defaults]: original, [KEYS.defaultsVersion]: "2.0.6", [KEYS.schema]: 2 });
  const { repository } = fixture({
    local,
    fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) })
  });

  await assert.rejects(repository.initializeStorage(), /HTTP 503/);
  assert.deepEqual(local.values[KEYS.defaults], original);
  assert.equal(local.values[KEYS.defaultsVersion], "2.0.6");
});

test("normalizes override favorites and recents to stable logical IDs without changing custom IDs", async () => {
  const defaults = [{ id: "contacts", keyword: "Contacts", path: "/contacts/INSTANCE_ID" }];
  const local = area({
    [KEYS.defaults]: defaults,
    [KEYS.defaultsVersion]: "2.0.0",
    [KEYS.schema]: 2,
    [KEYS.recents]: [
      { id: "custom-contacts", keyword: "Contacts", usedAt: 10 },
      { id: "contacts", keyword: "Contacts", usedAt: 9 }
    ]
  });
  const sync = area({
    [KEYS.favorites]: ["custom-contacts", "contacts"],
    [`${KEYS.customPrefix}custom-contacts`]: { id: "custom-contacts", keyword: "contacts", path: "/custom/INSTANCE_ID" }
  });
  const { repository } = fixture({ local, sync });

  let state = await repository.loadState();
  assert.deepEqual(state.favoriteIds, ["contacts"]);
  assert.deepEqual(state.recents.map(({ id }) => id), ["contacts"]);
  assert.equal(state.custom[0].id, "custom-contacts");
  assert.equal(state.routes[0].logicalId, "contacts");

  const writes = { local: local.calls.set, sync: sync.calls.set };
  await repository.loadState();
  assert.deepEqual({ local: local.calls.set, sync: sync.calls.set }, writes, "logical-ID migration is idempotent");

  await repository.saveCustomRoute({ id: "custom-contacts", keyword: "Contacts", path: "/edited/INSTANCE_ID", source: "custom" });
  await repository.replaceCustomRoutes([
    { id: "custom-contacts", keyword: "Contacts", path: "/imported/INSTANCE_ID", source: "custom" },
    { id: "standalone", keyword: "Standalone", path: "/standalone/INSTANCE_ID", source: "custom" }
  ]);
  state = await repository.loadState();
  assert.deepEqual(state.custom.map(({ id }) => id).sort(), ["custom-contacts", "standalone"]);
  assert.equal(state.routes.find(({ id }) => id === "custom-contacts").logicalId, "contacts");

  await repository.deleteCustomRoute("custom-contacts");
  state = await repository.loadState();
  assert.equal(state.routes.find(({ id }) => id === "contacts").logicalId, "contacts");
  assert.deepEqual(state.favoriteIds, ["contacts"]);
});

test("deleting a custom route removes only that synced destination", async () => {
  const sync = area({
    [KEYS.favorites]: ["contacts"],
    [`${KEYS.customPrefix}contacts`]: { id: "contacts", keyword: "Contacts", path: "/custom/INSTANCE_ID" },
    [`${KEYS.customPrefix}reports`]: { id: "reports", keyword: "Reports", path: "/reports-dashboard/INSTANCE_ID" }
  });
  const { repository } = fixture({ sync });

  await repository.deleteCustomRoute("contacts");
  assert.equal(sync.values[`${KEYS.customPrefix}contacts`], undefined);
  assert.deepEqual(sync.values[`${KEYS.customPrefix}reports`], {
    id: "reports", keyword: "Reports", path: "/reports-dashboard/INSTANCE_ID"
  });
  assert.deepEqual(sync.values[KEYS.favorites], ["contacts"]);
});

test("favorite toggles enforce the eight-favorite limit while still allowing removal", async () => {
  const favoriteIds = Array.from({ length: 8 }, (_, index) => `favorite-${index}`);
  const sync = area({ [KEYS.favorites]: favoriteIds });
  const { repository } = fixture({ sync });

  await assert.rejects(repository.toggleFavorite("one-more"), /at most 8 favorites/);
  assert.deepEqual(sync.values[KEYS.favorites], favoriteIds);
  assert.deepEqual(await repository.toggleFavorite("favorite-0"), favoriteIds.slice(1));
});

test("loads relative and fixed-subdomain routes without changing their saved IDs", async () => {
  const local = area({ [KEYS.defaults]: [], [KEYS.defaultsVersion]: "2.0.0", [KEYS.schema]: 2 });
  const sync = area({
    [`${KEYS.customPrefix}relative`]: { id: "relative", keyword: "Relative", path: "/contacts/INSTANCE_ID" },
    [`${KEYS.customPrefix}fixed`]: { id: "fixed", keyword: "Fixed", path: "https://tools.eu1.hubspot.com/reports/INSTANCE_ID" }
  });
  const { repository } = fixture({ local, sync });

  const state = await repository.loadState();
  assert.equal(state.custom.find(({ id }) => id === "relative").path, "/contacts/INSTANCE_ID");
  assert.equal(state.custom.find(({ id }) => id === "fixed").path, "https://tools.eu1.hubspot.com/reports/INSTANCE_ID");
});

test("removes favorites and recents whose destinations no longer exist", async () => {
  const local = area({
    [KEYS.defaults]: [],
    [KEYS.defaultsVersion]: "2.0.0",
    [KEYS.schema]: 2,
    [KEYS.recents]: [{ id: "deleted", keyword: "Deleted", usedAt: 10 }]
  });
  const sync = area({
    [KEYS.favorites]: ["deleted"],
    [`${KEYS.customPrefix}deleted`]: { id: "deleted", keyword: "Deleted", path: "/deleted/INSTANCE_ID" }
  });
  const { repository } = fixture({ local, sync });

  await repository.deleteCustomRoute("deleted");
  const state = await repository.loadState();

  assert.deepEqual(state.favoriteIds, []);
  assert.deepEqual(state.recents, []);
  assert.deepEqual(sync.values[KEYS.favorites], []);
  assert.deepEqual(local.values[KEYS.recents], []);
});

test("repairs malformed favorite and recent collections during state load", async () => {
  const local = area({
    [KEYS.defaults]: [{ id: "contacts", keyword: "Contacts", path: "/contacts/INSTANCE_ID" }],
    [KEYS.recents]: [null, { id: "contacts", keyword: 42, usedAt: "invalid" }],
    [KEYS.portals]: {
      "https://app.hubspot.com": "12345678",
      "https://example.com": "87654321",
      "https://app.hubspot.com/path": "87654321",
      "https://app-eu1.hubspot.com": { corrupt: true }
    }
  });
  const sync = area({ [KEYS.favorites]: { corrupt: true } });
  const { repository } = fixture({ local, sync });

  const state = await repository.loadState();

  assert.deepEqual(state.favoriteIds, []);
  assert.deepEqual(state.recents, [{ id: "contacts", keyword: "42", usedAt: 0 }]);
  assert.deepEqual(state.portals, { "https://app.hubspot.com": "12345678" });
  assert.deepEqual(sync.values[KEYS.favorites], []);
  assert.deepEqual(local.values[KEYS.recents], [{ id: "contacts", keyword: "42", usedAt: 0 }]);
  assert.deepEqual(local.values[KEYS.portals], { "https://app.hubspot.com": "12345678" });
});

test("removes custom routes whose storage key does not match the validated route ID", async () => {
  const local = area({ [KEYS.defaults]: [] });
  const mismatchedKey = `${KEYS.customPrefix}poisoned-slot`;
  const sync = area({
    [mismatchedKey]: { id: "victim", keyword: "Poisoned", path: "/poisoned/INSTANCE_ID" }
  });
  const { repository } = fixture({ local, sync });

  const state = await repository.loadState();

  assert.deepEqual(state.custom, []);
  assert.equal(sync.values[mismatchedKey], undefined);
});

test("restoring settings rolls custom routes back when the favorites write fails", async () => {
  const priorRoute = { id: "prior", keyword: "Prior", path: "/prior/INSTANCE_ID", source: "custom" };
  const sync = area({
    [KEYS.favorites]: ["prior"],
    [`${KEYS.customPrefix}prior`]: priorRoute
  });
  const originalSet = sync.set.bind(sync);
  let failed = false;
  sync.set = (next, callback) => {
    if (!failed && Object.hasOwn(next, KEYS.favorites)) {
      failed = true;
      throw new Error("simulated favorites write failure");
    }
    originalSet(next, callback);
  };
  const { repository } = fixture({ sync });

  await assert.rejects(repository.replaceSettings([
    { id: "next", keyword: "Next", path: "/next/INSTANCE_ID", source: "custom" }
  ], ["next"]), /simulated favorites write failure/);

  assert.deepEqual(sync.values[KEYS.favorites], ["prior"]);
  assert.deepEqual(sync.values[`${KEYS.customPrefix}prior`], priorRoute);
  assert.equal(sync.values[`${KEYS.customPrefix}next`], undefined);
});

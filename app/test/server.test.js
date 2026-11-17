import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../server.js";

function createTestApp({ verifyAccessToken = async () => ({ sub: "user-1" }), memoStore = {} } = {}) {
  const store = {
    list: async () => [],
    create: async (ownerId, memo) => ({ id: "00000000-0000-4000-8000-000000000001", ...memo, ownerId }),
    update: async () => null,
    delete: async () => false,
    ...memoStore,
  };
  const app = createApp({
    cognitoClient: { send: async () => ({}) },
    memoStore: store,
    verifyAccessToken,
  });
  return { app, store };
}

test("memo reads require a valid Cognito session", async () => {
  const { app } = createTestApp({
    verifyAccessToken: async () => {
      const error = new Error("expired");
      error.status = 401;
      throw error;
    },
  });

  const response = await request(app).get("/api/memos").set("Cookie", "memo_session=expired");
  assert.equal(response.status, 401);
});

test("memo creation scopes the record to the authenticated user", async () => {
  let created;
  const { app } = createTestApp({
    memoStore: {
      create: async (ownerId, memo) => {
        created = { ownerId, memo };
        return { id: "00000000-0000-4000-8000-000000000001", ...memo };
      },
    },
  });

  const response = await request(app)
    .post("/api/memos")
    .set("Host", "memo.test")
    .set("Origin", "http://memo.test")
    .set("Cookie", "memo_session=valid")
    .send({ title: "買い物", content: "りんご" });

  assert.equal(response.status, 201);
  assert.deepEqual(created, {
    ownerId: "user-1",
    memo: { title: "買い物", content: "りんご" },
  });
});

test("invalid memo input is rejected before reaching the store", async () => {
  let called = false;
  const { app } = createTestApp({
    memoStore: {
      create: async () => {
        called = true;
        return {};
      },
    },
  });

  const response = await request(app)
    .post("/api/memos")
    .set("Host", "memo.test")
    .set("Origin", "http://memo.test")
    .set("Cookie", "memo_session=valid")
    .send({ title: "  ", content: "" });

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("cross-origin memo writes are rejected", async () => {
  const { app } = createTestApp();
  const response = await request(app)
    .post("/api/memos")
    .set("Host", "memo.test")
    .set("Origin", "https://attacker.test")
    .set("Cookie", "memo_session=valid")
    .send({ title: "test", content: "" });

  assert.equal(response.status, 403);
});

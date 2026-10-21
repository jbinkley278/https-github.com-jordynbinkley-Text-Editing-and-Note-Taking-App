import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";

async function withStaticServer(run) {
  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function get(path) {
    const response = await fetch(`${base}${path}`);
    const text = await response.text();
    return {
      status: response.status,
      text,
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  try {
    await run({ get, base });
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("intended frontend assets still load", async () => {
  await withStaticServer(async ({ get }) => {
    const root = await get("/");
    assert.equal(root.status, 200);
    assert.match(root.contentType, /text\/html/i);
    assert.match(root.text, /<title>GroupFlow<\/title>/);
    assert.match(root.text, /src\/app\.js/);

    const index = await get("/index.html");
    assert.equal(index.status, 200);
    assert.match(index.text, /GroupFlow/);

    const css = await get("/src/styles.css");
    assert.equal(css.status, 200);
    assert.match(css.contentType, /text\/css/i);
    assert.match(css.text, /--navy/);

    const appJs = await get("/src/app.js");
    assert.equal(appJs.status, 200);
    assert.match(appJs.contentType, /javascript/i);
    assert.match(appJs.text, /populateAssigneeSelect|fillAssignees/);

    const assignee = await get("/src/assigneeSelect.js");
    assert.equal(assignee.status, 200);
    assert.match(assignee.text, /populateAssigneeSelect/);

    const api = await get("/api");
    assert.equal(api.status, 200);
    assert.match(api.text, /GroupFlow API/);
  });
});

test("private repository paths cannot return file contents", async () => {
  await withStaticServer(async ({ get }) => {
    const privatePaths = [
      "/package.json",
      "/package-lock.json",
      "/server/config.js",
      "/server/app.js",
      "/server/auth/sessions.js",
      "/test/helpers.mjs",
      "/README.md",
      "/.env",
      "/.env.example",
      "/.gitignore",
      "/docs/production-plan.md",
    ];

    for (const path of privatePaths) {
      const result = await get(path);
      assert.notEqual(
        result.status,
        200,
        `${path} must not be served as a successful static file`,
      );
      assert.doesNotMatch(
        result.text,
        /"name"\s*:\s*"groupflow"/,
        `${path} must not return package.json contents`,
      );
      assert.doesNotMatch(
        result.text,
        /MONGODB_URI/,
        `${path} must not return env or server config secrets`,
      );
      assert.doesNotMatch(
        result.text,
        /export function createApp/,
        `${path} must not return server source`,
      );
      assert.doesNotMatch(
        result.text,
        /assertSafeTestMongoUri/,
        `${path} must not return test helpers`,
      );
    }

    const traversal = await get("/src/../package.json");
    assert.notEqual(traversal.status, 200);
    assert.doesNotMatch(traversal.text, /"name"\s*:\s*"groupflow"/);
  });
});

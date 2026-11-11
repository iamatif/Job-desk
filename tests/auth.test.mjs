import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobdeskServer } from "../server.mjs";

let app, base, origin, dir;
const headers = () => ({ "content-type": "application/json", origin });
async function call(path, method = "GET", body, extra = {}) {
  return fetch(base + path, {
    method,
    headers: { ...headers(), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}
async function signup(email = "first@example.test") {
  return call("/api/auth/signup", "POST", {
    name: "CMS Tester",
    email,
    password: "Example Test Password 2026!",
  });
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "jobdesk-auth-test-"));
  app = createJobdeskServer({ dataDir: dir, port: 0, testMode: true });
  await app.start();
  base = `http://localhost:${app.port}`;
  origin = base;
});
after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

test("private workspace requires a session", async () => {
  assert.equal((await call("/api/workspace")).status, 401);
});
test("signup hashes passwords, issues HttpOnly cookie, rejects duplicate email", async () => {
  const r = await signup();
  assert.equal(r.status, 201);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Lax/);
  const bytes = await readFile(join(dir, "jobdesk.sqlite"));
  assert.equal(
    bytes.includes(Buffer.from("Example Test Password 2026!")),
    false,
  );
  const duplicate = await signup("FIRST@example.test");
  assert.equal(duplicate.status, 409);
});
test("invalid login does not issue a session", async () => {
  const r = await call("/api/auth/login", "POST", {
    email: "first@example.test",
    password: "not-the-right-password",
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
});
test("session, CSRF, account isolation, persistence, and logout", async () => {
  const login = await call("/api/auth/login", "POST", {
    email: "first@example.test",
    password: "Example Test Password 2026!",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const me = await (
    await call("/api/auth/me", "GET", undefined, { cookie })
  ).json();
  assert.equal(me.user.email, "first@example.test");
  const workspace = {
    profile: {
      name: "Personal CMS Developer",
      role: "CMS Developer",
      years: 2.5,
      skills: ["WordPress"],
      summary: "A profile",
      experience: "CMS developer",
      portfolio: "",
      fictional: true,
    },
    jobs: [],
    applications: {},
  };
  assert.equal(
    (await call("/api/workspace", "PUT", workspace, { cookie })).status,
    403,
  );
  assert.equal(
    (
      await call("/api/workspace", "PUT", workspace, {
        cookie,
        "x-csrf-token": me.csrf,
        "if-match": "0",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/api/workspace", "PUT", workspace, {
        cookie,
        "x-csrf-token": me.csrf,
        "if-match": "0",
      })
    ).status,
    409,
  );
  assert.equal(
    (await (await call("/api/workspace", "GET", undefined, { cookie })).json())
      .workspace.profile.name,
    "Personal CMS Developer",
  );
  const second = await signup("second@example.test");
  const secondCookie = second.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await (
        await call("/api/workspace", "GET", undefined, { cookie: secondCookie })
      ).json()
    ).workspace,
    null,
  );
  assert.equal(
    (
      await call(
        "/api/auth/logout",
        "POST",
        {},
        { cookie, "x-csrf-token": me.csrf },
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("/api/workspace", "GET", undefined, { cookie })).status,
    401,
  );
});
test("cross-origin signup and malformed workspace are rejected", async () => {
  assert.equal(
    (
      await call(
        "/api/auth/signup",
        "POST",
        {
          name: "No",
          email: "cross@example.test",
          password: "Long Enough Password!",
        },
        { origin: "https://untrusted.example" },
      )
    ).status,
    403,
  );
  const r = await signup("validation@example.test");
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const me = await (
    await call("/api/auth/me", "GET", undefined, { cookie })
  ).json();
  assert.equal(
    (
      await call(
        "/api/workspace",
        "PUT",
        { profile: {}, jobs: [], applications: {} },
        { cookie, "x-csrf-token": me.csrf },
      )
    ).status,
    400,
  );
});
test("unconfigured Google and invalid callbacks never authenticate", async () => {
  const r = await call("/auth/google");
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /google-unavailable/);
  assert.equal(
    (await call("/auth/google/callback?state=wrong&code=wrong")).headers.get(
      "location",
    ),
    "/login?error=google-failed",
  );
});
test("private configuration and data files are not served", async () => {
  for (const path of ["/data/jobdesk.sqlite", "/server.mjs", "/.env"])
    assert.equal((await call(path)).status, 404);
  const r = await call("/");
  assert.match(
    r.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJobdeskServer } from "../server.mjs";
test("a recovery code is single-use, changes the password, and revokes sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jobdesk-recovery-"));
  const app = createJobdeskServer({ dataDir: dir, port: 0, testMode: true });
  try {
    await app.start();
    const base = `http://localhost:${app.port}`;
    const call = (path, body, extra = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json", ...extra },
        body: JSON.stringify(body),
      });
    const signup = await call("/api/auth/signup", {
      name: "Recovery Test",
      email: "recover@example.test",
      password: "Original Test Password!",
    });
    const cookie = signup.headers.get("set-cookie").split(";")[0];
    const me = await (
      await fetch(base + "/api/auth/me", { headers: { cookie } })
    ).json();
    assert.equal(
      (
        await call(
          "/api/account/recovery",
          { password: "wrong" },
          { cookie, "x-csrf-token": me.csrf },
        )
      ).status,
      401,
    );
    const recovery = await (
      await call(
        "/api/account/recovery",
        { password: "Original Test Password!" },
        { cookie, "x-csrf-token": me.csrf },
      )
    ).json();
    assert.ok(recovery.code);
    const payload = {
      email: "recover@example.test",
      code: recovery.code,
      password: "Replacement Test Password!",
    };
    const attempts = await Promise.all([
      call("/api/auth/recover", payload),
      call("/api/auth/recover", payload),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 401]);
    assert.equal(
      (await fetch(base + "/api/auth/me", { headers: { cookie } })).status,
      401,
    );
    assert.equal((await call("/api/auth/recover", payload)).status, 401);
    assert.equal(
      (
        await call("/api/auth/login", {
          email: payload.email,
          password: "Original Test Password!",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/api/auth/login", {
          email: payload.email,
          password: payload.password,
        })
      ).status,
      200,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

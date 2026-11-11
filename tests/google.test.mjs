import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJobdeskServer, verifyGoogleIdToken } from "../server.mjs";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
};
const clientId = "test-client.apps.googleusercontent.com";
function token(claims = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: clientId,
      sub: "google-test-user",
      email: "different-google@example.test",
      email_verified: true,
      name: "Google Test User",
      nonce: "test-nonce",
      iat: now,
      exp: now + 3600,
      ...claims,
    }),
  ).toString("base64url");
  return `${head}.${payload}.${sign("RSA-SHA256", Buffer.from(head + "." + payload), key).toString("base64url")}`;
}
test("Google identity verification checks signature, audience, nonce, issuer, expiry, and verified email", () => {
  const options = { clientId, nonce: "test-nonce", keys: [jwk] };
  assert.equal(verifyGoogleIdToken(token(), options).sub, "google-test-user");
  for (const claims of [
    { aud: "other-client" },
    { nonce: "other-nonce" },
    { iss: "https://attacker.test" },
    { exp: 1 },
    { email_verified: false },
  ])
    assert.throws(() => verifyGoogleIdToken(token(claims), options));
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() =>
    verifyGoogleIdToken(token({}, other.privateKey), options),
  );
});
test("Google flow binds state, uses PKCE, links the signed-in owner, and rejects replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jobdesk-google-"));
  let nonce = "";
  let exchangeCount = 0;
  const app = createJobdeskServer({
    dataDir: dir,
    port: 0,
    testMode: true,
    googleFetch: async (url, options) => {
      if (url.endsWith("/token")) {
        exchangeCount++;
        assert.ok(options.body.get("code_verifier"));
        return Response.json({ id_token: token({ nonce }) });
      }
      assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
      return Response.json({ keys: [jwk] });
    },
  });
  try {
    await app.start();
    const base = `http://localhost:${app.port}`;
    const call = (path, method = "GET", body, cookie = "", csrf = "") =>
      fetch(base + path, {
        method,
        redirect: "manual",
        headers: {
          origin: base,
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrf,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const signup = await call("/api/auth/signup", "POST", {
      name: "Owner",
      email: "owner@example.test",
      password: "Owner Test Password 2026!",
    });
    const session = signup.headers.get("set-cookie").split(";")[0];
    const me = await (
      await call("/api/auth/me", "GET", undefined, session)
    ).json();
    assert.equal(me.user.isOwner, true);
    assert.equal(
      (
        await call(
          "/api/account/google",
          "POST",
          { clientId, clientSecret: "fixture-secret" },
          session,
          me.csrf,
        )
      ).status,
      200,
    );
    const config = await (
      await call("/api/account/google", "GET", undefined, session)
    ).json();
    assert.equal(config.clientSecret, undefined);
    assert.equal((await call('/auth/google', 'GET', undefined, session)).headers.get('location'), '/?error=google-reauth-required');
    assert.equal((await call('/api/account/google/connect', 'POST', {password: 'Owner Test Password 2026!'}, session)).status, 403);
    assert.equal((await call('/api/account/google/connect', 'POST', {password: 'wrong password'}, session, me.csrf)).status, 401);
    assert.equal((await call('/api/account/google/connect', 'POST', {password: 'Owner Test Password 2026!'}, session, me.csrf)).status, 200);
    const start = await call("/auth/google", "GET", undefined, session);
    assert.equal((await call('/auth/google', 'GET', undefined, session)).headers.get('location'), '/?error=google-reauth-required');
    const location = new URL(start.headers.get("location"));
    assert.equal(location.hostname, "accounts.google.com");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      location.searchParams.get("redirect_uri"),
      base + "/auth/google/callback",
    );
    nonce = location.searchParams.get("nonce");
    const state = location.searchParams.get("state");
    const oauth = start.headers.get("set-cookie").split(";")[0];
    const bad = await call(`/auth/google/callback?state=${state}&code=fixture`);
    assert.match(bad.headers.get("location"), /google-failed/);
    assert.equal(exchangeCount, 0);
    const callback = await call(
      `/auth/google/callback?state=${state}&code=fixture`,
      "GET",
      undefined,
      session + "; " + oauth,
    );
    assert.equal(callback.headers.get("location"), "/");
    assert.equal(exchangeCount, 1);
    assert.equal((await (await call('/api/auth/me', 'GET', undefined, session)).json()).user.email, 'owner@example.test');
    const newSession = callback.headers
      .getSetCookie()
      .find((v) => v.startsWith("jobdesk_session="))
      .split(";")[0];
    assert.equal(
      (await (await call("/api/auth/me", "GET", undefined, newSession)).json())
        .user.googleConnected,
      true,
    );
    assert.match(
      (
        await call(
          `/auth/google/callback?state=${state}&code=fixture`,
          "GET",
          undefined,
          session + "; " + oauth,
        )
      ).headers.get("location"),
      /google-failed/,
    );
    assert.equal(exchangeCount, 1);
    const other = await call("/api/auth/signup", "POST", {
      name: "Other",
      email: "other@example.test",
      password: "Other Test Password 2026!",
    });
    const otherCookie = other.headers.get("set-cookie").split(";")[0];
    const otherMe = await (
      await call("/api/auth/me", "GET", undefined, otherCookie)
    ).json();
    assert.equal(
      (
        await call(
          "/api/account/google",
          "POST",
          { clientId, clientSecret: "replacement" },
          otherCookie,
          otherMe.csrf,
        )
      ).status,
      403,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

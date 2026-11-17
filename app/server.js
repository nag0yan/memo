import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import {
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const SESSION_COOKIE = "memo_session";
const CHALLENGE_COOKIE = "memo_challenge";
const SESSION_MAX_AGE = 60 * 60 * 1000;
const CHALLENGE_MAX_AGE = 5 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INDEX_FILE = fileURLToPath(new URL("./public/index.html", import.meta.url));

export function createApp({ cognitoClient, memoStore, verifyAccessToken, isProduction = false }) {
  if (!cognitoClient || !memoStore || !verifyAccessToken) {
    throw new Error("Cognito, memo store, and token verifier dependencies are required");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.post("/api/auth/login", requireSameOrigin, async (req, res) => {
    const username = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || !password || password.length > 256) {
      throw new HttpError(400, "メールアドレスとパスワードを入力してください。");
    }

    let result;
    try {
      result = await cognitoClient.send(new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: process.env.COGNITO_CLIENT_ID,
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }));
    } catch (error) {
      if (["NotAuthorizedException", "UserNotFoundException", "PasswordResetRequiredException"].includes(error.name)) {
        throw new HttpError(401, "メールアドレスまたはパスワードを確認してください。");
      }
      throw error;
    }

    if (result.ChallengeName === "NEW_PASSWORD_REQUIRED" && result.Session) {
      const challenge = Buffer.from(JSON.stringify({ username, session: result.Session })).toString("base64url");
      res.cookie(CHALLENGE_COOKIE, challenge, cookieOptions(isProduction, CHALLENGE_MAX_AGE, "/api/auth"));
      return res.json({ challenge: "NEW_PASSWORD_REQUIRED" });
    }

    if (!result.AuthenticationResult?.AccessToken) {
      throw new HttpError(401, "ログインを完了できませんでした。");
    }

    setSessionCookie(res, result.AuthenticationResult.AccessToken, isProduction);
    return res.json({ ok: true });
  });

  app.post("/api/auth/new-password", requireSameOrigin, async (req, res) => {
    const challenge = readChallenge(req.cookies?.[CHALLENGE_COOKIE]);
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (newPassword.length < 12 || newPassword.length > 256) {
      throw new HttpError(400, "新しいパスワードは12文字以上で入力してください。");
    }

    let result;
    try {
      result = await cognitoClient.send(new RespondToAuthChallengeCommand({
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ClientId: process.env.COGNITO_CLIENT_ID,
        Session: challenge.session,
        ChallengeResponses: {
          USERNAME: challenge.username,
          NEW_PASSWORD: newPassword,
        },
      }));
    } catch (error) {
      if (["NotAuthorizedException", "InvalidPasswordException", "UserNotFoundException"].includes(error.name)) {
        throw new HttpError(400, "パスワードを確認して、もう一度お試しください。");
      }
      throw error;
    }

    if (!result.AuthenticationResult?.AccessToken) {
      throw new HttpError(401, "ログインを完了できませんでした。");
    }

    res.clearCookie(CHALLENGE_COOKIE, cookieOptions(isProduction, undefined, "/api/auth"));
    setSessionCookie(res, result.AuthenticationResult.AccessToken, isProduction);
    return res.json({ ok: true });
  });

  app.post("/api/auth/logout", requireSameOrigin, (req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions(isProduction, undefined, "/"));
    res.clearCookie(CHALLENGE_COOKIE, cookieOptions(isProduction, undefined, "/api/auth"));
    res.status(204).end();
  });

  app.get("/api/me", requireUser(verifyAccessToken), (req, res) => {
    res.json({ sub: req.user.sub });
  });

  app.get("/api/memos", requireUser(verifyAccessToken), async (req, res) => {
    res.json(await memoStore.list(req.user.sub));
  });

  app.post("/api/memos", requireSameOrigin, requireUser(verifyAccessToken), async (req, res) => {
    const memo = parseMemo(req.body);
    res.status(201).json(await memoStore.create(req.user.sub, memo));
  });

  app.put("/api/memos/:id", requireSameOrigin, requireUser(verifyAccessToken), async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) {
      throw new HttpError(404, "メモが見つかりません。");
    }
    const memo = parseMemo(req.body);
    const updated = await memoStore.update(req.user.sub, req.params.id, memo);
    if (!updated) {
      throw new HttpError(404, "メモが見つかりません。");
    }
    res.json(updated);
  });

  app.delete("/api/memos/:id", requireSameOrigin, requireUser(verifyAccessToken), async (req, res) => {
    if (!UUID_PATTERN.test(req.params.id)) {
      throw new HttpError(404, "メモが見つかりません。");
    }
    const deleted = await memoStore.delete(req.user.sub, req.params.id);
    if (!deleted) {
      throw new HttpError(404, "メモが見つかりません。");
    }
    res.status(204).end();
  });

  app.use(express.static(fileURLToPath(new URL("./public/", import.meta.url))));
  app.get("/", async (req, res, next) => {
    try {
      res.send(await readFile(INDEX_FILE));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.status === 400 || error.status === 413) {
      return res.status(error.status).json({
        error: error.status === 413 ? "リクエストが大きすぎます。" : "リクエスト形式が正しくありません。",
      });
    }

    console.error("Request failed", { method: req.method, path: req.path, errorName: error.name });
    return res.status(500).json({ error: "サーバーエラーが発生しました。" });
  });

  return app;
}

function requireUser(verifyAccessToken) {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) {
      return next(new HttpError(401, "ログインしてください。"));
    }
    try {
      req.user = await verifyAccessToken(token);
      return next();
    } catch (error) {
      if (error.status === 401) {
        res.clearCookie(SESSION_COOKIE, { path: "/" });
        return next(new HttpError(401, "ログインしてください。"));
      }
      return next(error);
    }
  };
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) {
    return next(new HttpError(403, "このリクエストは許可されていません。"));
  }
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host !== host || !["http:", "https:"].includes(parsedOrigin.protocol)) {
      return next(new HttpError(403, "このリクエストは許可されていません。"));
    }
  } catch (error) {
    if (error instanceof TypeError) {
      return next(new HttpError(403, "このリクエストは許可されていません。"));
    }
    return next(error);
  }
  return next();
}

function parseMemo(body) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  if (!title || title.length > 200 || content.length > 20_000) {
    throw new HttpError(400, "タイトルは1〜200文字、本文は20,000文字以内で入力してください。");
  }
  return { title, content };
}

function readChallenge(value) {
  if (!value) {
    throw new HttpError(401, "ログインの有効期限が切れました。もう一度ログインしてください。");
  }
  let challenge;
  try {
    challenge = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(401, "ログインの有効期限が切れました。もう一度ログインしてください。");
    }
    throw error;
  }
  if (typeof challenge?.username !== "string" || typeof challenge?.session !== "string") {
    throw new HttpError(401, "ログインの有効期限が切れました。もう一度ログインしてください。");
  }
  return challenge;
}

function setSessionCookie(res, accessToken, isProduction) {
  res.cookie(SESSION_COOKIE, accessToken, cookieOptions(isProduction, SESSION_MAX_AGE, "/"));
}

function cookieOptions(isProduction, maxAge, path) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path,
    ...(maxAge ? { maxAge } : {}),
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

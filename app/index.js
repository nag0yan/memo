import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import { createApp } from "./server.js";
import { createTokenVerifier } from "./token.js";
import { createMemoStore } from "./memo-store.js";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-1";
const userPoolId = requiredEnv("COGNITO_USER_POOL_ID");
const clientId = requiredEnv("COGNITO_CLIENT_ID");
const dsqlEndpoint = requiredEnv("DSQL_ENDPOINT");

const cognitoClient = new CognitoIdentityProviderClient({ region });
const dsqlPool = new AuroraDSQLPool({
  host: dsqlEndpoint,
  user: "memo_app",
  max: 4,
  idleTimeoutMillis: 30_000,
});

const app = createApp({
  cognitoClient,
  memoStore: createMemoStore(dsqlPool),
  verifyAccessToken: createTokenVerifier({ userPoolId, clientId, region }),
  isProduction: process.env.NODE_ENV === "production",
});

const [host, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT || "127.0.0.1:3000").split(":");
const server = app.listen(Number(port), host, () => {
  console.log(`Memo server listening on ${host}:${port}`);
});

server.on("error", (error) => {
  console.error("Memo server failed to start", error);
  process.exitCode = 1;
});

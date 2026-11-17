import { AuroraDSQLClient } from "@aws/aurora-dsql-node-postgres-connector";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const host = requiredEnv("DSQL_ENDPOINT");
const webRoleArn = requiredEnv("WEB_FUNCTION_ROLE_ARN");
const client = new AuroraDSQLClient({ host, user: "admin" });
let connected = false;

try {
  await client.connect();
  connected = true;

  try {
    await client.query("CREATE ROLE memo_app WITH LOGIN");
  } catch (error) {
    if (error.code !== "42710") {
      throw error;
    }
  }

  const mapping = await client.query(
    "SELECT 1 FROM sys.iam_pg_role_mappings WHERE arn = $1 AND pg_role_name = 'memo_app'",
    [webRoleArn],
  );
  if (mapping.rowCount === 0) {
    await client.query(`AWS IAM GRANT memo_app TO '${escapeSqlLiteral(webRoleArn)}'`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.memos (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (owner_id, id)
    )
  `);
  const schemaAccess = await client.query(
    "SELECT has_schema_privilege($1, $2, $3) AS allowed",
    ["memo_app", "public", "USAGE"],
  );
  if (!schemaAccess.rows[0].allowed) {
    throw new Error("The memo_app role does not have USAGE permission on the public schema.");
  }
  await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON public.memos TO memo_app");
  console.log("Aurora DSQL memo schema is ready.");
} finally {
  if (connected) {
    await client.end();
  }
}

function escapeSqlLiteral(value) {
  return value.replaceAll("'", "''");
}

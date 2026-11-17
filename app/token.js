import { createRemoteJWKSet, errors, jwtVerify } from "jose";

export function createTokenVerifier({ userPoolId, clientId, region }) {
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async function verifyAccessToken(token) {
    let payload;

    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub"],
      }));
    } catch (error) {
      if (error instanceof errors.JOSEError) {
        const unauthorized = new Error("Invalid access token");
        unauthorized.status = 401;
        throw unauthorized;
      }
      throw error;
    }

    if (payload.token_use !== "access" || payload.client_id !== clientId || typeof payload.sub !== "string") {
      const unauthorized = new Error("Invalid access token");
      unauthorized.status = 401;
      throw unauthorized;
    }

    return { sub: payload.sub };
  };
}

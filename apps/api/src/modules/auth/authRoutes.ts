import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { login, InvalidCredentialsError, type AuthLoginDb } from "./authLogin.service.js";
import { refreshTokens, InvalidRefreshTokenError, type AuthRefreshDb } from "./authRefresh.service.js";

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_PATH = "/auth/refresh";

const loginBodySchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

export interface RegisterAuthRoutesDeps {
  loginDb: AuthLoginDb;
  refreshDb: AuthRefreshDb;
  jwtSecret: string;
}

export function registerAuthRoutes(app: FastifyInstance, deps: RegisterAuthRoutesDeps): void {
  app.post("/auth/login", async (request, reply) => {
    const body = loginBodySchema.parse(request.body);

    try {
      const result = await login(deps.loginDb, deps.jwtSecret, body);
      await reply
        .setCookie(REFRESH_COOKIE_NAME, result.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: REFRESH_COOKIE_PATH,
          expires: result.refreshTokenExpiresAt,
        })
        .code(200)
        .send({ accessToken: result.accessToken });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        await reply.code(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  app.post("/auth/refresh", async (request, reply) => {
    const presentedToken = request.cookies[REFRESH_COOKIE_NAME];
    if (!presentedToken) {
      await reply.code(401).send({ error: "Refresh token bulunamadı." });
      return;
    }

    try {
      const result = await refreshTokens(deps.refreshDb, deps.jwtSecret, presentedToken);
      await reply
        .setCookie(REFRESH_COOKIE_NAME, result.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: REFRESH_COOKIE_PATH,
          expires: result.refreshTokenExpiresAt,
        })
        .code(200)
        .send({ accessToken: result.accessToken });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
        await reply.code(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });
}

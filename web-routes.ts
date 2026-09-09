import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type mysql from "mysql2/promise";

type WebRole = "admin" | "employee";
type WebUserRow = {
  id: string;
  staffId: string;
  username: string;
  passwordHash: string;
  role: WebRole;
  active: number;
};

type WebSessionRow = {
  id: string;
  userId: string;
  staffId: string;
  username: string;
  role: WebRole;
  expiresAt: number;
};

type SettlementRow = {
  id: string;
  business_date: string;
  author_id: string;
  author_name: string;
  author_role: string;
  settlement_status: string;
  updated_at: number;
  payload_json: unknown;
};

type WebRequest = Request & { webUser?: Omit<WebSessionRow, "expiresAt"> };

const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

const hashToken = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const verifyPassword = (password: string, stored: string) => {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const disabled = (response: Response) => response.status(503).json({ code: "WEB_DISABLED", message: "웹 기능이 아직 활성화되지 않았습니다." });

export function registerWebRoutes(
  app: { get: Function; post: Function },
  pool: mysql.Pool,
  options: { webEnabled: boolean }
) {
  const requireWeb = (request: WebRequest, response: Response, next: NextFunction) => {
    if (!options.webEnabled) return disabled(response);
    const raw = request.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw) return response.status(401).json({ code: "WEB_AUTH_REQUIRED", message: "웹 로그인이 필요합니다." });
    const tokenHash = hashToken(raw);
    void pool.query<WebSessionRow[]>(
      "SELECT ws.id, ws.userId, wu.staffId, wu.username, wu.role, ws.expiresAt FROM web_sessions ws JOIN web_users wu ON wu.id = ws.userId WHERE ws.tokenHash=? AND wu.active=1 AND ws.expiresAt>? LIMIT 1",
      [tokenHash, Date.now()]
    ).then(([rows]) => {
      const session = rows[0];
      if (!session) return response.status(401).json({ code: "WEB_SESSION_INVALID", message: "웹 로그인 세션이 유효하지 않습니다." });
      request.webUser = { id: session.id, userId: session.userId, staffId: session.staffId, username: session.username, role: session.role };
      return pool.execute("UPDATE web_sessions SET lastSeenAt=? WHERE id=?", [Date.now(), session.id]).then(() => next());
    }).catch(next);
  };

  app.get("/v1/web/status", (_request: Request, response: Response) => {
    if (!options.webEnabled) return disabled(response);
    response.json({ ok: true, enabled: true });
  });

  app.post("/v1/web/auth/login", async (request: Request, response: Response, next: NextFunction) => {
    if (!options.webEnabled) return disabled(response);
    try {
      const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      if (!username || !password) return response.status(400).json({ code: "INVALID_LOGIN", message: "아이디와 비밀번호가 필요합니다." });
      const [rows] = await pool.query<WebUserRow[]>(
        "SELECT id, staffId, username, passwordHash, role, active FROM web_users WHERE username=? LIMIT 1",
        [username]
      );
      const user = rows[0];
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        return response.status(401).json({ code: "LOGIN_FAILED", message: "아이디 또는 비밀번호가 올바르지 않습니다." });
      }
      const token = crypto.randomBytes(48).toString("base64url");
      const now = Date.now();
      const expiresAt = now + sessionTtlMs;
      await pool.execute(
        "INSERT INTO web_sessions (id,userId,tokenHash,expiresAt,createdAt,lastSeenAt) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), user.id, hashToken(token), expiresAt, now, now]
      );
      response.json({ token, expiresAt, user: { staffId: user.staffId, username: user.username, role: user.role } });
    } catch (error) { next(error); }
  });

  app.get("/v1/web/auth/me", requireWeb, (request: WebRequest, response: Response) => {
    response.json({ user: request.webUser ? { staffId: request.webUser.staffId, username: request.webUser.username, role: request.webUser.role } : null });
  });

  app.post("/v1/web/auth/logout", requireWeb, async (request: WebRequest, response: Response, next: NextFunction) => {
    try {
      await pool.execute("DELETE FROM web_sessions WHERE id=?", [request.webUser!.id]);
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get("/v1/web/settlements", requireWeb, async (request: WebRequest, response: Response, next: NextFunction) => {
    try {
      const limitValue = Number(request.query.limit ?? 100);
      const limit = Number.isFinite(limitValue) ? Math.min(500, Math.max(1, Math.floor(limitValue))) : 100;
      const user = request.webUser!;
      const params: unknown[] = [];
      let where = "";
      if (user.role === "employee") {
        where = "WHERE author_id=?";
        params.push(user.staffId);
      }
      const [rows] = await pool.query<SettlementRow[]>(
        `SELECT id,business_date,author_id,author_name,author_role,settlement_status,updated_at,payload_json FROM settlements ${where} ORDER BY updated_at DESC LIMIT ${limit}`,
        params
      );
      response.json({
        settlements: rows.map((row) => ({
          id: row.id,
          businessDate: row.business_date,
          author: { id: row.author_id, name: row.author_name, role: row.author_role },
          status: row.settlement_status,
          updatedAt: Number(row.updated_at),
          payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json
        }))
      });
    } catch (error) { next(error); }
  });
}

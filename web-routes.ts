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
type WebApp = { get: (path: string, ...handlers: any[]) => void; post: (path: string, ...handlers: any[]) => void; all: (path: string, ...handlers: any[]) => void };

const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;

const hashToken = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const safeTokenEqual = (left: string, right: string) => crypto.timingSafeEqual(Buffer.from(hashToken(left)), Buffer.from(hashToken(right)));

const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
};

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
  app: WebApp,
  pool: mysql.Pool,
  options: { webEnabled: boolean; adminApiToken: string }
) {
  if (!options.webEnabled) {
    app.all("/v1/web/*", (_request: Request, response: Response) => {
      disabled(response);
    });
    return;
  }

  const requireWeb = (request: WebRequest, response: Response, next: NextFunction) => {
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


  app.post("/v1/web/bootstrap", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const suppliedToken = request.header("x-admin-token") ?? "";
      if (!safeTokenEqual(suppliedToken, options.adminApiToken)) {
        return response.status(401).json({ code: "ADMIN_AUTH_REQUIRED", message: "관리자 설정 권한이 필요합니다." });
      }
      const [countRows] = await pool.query<Array<{ count: number }>>("SELECT COUNT(*) AS count FROM web_users");
      if (Number(countRows[0]?.count ?? 0) > 0) return response.status(409).json({ code: "WEB_ALREADY_INITIALIZED", message: "웹 사용자가 이미 초기화되었습니다." });
      const staffId = typeof request.body?.staffId === "string" ? request.body.staffId.trim() : "";
      const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      if (!staffId || !username || password.length < 8) return response.status(400).json({ code: "INVALID_BOOTSTRAP", message: "staffId, username, 8자 이상 password가 필요합니다." });
      const [staffRows] = await pool.query<Array<{ id: string; role: WebRole; status: string }>>("SELECT id, role, status FROM settlement_staff WHERE id=? LIMIT 1", [staffId]);
      const staff = staffRows[0];
      if (!staff || staff.status !== "active" || staff.role !== "admin") return response.status(400).json({ code: "INVALID_BOOTSTRAP_STAFF", message: "활성 관리자 직원만 최초 웹 관리자로 설정할 수 있습니다." });
      const now = Date.now();
      await pool.execute(
        "INSERT INTO web_users (id,staffId,username,passwordHash,role,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)",
        [crypto.randomUUID(), staffId, username, hashPassword(password), "admin", 1, now, now]
      );
      response.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });

  const requireAdmin = (request: WebRequest, response: Response, next: NextFunction) => {
    if (request.webUser?.role !== "admin") return response.status(403).json({ code: "WEB_ADMIN_REQUIRED", message: "관리자 권한이 필요합니다." });
    next();
  };

  app.post("/v1/web/admin/users", requireWeb, requireAdmin, async (request: WebRequest, response: Response, next: NextFunction) => {
    try {
      const staffId = typeof request.body?.staffId === "string" ? request.body.staffId.trim() : "";
      const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      const role = request.body?.role === "admin" ? "admin" : request.body?.role === "employee" ? "employee" : "";
      if (!staffId || !username || password.length < 8 || !role) return response.status(400).json({ code: "INVALID_WEB_USER", message: "staffId, username, role, 8자 이상 password가 필요합니다." });
      const [countRows] = await pool.query<Array<{ count: number }>>("SELECT COUNT(*) AS count FROM web_users WHERE active=1");
      if (Number(countRows[0]?.count ?? 0) >= 5) return response.status(409).json({ code: "WEB_USER_LIMIT", message: "웹 사용자는 관리자 포함 최대 5명입니다." });
      const [staffRows] = await pool.query<Array<{ id: string; role: WebRole; status: string }>>("SELECT id, role, status FROM settlement_staff WHERE id=? LIMIT 1", [staffId]);
      const staff = staffRows[0];
      if (!staff || staff.status !== "active" || staff.role !== role) return response.status(400).json({ code: "INVALID_STAFF", message: "활성 직원 정보와 역할이 일치해야 합니다." });
      const now = Date.now();
      const id = crypto.randomUUID();
      await pool.execute(
        "INSERT INTO web_users (id,staffId,username,passwordHash,role,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)",
        [id, staffId, username, hashPassword(password), role, 1, now, now]
      );
      response.status(201).json({ id, staffId, username, role });
    } catch (error) { next(error); }
  });

  app.get("/v1/web/status", (_request: Request, response: Response) => {
    response.json({ ok: true, enabled: true });
  });

  app.post("/v1/web/auth/login", async (request: Request, response: Response, next: NextFunction) => {
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

  app.post("/v1/web/settlements", requireWeb, async (request: WebRequest, response: Response, next: NextFunction) => {
    const user = request.webUser!;
    const payload = request.body?.payload;
    if (!payload || typeof payload !== "object") return response.status(400).json({ code: "INVALID_SETTLEMENT", message: "payload가 필요합니다." });
    const id = typeof (payload as any).id === "string" ? (payload as any).id.trim() : "";
    const businessDate = typeof (payload as any).businessDate === "string" ? (payload as any).businessDate : "";
    if (!id || id.length > 96 || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return response.status(400).json({ code: "INVALID_SETTLEMENT", message: "정산 ID 또는 영업일 형식이 올바르지 않습니다." });
    const createdBy = (payload as any).createdBy;
    if (!createdBy || typeof createdBy !== "object") return response.status(400).json({ code: "INVALID_SETTLEMENT", message: "createdBy가 필요합니다." });
    if (user.role === "employee" && createdBy.id !== user.staffId) return response.status(403).json({ code: "WEB_AUTHOR_FORBIDDEN", message: "직원은 본인 정산만 작성할 수 있습니다." });
    const status = typeof (payload as any).status === "string" ? (payload as any).status : "draft";
    const updatedAt = Number((payload as any).updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return response.status(400).json({ code: "INVALID_SETTLEMENT", message: "updatedAt이 필요합니다." });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.query<SettlementRow[]>("SELECT id,business_date,author_id,author_name,author_role,settlement_status,updated_at,payload_json FROM settlements WHERE id=? LIMIT 1 FOR UPDATE", [id]);
      const existing = existingRows[0];
      if (existing && user.role === "employee" && existing.author_id !== user.staffId) {
        await connection.rollback();
        return response.status(403).json({ code: "WEB_SETTLEMENT_FORBIDDEN", message: "다른 직원의 정산은 수정할 수 없습니다." });
      }
      if (existing && user.role === "employee" && !["draft","submitted","rejected"].includes(existing.settlement_status)) {
        await connection.rollback();
        return response.status(409).json({ code: "WEB_SETTLEMENT_LOCKED", message: "승인 완료된 정산은 직원이 수정할 수 없습니다." });
      }
      const finalAuthorId = existing?.author_id ?? user.staffId;
      const finalAuthorName = existing?.author_name ?? (typeof createdBy.name === "string" ? createdBy.name : user.username);
      const finalAuthorRole = existing?.author_role ?? user.role;
      (payload as any).createdBy = { id: finalAuthorId, name: finalAuthorName, role: finalAuthorRole };
      await connection.execute(
        "INSERT INTO settlements (id,business_date,author_id,author_name,author_role,settlement_status,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,CAST(? AS JSON)) ON DUPLICATE KEY UPDATE business_date=VALUES(business_date), author_name=VALUES(author_name), settlement_status=VALUES(settlement_status), updated_at=VALUES(updated_at), payload_json=VALUES(payload_json)",
        [id, businessDate, finalAuthorId, finalAuthorName, finalAuthorRole, status, updatedAt, JSON.stringify(payload)]
      );
      await connection.commit();
      response.status(existing ? 200 : 201).json({ ok: true, id });
    } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
  });

  const transitionSettlement = (nextStatus: string) => async (request: WebRequest, response: Response, next: NextFunction) => {
    const user = request.webUser!;
    if (user.role !== "admin") return response.status(403).json({ code: "WEB_ADMIN_REQUIRED", message: "관리자 권한이 필요합니다." });
    const id = request.params.id;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<SettlementRow[]>("SELECT id,business_date,author_id,author_name,author_role,settlement_status,updated_at,payload_json FROM settlements WHERE id=? LIMIT 1 FOR UPDATE", [id]);
      const row = rows[0];
      if (!row) { await connection.rollback(); return response.status(404).json({ code: "SETTLEMENT_NOT_FOUND", message: "정산을 찾을 수 없습니다." }); }
      const payload = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json as any;
      const now = Date.now();
      payload.status = nextStatus;
      payload.updatedAt = now;
      const events = Array.isArray(payload.approvalEvents) ? payload.approvalEvents : [];
      events.push({ status: nextStatus, actor: { id: user.staffId, name: user.username, role: "admin" }, createdAt: now });
      payload.approvalEvents = events;
      await connection.execute("UPDATE settlements SET settlement_status=?, updated_at=?, payload_json=CAST(? AS JSON) WHERE id=?", [nextStatus, now, JSON.stringify(payload), id]);
      await connection.execute("INSERT INTO settlement_events (id,settlement_id,device_id,event_type,created_at,payload_json) VALUES (?,?,?,?,?,CAST(? AS JSON))", [crypto.randomUUID(), id, "web:" + user.staffId, nextStatus, now, JSON.stringify({ source: "web", actor: { id: user.staffId, name: user.username, role: "admin" }, status: nextStatus })]);
      await connection.commit();
      response.json({ ok: true, id, status: nextStatus });
    } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
  };
  app.post("/v1/web/settlements/:id/approve", requireWeb, transitionSettlement("manager_approved"));
  app.post("/v1/web/settlements/:id/reject", requireWeb, transitionSettlement("rejected"));


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

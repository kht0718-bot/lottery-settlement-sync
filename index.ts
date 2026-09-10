import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { createDatabasePool } from "./pg-compat.js";
import { z } from "zod";
import { registerStaffSyncRoutes } from "./staff-sync.js";
import { registerWebRoutes } from "./web-routes.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
  return value;
};

const webEnabled = String(process.env.WEB_ENABLED ?? "false").toLowerCase() === "true";

const databaseUrl = required("DATABASE_URL");
const pairCode = required("PAIR_CODE_V2");
const tokenSecret = required("TOKEN_SECRET");
if (pairCode.length < 12) throw new Error("PAIR_CODE는 12자 이상이어야 합니다.");
if (tokenSecret.length < 32) throw new Error("TOKEN_SECRET은 32자 이상이어야 합니다.");

const port = Number(process.env.PORT ?? 3000);
const configuredJsonLimit = process.env.JSON_BODY_LIMIT ?? "40mb";
if (!/^\d+(?:kb|mb)$/i.test(configuredJsonLimit)) throw new Error("JSON_BODY_LIMIT은 예: 1mb 또는 40mb 형식이어야 합니다.");
const maxDevices = 10; // 활성 등록 기기는 정확히 10대로 고정
const adminApiToken = required("ADMIN_API_TOKEN");
const configuredConnectionLimit = Number(process.env.DB_CONNECTION_LIMIT ?? 10);
const dbConnectionLimit = Number.isFinite(configuredConnectionLimit) ? Math.min(50, Math.max(1, Math.floor(configuredConnectionLimit))) : 10;
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const connectionUrl = new URL(databaseUrl);
const dbDriver = connectionUrl.protocol.replace(":", "").toLowerCase();
console.log("[DB_TARGET]", JSON.stringify({ driver: dbDriver, host: connectionUrl.hostname || null, port: connectionUrl.port || "5432", database: connectionUrl.pathname.slice(1) || null, sslmode: connectionUrl.searchParams.get("sslmode") || null }));
const pool = createDatabasePool(databaseUrl, dbConnectionLimit);

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    created_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id VARCHAR(96) PRIMARY KEY,
    business_date DATE NOT NULL,
    author_id VARCHAR(64) NOT NULL,
    author_name VARCHAR(120) NOT NULL,
    author_role VARCHAR(20) NOT NULL CHECK (author_role IN ('admin','employee')),
    settlement_status VARCHAR(40) NOT NULL,
    updated_at BIGINT NOT NULL,
    payload_json JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_events (
    id VARCHAR(96) PRIMARY KEY,
    settlement_id VARCHAR(96) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    created_at BIGINT NOT NULL,
    payload_json JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_staff (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(120) NOT NULL, phone VARCHAR(40),
    role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
    version BIGINT NOT NULL DEFAULT 1, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL, deletedAt BIGINT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_staff_change_log (
    id BIGSERIAL PRIMARY KEY, staffId VARCHAR(64) NOT NULL,
    changeType VARCHAR(20) NOT NULL CHECK (changeType IN ('created','updated','deleted')),
    version BIGINT NOT NULL, payloadJson TEXT NOT NULL, changedBy VARCHAR(64) NULL, changedAt BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_devices (
    id VARCHAR(96) PRIMARY KEY, deviceFingerprint VARCHAR(160) NOT NULL UNIQUE, deviceName VARCHAR(120) NOT NULL,
    staffId VARCHAR(64) NULL, status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','reset_pending','revoked','candidate')),
    lastSyncAt BIGINT NULL, lastSeenAt BIGINT NULL, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_device_action_approvals (
    id BIGSERIAL PRIMARY KEY, deviceId VARCHAR(96) NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('reset','revoke','cleanup')),
    status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','executed')),
    requestedBy VARCHAR(64) NOT NULL, approvedBy VARCHAR(64) NULL, reason VARCHAR(500) NOT NULL,
    createdAt BIGINT NOT NULL, approvedAt BIGINT NULL, executedAt BIGINT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_reconciliation (
    settlementId VARCHAR(96) PRIMARY KEY, safeAmount BIGINT NOT NULL DEFAULT 0, bankTransferAmount BIGINT NOT NULL DEFAULT 0,
    expectedTotal BIGINT NOT NULL DEFAULT 0, actualTotal BIGINT NOT NULL DEFAULT 0, difference BIGINT NOT NULL DEFAULT 0, sourceUpdatedAt BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_audit_logs (
    id BIGSERIAL PRIMARY KEY, actorId VARCHAR(64) NOT NULL, action VARCHAR(80) NOT NULL,
    entityType VARCHAR(50) NOT NULL, entityId VARCHAR(120) NOT NULL, detailJson TEXT NOT NULL, createdAt BIGINT NOT NULL
  )`,
  ...(webEnabled ? [
    `CREATE TABLE IF NOT EXISTS web_users (
      id VARCHAR(64) PRIMARY KEY, staffId VARCHAR(64) NOT NULL UNIQUE, username VARCHAR(120) NOT NULL UNIQUE,
      passwordHash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL CHECK (role IN ('admin','employee')),
      active BOOLEAN NOT NULL DEFAULT TRUE, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS web_sessions (
      id VARCHAR(96) PRIMARY KEY, userId VARCHAR(64) NOT NULL, tokenHash CHAR(64) NOT NULL UNIQUE,
      expiresAt BIGINT NOT NULL, createdAt BIGINT NOT NULL, lastSeenAt BIGINT NOT NULL
    )`,
  ] : []),
  `CREATE INDEX IF NOT EXISTS idx_settlements_date ON settlements (business_date)`,
  `CREATE INDEX IF NOT EXISTS idx_settlements_updated ON settlements (updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_settlement ON settlement_events (settlement_id)`,
  ...(webEnabled ? [
    `CREATE INDEX IF NOT EXISTS idx_web_users_staff ON web_users (staffId)`,
    `CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions (userId)`,
    `CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions (expiresAt)`,
  ] : []),
];

const initializeDatabase = async () => {
  for (const statement of schemaStatements) await pool.query(statement);
  console.log("lottery sync API database schema ready");
};

const tokenOnlyDisconnectResult = (deviceId: string) => ({ ok: true as const, deviceId, tokenRevoked: true as const, settlementDataPreserved: true as const });

const initializeDatabaseWithRetry = async () => {
  const delays = [0, 2000, 5000, 10000, 20000, 30000];
  const configuredAttempts = Number(process.env.DB_INIT_MAX_ATTEMPTS ?? delays.length);
  const maxAttempts = Number.isFinite(configuredAttempts) ? Math.max(1, Math.floor(configuredAttempts)) : delays.length;
  let attempt = 0;
  while (attempt < maxAttempts) {
    const delay = attempt < delays.length ? delays[attempt] : delays[delays.length - 1];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await initializeDatabase();
      console.info("[DB_INIT_READY]", { attempt: attempt + 1 });
      return;
    } catch (error) {
      attempt += 1;
      console.error("[DB_INIT_RETRY]", attempt, error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`DB initialization failed after ${maxAttempts} attempts`);
};

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.disable("x-powered-by");
app.use(express.json({ limit: configuredJsonLimit }));
app.use(express.static(path.join(__dirname, "../public")));

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  const origin = request.header("origin");
  if (origin && !allowedOrigins.includes(origin)) return response.status(403).json({ message: "허용되지 않은 Origin입니다." });
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});

type TokenPayload = { deviceId: string; expiresAt: number };
const encodeToken = (payload: TokenPayload) => {
  const text = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", tokenSecret).update(text).digest("base64url");
  return `${text}.${signature}`;
};
const decodeToken = (token: string): TokenPayload | null => {
  try {
    const [text, signature] = token.split(".");
    if (!text || !signature) return null;
    const expected = crypto.createHmac("sha256", tokenSecret).update(text).digest("base64url");
    const receivedBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");
    if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as TokenPayload;
    return typeof payload.deviceId === "string" && Number.isFinite(payload.expiresAt) && payload.expiresAt > Date.now() ? payload : null;
  } catch {
    return null;
  }
};

declare global { namespace Express { interface Request { deviceId?: string; } } }

const requireAdmin = (request: Request, response: Response, next: NextFunction) => {
  const supplied = request.header("x-admin-token") ?? request.header("authorization")?.replace(/^Bearer\\s+/i, "");
  if (!supplied || supplied !== adminApiToken) return response.status(403).json({ message: "관리자 인증이 필요합니다." });
  next();
};

const requireDevice = async (request: Request, response: Response, next: NextFunction) => {
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? decodeToken(token) : null;
  if (!payload) return response.status(401).json({ message: "유효한 기기 토큰이 필요합니다." });
  try {
    const [rows] = await pool.query<({ id: string })[]>("SELECT id FROM devices WHERE id = ? LIMIT 1", [payload.deviceId]);
    if (!rows[0]) return response.status(401).json({ message: "초기화되었거나 등록되지 않은 기기입니다. 다시 연결해 주세요." });
    request.deviceId = payload.deviceId;
    next();
  } catch (error) { next(error); }
};

registerStaffSyncRoutes(app, pool, requireDevice);

registerWebRoutes(app, pool, { webEnabled, adminApiToken });

const pairingAttempts = new Map<string, { count: number; resetAt: number }>();
const permitPairing = (request: Request) => {
  const key = request.ip || "unknown";
  const now = Date.now();
  const current = pairingAttempts.get(key);
  const record = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
  if (record.count >= 10) return false;
  record.count += 1;
  pairingAttempts.set(key, record);
  return true;
};

const eventSchema = z.object({
  id: z.string().min(1).max(128),
  eventType: z.string().min(1).max(60),
  createdAt: z.number().int().positive(),
  payload: z.object({
    id: z.string().min(1).max(96),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    createdBy: z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(120), role: z.enum(["admin", "employee"]) }),
    status: z.string().min(1).max(40),
    updatedAt: z.number().int().positive(),
  }).passthrough(),
});

app.get("/health", (_request: Request, response: Response) => response.json({ ok: true, service: "lottery-settlement-sync" }));
app.get("/ready", async (_request: Request, response: Response) => { try { await pool.query("SELECT 1"); response.json({ ok: true, database: "ready" }); } catch { response.status(503).json({ ok: false, database: "unavailable" }); } });

app.post("/v1/pair", async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!permitPairing(request)) return response.status(429).json({ message: "연결 코드 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." });
    console.info("[PAIR_REQUEST]", { contentLength: request.header("content-length") ?? null, keys: request.body && typeof request.body === "object" ? Object.keys(request.body).sort() : [] });
    const parsed = z.object({ pairCode: z.string().min(12).max(200), deviceName: z.string().min(1).max(120), deviceFingerprint: z.string().min(8).max(160).optional(), staffId: z.string().max(64).optional() }).safeParse(request.body);
    const submittedCode = parsed.success ? Buffer.from(parsed.data.pairCode) : Buffer.alloc(0);
    const deviceName = parsed.success ? parsed.data.deviceName.trim() : "";
    const deviceFingerprint = parsed.success ? parsed.data.deviceFingerprint?.trim() || `legacy-${crypto.randomUUID()}` : `legacy-${crypto.randomUUID()}`;
    const staffId = parsed.success ? parsed.data.staffId?.trim() || null : null;
    const expectedCode = Buffer.from(pairCode);
    const codeMatches = submittedCode.length === expectedCode.length && crypto.timingSafeEqual(submittedCode, expectedCode);
    if (!codeMatches) return response.status(401).json({ message: "연결 코드가 올바르지 않습니다." });
    // 동일 핸드폰의 앱 재설치·APK 교체는 신규 기기 등록이 아니라 재연결로 처리합니다.
    // 연결 코드 검증을 통과한 뒤 기존 deviceId와 정산 데이터는 유지하고 토큰만 재발급합니다.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [duplicateRows] = await connection.query<({ id: string; status: string })[]>("SELECT id, status FROM settlement_devices WHERE deviceFingerprint = ? LIMIT 1 FOR UPDATE", [deviceFingerprint]);
      const existingDevice = duplicateRows[0];
      if (!existingDevice) {
        const [countRows] = await connection.query<({ count: number })[]>("SELECT COUNT(*) AS count FROM settlement_devices WHERE status IN ('active','reset_pending') FOR UPDATE");
        if ((countRows[0]?.count ?? 0) >= maxDevices) {
          await connection.rollback();
          return response.status(409).json({ message: `등록 가능 기기 수(${maxDevices})에 도달했습니다.` });
        }
      }
      const deviceId = existingDevice?.id ?? `device-${crypto.randomUUID()}`;
      const now = Date.now();
      if (existingDevice) {
        await connection.execute("INSERT INTO devices (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, last_seen_at=EXCLUDED.last_seen_at", [deviceId, deviceName, now, now]);
        await connection.execute("UPDATE settlement_devices SET deviceName=?, staffId=?, status='active', lastSeenAt=?, updatedAt=? WHERE id=?", [deviceName, staffId, now, now, deviceId]);
      } else {
        await connection.execute("INSERT INTO devices (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)", [deviceId, deviceName, now, now]);
        await connection.execute("INSERT INTO settlement_devices (id, deviceFingerprint, deviceName, staffId, status, lastSeenAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)", [deviceId, deviceFingerprint, deviceName, staffId, now, now, now]);
      }
      await connection.commit();
      response.status(existingDevice ? 200 : 201).json({ deviceId, reconnected: Boolean(existingDevice), token: encodeToken({ deviceId, expiresAt: now + 1000 * 60 * 60 * 24 * 180 }) });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) { next(error); }
});

app.post("/v1/sync/events", requireDevice, async (request: Request, response: Response, next: NextFunction) => {
  const parsed = z.object({ events: z.array(eventSchema).min(1).max(100) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "동기화 데이터 형식이 올바르지 않습니다." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const event of parsed.data.events) {
      const record = event.payload;
      await connection.execute("INSERT INTO settlement_events (id, settlement_id, device_id, event_type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT (id) DO NOTHING", [event.id, record.id, request.deviceId!, event.eventType, event.createdAt, JSON.stringify(record)]);
      await connection.execute("INSERT INTO settlements (id, business_date, author_id, author_name, author_role, settlement_status, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT (id) DO UPDATE SET business_date=EXCLUDED.business_date, author_id=EXCLUDED.author_id, author_name=EXCLUDED.author_name, author_role=EXCLUDED.author_role, settlement_status=EXCLUDED.settlement_status, payload_json=EXCLUDED.payload_json, updated_at=EXCLUDED.updated_at WHERE EXCLUDED.updated_at >= settlements.updated_at", [record.id, record.businessDate, record.createdBy.id, record.createdBy.name, record.createdBy.role, record.status, record.updatedAt, JSON.stringify(record)]);
    }
    await connection.commit();
    const seenAt = Date.now();
    await pool.execute("UPDATE devices SET last_seen_at = ? WHERE id = ?", [seenAt, request.deviceId!]);
    await pool.execute("UPDATE settlement_devices SET lastSeenAt = ?, lastSyncAt = ?, updatedAt = ? WHERE id = ?", [seenAt, seenAt, seenAt, request.deviceId!]);
    response.json({ ok: true, accepted: parsed.data.events.map((event) => event.id) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get("/v1/admin/devices", requireAdmin, async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.query("SELECT sd.id, sd.deviceFingerprint, sd.deviceName, sd.staffId, sd.status, sd.lastSyncAt, sd.lastSeenAt, sd.createdAt, sd.updatedAt, d.name AS legacyName FROM settlement_devices sd LEFT JOIN devices d ON d.id = sd.id ORDER BY sd.updatedAt DESC");
    response.json({ devices: rows });
  } catch (error) { next(error); }
});

app.post("/v1/admin/devices/:deviceId/disconnect", requireAdmin, async (request: Request, response: Response, next: NextFunction) => {
  const parsed = z.object({ reason: z.string().min(1).max(500).default("관리자 화면에서 연결 해제") }).safeParse(request.body);
  const deviceId = request.params.deviceId;
  if (!parsed.success) return response.status(400).json({ code: "INVALID_DISCONNECT_REQUEST", message: "연결 해제 사유 형식이 올바르지 않습니다." });
  const connection = await pool.getConnection();
  try {
    const now = Date.now(); await connection.beginTransaction();
    const [rows] = await connection.query<Array<{ status: string }>>("SELECT status FROM settlement_devices WHERE id=? LIMIT 1 FOR UPDATE", [deviceId]);
    const device = rows[0];
    if (!device) { await connection.rollback(); return response.status(404).json({ code: "DEVICE_NOT_FOUND", message: "등록된 기기를 찾지 못했습니다." }); }
    if (device.status === "revoked") { await connection.rollback(); return response.json({ ...tokenOnlyDisconnectResult(deviceId), alreadyRevoked: true }); }
    await connection.execute("UPDATE settlement_devices SET status='revoked', updatedAt=? WHERE id=?", [now, deviceId]);
    await connection.execute("DELETE FROM devices WHERE id=?", [deviceId]);
    await connection.execute("INSERT INTO settlement_audit_logs (actorId, action, entityType, entityId, detailJson, createdAt) VALUES (?, ?, ?, ?, ?, ?)", ["admin-console", "device_token_revoked", "device", deviceId, JSON.stringify({ reason: parsed.data.reason, settlementDataPreserved: true }), now]);
    await connection.commit(); response.json(tokenOnlyDisconnectResult(deviceId));
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.post("/v1/admin/devices/:deviceId/delete-registration", requireAdmin, async (request: Request, response: Response, next: NextFunction) => {
  const parsed = z.object({ reason: z.string().min(1).max(500).default("관리자 화면에서 등록 삭제") }).safeParse(request.body);
  const deviceId = request.params.deviceId;
  if (!parsed.success) return response.status(400).json({ code: "INVALID_DELETE_REQUEST", message: "등록 삭제 사유 형식이 올바르지 않습니다." });
  const connection = await pool.getConnection();
  try {
    const now = Date.now(); await connection.beginTransaction();
    const [rows] = await connection.query<Array<{ id: string }>>("SELECT id FROM settlement_devices WHERE id=? LIMIT 1 FOR UPDATE", [deviceId]);
    if (!rows[0]) { await connection.rollback(); return response.status(404).json({ code: "DEVICE_NOT_FOUND", message: "등록된 기기를 찾지 못했습니다." }); }
    // 정산·제출·승인·반려·증빙 이력은 절대 삭제하지 않고 기기 등록 두 테이블만 삭제한다.
    await connection.execute("DELETE FROM devices WHERE id=?", [deviceId]);
    await connection.execute("DELETE FROM settlement_devices WHERE id=?", [deviceId]);
    await connection.execute("INSERT INTO settlement_audit_logs (actorId, action, entityType, entityId, detailJson, createdAt) VALUES (?, ?, ?, ?, ?, ?)", ["admin-console", "device_registration_deleted", "device", deviceId, JSON.stringify({ reason: parsed.data.reason, settlementDataPreserved: true }), now]);
    await connection.commit(); response.json({ ok: true, deviceId, registrationDeleted: true, settlementDataPreserved: true });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
app.get("/v1/admin/device-actions", requireAdmin, async (_request: Request, response: Response, next: NextFunction) => {
  try { const [rows] = await pool.query("SELECT * FROM settlement_device_action_approvals ORDER BY createdAt DESC LIMIT 200"); response.json({ actions: rows }); } catch (error) { next(error); }
});

app.post("/v1/admin/device-actions", requireAdmin, async (request: Request, response: Response, next: NextFunction) => {
  const parsed = z.object({ deviceIds: z.array(z.string().min(1).max(96)).min(1).max(50), action: z.enum(["reset", "revoke", "cleanup"]), reason: z.string().min(1).max(500) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "기기 작업 요청 형식이 올바르지 않습니다." });
  try {
    const now = Date.now(); const ids: number[] = [];
    for (const deviceId of parsed.data.deviceIds) { const [rows] = await pool.query<Array<{ id: number }>>("INSERT INTO settlement_device_action_approvals (deviceId, action, status, requestedBy, reason, createdAt) VALUES (?, ?, 'requested', 'admin-console', ?, ?) RETURNING id", [deviceId, parsed.data.action, parsed.data.reason, now]); if (!rows[0]) throw new Error("기기 작업 요청 ID를 생성하지 못했습니다."); ids.push(rows[0].id); }
    response.status(201).json({ ok: true, actionIds: ids });
  } catch (error) { next(error); }
});

app.post("/v1/admin/device-actions/:id/approve", requireAdmin, async (request: Request, response: Response, next: NextFunction) => {
  try { const [rows] = await pool.query<Array<{ id: number }>>("UPDATE settlement_device_action_approvals SET status='approved', approvedBy='admin-console', approvedAt=? WHERE id=? AND status='requested' RETURNING id", [Date.now(), request.params.id]); if (!rows[0]) return response.status(409).json({ message: "승인할 수 없는 작업 상태입니다." }); response.json({ ok: true }); } catch (error) { next(error); }
});

app.post("/v1/admin/device-actions/:id/execute", requireAdmin, async (request: Request, response: Response, next: NextFunction) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query<Array<{ deviceId: string; action: string }>>("SELECT deviceId, action FROM settlement_device_action_approvals WHERE id=? AND status='approved' LIMIT 1", [request.params.id]);
    const action = rows[0]; if (!action) return response.status(409).json({ message: "승인 완료된 작업만 실행할 수 있습니다." });
    await connection.beginTransaction();
    if (action.action === "revoke" || action.action === "cleanup") { await connection.execute("UPDATE settlement_devices SET status='revoked', updatedAt=? WHERE id=?", [Date.now(), action.deviceId]); await connection.execute("DELETE FROM devices WHERE id=?", [action.deviceId]); }
    else await connection.execute("UPDATE settlement_devices SET status='reset_pending', lastSyncAt=NULL, updatedAt=? WHERE id=?", [Date.now(), action.deviceId]);
    await connection.execute("UPDATE settlement_device_action_approvals SET status='executed', executedAt=? WHERE id=?", [Date.now(), request.params.id]);
    await connection.commit(); response.json({ ok: true, deviceId: action.deviceId, action: action.action });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.post("/v1/test-reset", requireDevice, async (request: Request, response: Response, next: NextFunction) => {
  const parsed = z.object({ confirm: z.literal("RESET_TEST_WORKSPACE") }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "테스트 초기화 확인값이 올바르지 않습니다." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [eventRows] = await connection.query<Array<{ id: string }>>("DELETE FROM settlement_events RETURNING id");
    const [settlementRows] = await connection.query<Array<{ id: string }>>("DELETE FROM settlements RETURNING id");
    await connection.execute("DELETE FROM devices");
    await connection.commit();
    response.json({ ok: true, deletedEvents: eventRows.length, deletedSettlements: settlementRows.length });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get("/v1/sync/changes", requireDevice, async (_request: Request, response: Response, next: NextFunction) => {
  try {
    // 먼저 updated_at 인덱스로 ID 500개만 결정한 뒤 payload를 가져온다.
    // 대용량 JSON을 정렬 버퍼에 올리지 않아 Aiven의 sort-memory 오류를 피한다.
    const [rows] = await pool.query<({ payload_json: unknown })[]>(
      "SELECT s.payload_json FROM settlements s JOIN (SELECT id, updated_at FROM settlements ORDER BY updated_at DESC LIMIT 500) latest ON latest.id = s.id ORDER BY latest.updated_at DESC"
    );
    response.json({ settlements: rows.map((row) => typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json) });
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 500;
  if (status === 413) return response.status(413).json({ code: "REQUEST_TOO_LARGE", message: "전송 데이터가 너무 큽니다. 증빙사진은 최대 8장으로 줄여 다시 시도해 주세요." });
  response.status(500).json({ message: "서버 처리 중 오류가 발생했습니다." });
});
process.on("unhandledRejection", (error) => process.stderr.write(`unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`));
process.on("uncaughtException", (error) => process.stderr.write(`uncaught exception: ${error.stack ?? error.message}\n`));
app.listen(port, () => {
  console.log(`lottery sync API started on port ${port} · maxDevices=${maxDevices} · dbConnections=${dbConnectionLimit}`);
  void initializeDatabaseWithRetry().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`lottery sync API database initialization failed; service remains available for health/static diagnostics: ${message}\n`);
  });
});

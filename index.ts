import "dotenv/config";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { z } from "zod";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
  return value;
};

const databaseUrl = required("DATABASE_URL");
const pairCode = required("PAIR_CODE_V2");
const tokenSecret = required("TOKEN_SECRET");
if (pairCode.length < 12) throw new Error("PAIR_CODE는 12자 이상이어야 합니다.");
if (tokenSecret.length < 32) throw new Error("TOKEN_SECRET은 32자 이상이어야 합니다.");

const port = Number(process.env.PORT ?? 3000);
const maxDevices = Math.max(1, Number(process.env.MAX_DEVICES ?? 5));
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const connectionUrl = new URL(databaseUrl);
connectionUrl.searchParams.delete("ssl-mode");
const databaseCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
const databaseTls = databaseCa ? { ca: databaseCa, rejectUnauthorized: true, servername: connectionUrl.hostname } : { rejectUnauthorized: false, servername: connectionUrl.hostname };
if (!databaseCa) console.warn("DATABASE_CA_CERT가 없어 Aiven TLS 암호화 연결을 CA 검증 없이 사용합니다.");
const pool = mysql.createPool({ uri: connectionUrl.toString(), ssl: databaseTls, waitForConnections: true, connectionLimit: 5 });

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
    author_role ENUM('admin','employee') NOT NULL,
    settlement_status VARCHAR(40) NOT NULL,
    updated_at BIGINT NOT NULL,
    payload_json JSON NOT NULL,
    INDEX idx_settlements_date (business_date),
    INDEX idx_settlements_updated (updated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS settlement_events (
    id VARCHAR(96) PRIMARY KEY,
    settlement_id VARCHAR(96) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    created_at BIGINT NOT NULL,
    payload_json JSON NOT NULL,
    INDEX idx_events_settlement (settlement_id)
  )`,
];

const initializeDatabase = async () => {
  for (const statement of schemaStatements) await pool.query(statement);
  console.log("lottery sync API database schema ready");
};

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

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
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

const requireDevice = (request: Request, response: Response, next: NextFunction) => {
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? decodeToken(token) : null;
  if (!payload) return response.status(401).json({ message: "유효한 기기 토큰이 필요합니다." });
  request.deviceId = payload.deviceId;
  next();
};

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

app.get("/health", async (_request: Request, response: Response, next: NextFunction) => {
  try { await pool.query("SELECT 1"); response.json({ ok: true }); } catch (error) { next(error); }
});

app.post("/v1/pair", async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!permitPairing(request)) return response.status(429).json({ message: "연결 코드 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." });
    const parsed = z.object({ pairCode: z.string().min(12).max(200), deviceName: z.string().min(1).max(120) }).safeParse(request.body);
    const submittedCode = parsed.success ? Buffer.from(parsed.data.pairCode) : Buffer.alloc(0);
    const deviceName = parsed.success ? parsed.data.deviceName.trim() : "";
    const expectedCode = Buffer.from(pairCode);
    const codeMatches = submittedCode.length === expectedCode.length && crypto.timingSafeEqual(submittedCode, expectedCode);
    if (!codeMatches) return response.status(401).json({ message: "연결 코드가 올바르지 않습니다." });
    const [countRows] = await pool.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) AS count FROM devices");
    if ((countRows[0]?.count ?? 0) >= maxDevices) return response.status(409).json({ message: `등록 가능 기기 수(${maxDevices})에 도달했습니다.` });
    const deviceId = `device-${crypto.randomUUID()}`;
    const now = Date.now();
    await pool.execute("INSERT INTO devices (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)", [deviceId, deviceName, now, now]);
    response.status(201).json({ deviceId, token: encodeToken({ deviceId, expiresAt: now + 1000 * 60 * 60 * 24 * 180 }) });
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
      await connection.execute("INSERT INTO settlement_events (id, settlement_id, device_id, event_type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE id = id", [event.id, record.id, request.deviceId!, event.eventType, event.createdAt, JSON.stringify(record)]);
      await connection.execute("INSERT INTO settlements (id, business_date, author_id, author_name, author_role, settlement_status, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE business_date = IF(VALUES(updated_at) >= updated_at, VALUES(business_date), business_date), author_id = IF(VALUES(updated_at) >= updated_at, VALUES(author_id), author_id), author_name = IF(VALUES(updated_at) >= updated_at, VALUES(author_name), author_name), author_role = IF(VALUES(updated_at) >= updated_at, VALUES(author_role), author_role), settlement_status = IF(VALUES(updated_at) >= updated_at, VALUES(settlement_status), settlement_status), payload_json = IF(VALUES(updated_at) >= updated_at, VALUES(payload_json), payload_json), updated_at = GREATEST(updated_at, VALUES(updated_at))", [record.id, record.businessDate, record.createdBy.id, record.createdBy.name, record.createdBy.role, record.status, record.updatedAt, JSON.stringify(record)]);
    }
    await connection.commit();
    await pool.execute("UPDATE devices SET last_seen_at = ? WHERE id = ?", [Date.now(), request.deviceId!]);
    response.json({ ok: true, accepted: parsed.data.events.map((event) => event.id) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get("/v1/sync/changes", requireDevice, async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.query<(RowDataPacket & { payload_json: unknown })[]>("SELECT payload_json FROM settlements ORDER BY updated_at DESC LIMIT 500");
    response.json({ settlements: rows.map((row) => typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json) });
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(500).json({ message: "서버 처리 중 오류가 발생했습니다." });
});
process.on("unhandledRejection", (error) => process.stderr.write(`unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`));
process.on("uncaughtException", (error) => process.stderr.write(`uncaught exception: ${error.stack ?? error.message}\n`));
void initializeDatabase()
  .then(() => app.listen(port, () => console.log(`lottery sync API started on port ${port}`)))
  .catch(async (error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`lottery sync API database initialization failed: ${message}\n`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

import type { PgCompatPool } from "./pg-compat.js";

type MainSyncOptions = {
  enabled: boolean;
  pushEnabled: boolean;
  baseUrl: string;
  pairCode: string;
  deviceName: string;
  deviceFingerprint: string;
  staffId?: string;
};

type MainSyncState = { token: string; deviceId: string };

const state: MainSyncState = { token: "", deviceId: "" };

const jsonFetch = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) throw new Error(`Main sync ${response.status}: ${body?.message ?? response.statusText}`);
  return body;
};

export const createMainSync = (options: MainSyncOptions, pool: PgCompatPool) => {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const enabled = options.enabled && Boolean(baseUrl && options.pairCode);
  let running: Promise<void> | null = null;

  const pair = async () => {
    if (!enabled) return;
    const result = await jsonFetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      body: JSON.stringify({ pairCode: options.pairCode, deviceName: options.deviceName, deviceFingerprint: options.deviceFingerprint, staffId: options.staffId }),
    });
    state.token = String(result.token ?? "");
    state.deviceId = String(result.deviceId ?? "");
    if (!state.token || !state.deviceId) throw new Error("Main sync pairing response is incomplete");
  };

  const authorized = async (path: string, init: RequestInit = {}) => {
    if (!state.token) await pair();
    try {
      return await jsonFetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${state.token}` } });
    } catch (error: any) {
      if (error?.message?.startsWith("Main sync 401")) {
        state.token = "";
        await pair();
        return jsonFetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${state.token}` } });
      }
      throw error;
    }
  };

  const sync = async () => {
    if (!enabled || running) return running;
    running = (async () => {
      const [outbox] = options.pushEnabled ? await pool.query<Array<{ id: string; event_id: string; settlement_id: string; event_type: string }>>(
        "SELECT id,event_id,settlement_id,event_type FROM main_sync_outbox WHERE synced_at IS NULL ORDER BY created_at ASC LIMIT 100"
      ) : [[]];
      if (outbox.length) {
        const events: any[] = [];
        for (const item of outbox) {
          const [rows] = await pool.query<Array<Record<string, any>>>("SELECT id,business_date,author_id,author_name,author_role,settlement_status,updated_at,payload_json FROM settlements WHERE id=? LIMIT 1", [item.settlement_id]);
          const row = rows[0];
          if (!row) continue;
          const payload = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json;
          events.push({ id: item.event_id, eventType: item.event_type, createdAt: Number(row.updated_at), payload: { ...payload, id: row.id, businessDate: String(row.business_date), createdBy: { id: row.author_id, name: row.author_name, role: row.author_role }, status: row.settlement_status, updatedAt: Number(row.updated_at) } });
        }
        if (events.length) {
          await authorized("/v1/sync/events", { method: "POST", body: JSON.stringify({ events }) });
          await pool.execute("UPDATE main_sync_outbox SET synced_at=? WHERE event_id = ANY(?)", [Date.now(), events.map((event) => event.id)]);
        }
      }
      const changes = await authorized("/v1/sync/changes");
      for (const incoming of Array.isArray(changes?.settlements) ? changes.settlements : []) {
        if (!incoming || typeof incoming !== "object" || typeof incoming.id !== "string") continue;
        const payload = incoming;
        const id = String(payload.id);
        const businessDate = String(payload.businessDate ?? "");
        const createdBy = payload.createdBy ?? { id: "main-sync", name: "Main", role: "employee" };
        const updatedAt = Number(payload.updatedAt ?? 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !Number.isFinite(updatedAt) || updatedAt <= 0) continue;
        await pool.execute(
          "INSERT INTO settlements (id,business_date,author_id,author_name,author_role,settlement_status,updated_at,payload_json) VALUES (?,?,?,?,?,?,?,?::jsonb) ON CONFLICT (id) DO UPDATE SET business_date=EXCLUDED.business_date,author_id=EXCLUDED.author_id,author_name=EXCLUDED.author_name,author_role=EXCLUDED.author_role,settlement_status=EXCLUDED.settlement_status,updated_at=EXCLUDED.updated_at,payload_json=EXCLUDED.payload_json WHERE EXCLUDED.updated_at >= settlements.updated_at",
          [id, businessDate, String(createdBy.id), String(createdBy.name), String(createdBy.role), String(payload.status ?? "draft"), updatedAt, JSON.stringify(payload)]
        );
      }
    })().catch((error) => { console.warn("[MAIN_SYNC_FAILED]", error instanceof Error ? error.message : String(error)); }).finally(() => { running = null; });
    return running;
  };

  if (enabled) void sync();
  return { enabled, sync, pair };
};

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type mysql from "mysql2/promise";

export const staffChangeInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).nullable().optional(),
  role: z.enum(["admin", "employee"]),
  status: z.enum(["active", "deleted"]),
  version: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  deletedAt: z.number().int().positive().nullable().optional(),
});

export function registerStaffSyncRoutes(app: { get: Function; post: Function }, pool: mysql.Pool, requireDevice: (request: Request, response: Response, next: NextFunction) => void) {
  app.get("/v1/staff/changes", requireDevice, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const cursor = Math.max(0, Number(request.query.cursor ?? 0));
      const [rows] = await pool.query(`SELECT id, staffId, changeType, version, payloadJson, changedAt FROM settlement_staff_change_log WHERE id > ? ORDER BY id ASC LIMIT 500`, [cursor]);
      const changes = (rows as Array<Record<string, unknown>>).map((row) => ({
        cursor: Number(row.id), id: row.staffId, changeType: row.changeType, version: Number(row.version), changedAt: Number(row.changedAt), payload: typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson,
      }));
      response.json({ cursor: changes.length ? changes[changes.length - 1].cursor : cursor, changes });
    } catch (error) { next(error); }
  });

  app.post("/v1/staff/changes", requireDevice, async (request: Request, response: Response, next: NextFunction) => {
    const parsed = z.object({ changes: z.array(z.object({ changeType: z.enum(["created", "updated", "deleted"]), payload: staffChangeInput })).min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ message: "직원 변경 데이터 형식이 올바르지 않습니다." });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const change of parsed.data.changes) {
        const record = change.payload;
        const [currentRows] = await connection.query(`SELECT version FROM settlement_staff WHERE id = ? LIMIT 1`, [record.id]);
        const current = (currentRows as Array<{ version: number }>)[0];
        if (current && Number(current.version) >= record.version) continue;
        await connection.execute(`INSERT INTO settlement_staff (id,name,phone,role,status,version,createdAt,updatedAt,deletedAt) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),phone=VALUES(phone),role=VALUES(role),status=VALUES(status),version=VALUES(version),updatedAt=VALUES(updatedAt),deletedAt=VALUES(deletedAt)`, [record.id, record.name, record.phone ?? null, record.role, record.status, record.version, record.updatedAt, record.updatedAt, record.deletedAt ?? null]);
        await connection.execute(`INSERT INTO settlement_staff_change_log (staffId,changeType,version,payloadJson,changedAt) VALUES (?,?,?,?,?)`, [record.id, change.changeType, record.version, JSON.stringify(record), record.updatedAt]);
      }
      await connection.commit(); response.json({ ok: true, accepted: parsed.data.changes.map((change) => change.payload.id) });
    } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
  });
}

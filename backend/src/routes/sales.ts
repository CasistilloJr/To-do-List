import { Router } from "express";
import type { ErrorRequestHandler } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../database/connection.js";

export const salesRouter = Router();

const ZONE = "America/Mexico_City";

class SalesError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Todas las funciones de este módulo son administrativas.
salesRouter.use((_req, res, next) => {
  if (res.locals.user.role !== "ADMIN") {
    res.status(403).json({
      message: "Acceso exclusivo del administrador.",
    });
    return;
  }

  next();
});

const paymentSchema = z.object({
  appointment_id: z.number().int().positive().safe(),
  amount_cents: z.number().int().min(1).max(99999999),
  method: z.enum(["CASH", "CARD", "TRANSFER"]),
  reference: z.string().trim().max(120),
}).strict();

const datesSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

// MASCOTAS LISTAS Y SIN VENTA REGISTRADA
salesRouter.get("/ready", (_req, res) => {
  const appointments = db.prepare(`
    SELECT
      a.id,
      a.starts_at,
      p.name AS pet_name,
      u.name AS owner_name,

      (
        SELECT COALESCE(SUM(s.price_cents), 0)
        FROM appointment_services s
        WHERE s.appointment_id = a.id
      ) AS price_min_cents,

      (
        SELECT COALESCE(
          SUM(COALESCE(s.price_max_cents, s.price_cents)),
          0
        )
        FROM appointment_services s
        WHERE s.appointment_id = a.id
      ) AS price_max_cents

    FROM appointments a
    JOIN pets p ON p.id = a.pet_id
    JOIN users u ON u.id = p.owner_id

    WHERE a.status = 'IN_PROGRESS'
      AND (
        SELECT e.status
        FROM status_events e
        WHERE e.appointment_id = a.id
        ORDER BY e.id DESC
        LIMIT 1
      ) = 'READY'
      AND NOT EXISTS (
        SELECT 1
        FROM sales sale
        WHERE sale.appointment_id = a.id
      )

    ORDER BY a.starts_at, a.id
  `).all();

  res.json({ appointments });
});

// REGISTRAR UN SOLO COBRO TOTAL
salesRouter.post("/", (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new SalesError(
      400,
      "Revisa la cita, el importe y el método de pago."
    );
  }

  const data = parsed.data;
  const adminId = res.locals.user.id;

  const saleId = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id
      FROM sales
      WHERE appointment_id = ?
    `).get(data.appointment_id);

    if (existing) {
      throw new SalesError(
        409,
        "Esta cita ya tiene una venta registrada. Actualiza el historial."
      );
    }

    const appointment = db.prepare(`
      SELECT
        a.status,
        (
          SELECT e.status
          FROM status_events e
          WHERE e.appointment_id = a.id
          ORDER BY e.id DESC
          LIMIT 1
        ) AS stage
      FROM appointments a
      WHERE a.id = ?
    `).get(data.appointment_id) as
      | { status: string; stage: string | null }
      | undefined;

    if (!appointment) {
      throw new SalesError(404, "Cita no encontrada.");
    }

    if (
      appointment.status !== "IN_PROGRESS" ||
      appointment.stage !== "READY"
    ) {
      throw new SalesError(
        409,
        "La mascota debe estar lista para recoger antes de registrar el cobro."
      );
    }

    const createdAt = new Date().toISOString();

    const insertion = db.prepare(`
      INSERT INTO sales (
        appointment_id,
        total_cents,
        status,
        created_by,
        created_at
      )
      VALUES (?, ?, 'CLOSED', ?, ?)
    `).run(
      data.appointment_id,
      data.amount_cents,
      adminId,
      createdAt
    );

    const id = Number(insertion.lastInsertRowid);

    db.prepare(`
      INSERT INTO payments (
        sale_id,
        amount_cents,
        kind,
        method,
        reference,
        recorded_by,
        created_at
      )
      VALUES (?, ?, 'PAYMENT', ?, ?, ?, ?)
    `).run(
      id,
      data.amount_cents,
      data.method,
      data.reference || null,
      adminId,
      createdAt
    );

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, 'REGISTER_PAYMENT', 'sale', ?, ?)
    `).run(
      adminId,
      id,
      JSON.stringify({
        appointment_id: data.appointment_id,
        amount_cents: data.amount_cents,
        method: data.method,
      })
    );

    return id;
  }).immediate();

  res.status(201).json({
    sale_id: saleId,
    message:
      "Cobro registrado. Ahora puedes marcar la mascota como entregada.",
  });
});

// HISTORIAL Y TOTALES POR FECHA DE COBRO
salesRouter.get("/history", (req, res) => {
  const parsed = datesSchema.safeParse(req.query);

  if (!parsed.success) {
    throw new SalesError(400, "Selecciona fechas válidas.");
  }

  const from = DateTime.fromISO(parsed.data.from, {
    zone: ZONE,
  }).startOf("day");

  const to = DateTime.fromISO(parsed.data.to, {
    zone: ZONE,
  }).startOf("day");

  const days = to.diff(from, "days").days;

  if (
    !from.isValid ||
    !to.isValid ||
    days < 0 ||
    days > 365
  ) {
    throw new SalesError(
      400,
      "Selecciona un periodo válido de hasta 366 días."
    );
  }

  const start = from.toUTC().toISO()!;
  const end = to.plus({ days: 1 }).toUTC().toISO()!;

  const history = db.prepare(`
    SELECT
      s.id AS sale_id,
      s.appointment_id,
      pay.amount_cents,
      pay.method,
      pay.reference,
      pay.created_at,
      p.name AS pet_name,
      u.name AS owner_name,
      administrator.name AS recorded_by_name

    FROM payments pay
    JOIN sales s ON s.id = pay.sale_id
    JOIN appointments a ON a.id = s.appointment_id
    JOIN pets p ON p.id = a.pet_id
    JOIN users u ON u.id = p.owner_id
    JOIN users administrator ON administrator.id = pay.recorded_by

    WHERE pay.kind = 'PAYMENT'
      AND s.status = 'CLOSED'
      AND pay.created_at >= ?
      AND pay.created_at < ?

    ORDER BY pay.created_at DESC, pay.id DESC
    LIMIT 200
  `).all(start, end);

  // Los totales incluyen todo el periodo,
  // aunque el listado esté limitado a 200 movimientos.
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS payments_count,
      COALESCE(SUM(pay.amount_cents), 0) AS total_cents
    FROM payments pay
    JOIN sales s ON s.id = pay.sale_id
    WHERE pay.kind = 'PAYMENT'
      AND s.status = 'CLOSED'
      AND pay.created_at >= ?
      AND pay.created_at < ?
  `).get(start, end);

  const byMethod = db.prepare(`
    SELECT
      pay.method,
      COALESCE(SUM(pay.amount_cents), 0) AS total_cents
    FROM payments pay
    JOIN sales s ON s.id = pay.sale_id
    WHERE pay.kind = 'PAYMENT'
      AND s.status = 'CLOSED'
      AND pay.created_at >= ?
      AND pay.created_at < ?
    GROUP BY pay.method
  `).all(start, end);

  res.json({
    history,
    totals,
    by_method: byMethod,
  });
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next
) => {
  if (error instanceof SalesError) {
    res.status(error.status).json({
      message: error.message,
    });
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    res.status(409).json({
      message: "Esta cita ya tiene una venta registrada.",
    });
    return;
  }

  next(error);
};

salesRouter.use(errorHandler);
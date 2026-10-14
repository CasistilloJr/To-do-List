import { Router } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../database/connection.js";

export const metricsRouter = Router();

const ZONE = "America/Mexico_City";

const querySchema = z.object({
  period: z.enum(["today", "week", "month", "custom"]).default("today"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict();

type MethodRow = {
  method: string;
  count: number;
  total_cents: number;
};

type StatusRow = {
  status: string;
  count: number;
};

type ServiceRow = {
  id: number;
  name: string;
  requests: number;
};

// Protección adicional: este módulo es exclusivo del administrador.
metricsRouter.use((_req, res, next) => {
  if (res.locals.user?.role !== "ADMIN") {
    res.status(403).json({
      message: "Acceso exclusivo del administrador.",
    });
    return;
  }

  next();
});

metricsRouter.get("/", (req, res) => {
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      message: "Selecciona un periodo y fechas válidas.",
    });
    return;
  }

  const query = parsed.data;
  const today = DateTime.now().setZone(ZONE).startOf("day");

  let from = today;
  let to = today;

  if (query.period === "week") {
    // Semana desde el lunes hasta hoy.
    from = today.minus({ days: today.weekday - 1 });
  }

  if (query.period === "month") {
    // Mes desde el día 1 hasta hoy.
    from = today.startOf("month");
  }

  if (query.period === "custom") {
    if (!query.from || !query.to) {
      res.status(400).json({
        message: "Selecciona la fecha inicial y la final.",
      });
      return;
    }

    from = DateTime.fromISO(query.from, {
      zone: ZONE,
    }).startOf("day");

    to = DateTime.fromISO(query.to, {
      zone: ZONE,
    }).startOf("day");
  }

  const days = to.diff(from, "days").days;

  if (
    !from.isValid ||
    !to.isValid ||
    days < 0 ||
    days > 365
  ) {
    res.status(400).json({
      message: "Selecciona un periodo válido de hasta 366 días.",
    });
    return;
  }

  // Incluye todo el último día, hasta antes del día siguiente.
  const start = from.toUTC().toISO()!;
  const end = to.plus({ days: 1 }).toUTC().toISO()!;

  const result = db.transaction(() => {
    // Mismo criterio que /api/sales/history.
    // No se unen los servicios aquí para evitar multiplicar los pagos.
    const byMethod = db.prepare(`
      SELECT
        pay.method,
        COUNT(*) AS count,
        COALESCE(SUM(pay.amount_cents), 0) AS total_cents
      FROM payments pay
      JOIN sales s ON s.id = pay.sale_id
      WHERE pay.kind = 'PAYMENT'
        AND s.status = 'CLOSED'
        AND pay.created_at >= ?
        AND pay.created_at < ?
      GROUP BY pay.method
    `).all(start, end) as MethodRow[];

    const totalCents = byMethod.reduce(
      (sum, row) => sum + row.total_cents,
      0
    );

    const paymentsCount = byMethod.reduce(
      (sum, row) => sum + row.count,
      0
    );

    // No consultamos appointment_history_hidden:
    // ocultar una cita no debe cambiar las métricas.
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM appointments
      WHERE starts_at >= ?
        AND starts_at < ?
      GROUP BY status
    `).all(start, end) as StatusRow[];

    const appointmentsCount = byStatus.reduce(
      (sum, row) => sum + row.count,
      0
    );

    // Cada servicio cuenta como máximo una vez por cita.
    // Se agrupa por ID para no dividir un servicio al cambiar su nombre.
    const topServices = db.prepare(`
      SELECT
        s.id,
        s.name,
        COUNT(DISTINCT a.id) AS requests
      FROM appointment_services item
      JOIN appointments a ON a.id = item.appointment_id
      JOIN services s ON s.id = item.service_id
      WHERE a.starts_at >= ?
        AND a.starts_at < ?
        AND a.status IN (
          'PENDING',
          'CONFIRMED',
          'IN_PROGRESS',
          'COMPLETED'
        )
      GROUP BY s.id, s.name
      ORDER BY requests DESC, s.name COLLATE NOCASE, s.id
      LIMIT 10
    `).all(start, end) as ServiceRow[];

    return {
      totals: {
        total_cents: totalCents,
        payments_count: paymentsCount,
        appointments_count: appointmentsCount,
      },
      by_method: byMethod,
      by_status: byStatus,
      top_services: topServices,
    };
  })();

  res.json({
    period: {
      from: from.toISODate(),
      to: to.toISODate(),
      timezone: ZONE,
    },
    ...result,
  });
});
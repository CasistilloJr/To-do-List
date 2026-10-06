import { Router } from "express";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import { db } from "../database/connection.js";

export const trackingRouter = Router();

type Stage =
  | "RECEIVED"
  | "CUTTING"
  | "BATHING"
  | "DRYING"
  | "DETAILING"
  | "READY"
  | "DELIVERED"
  | "GROOMING";

type Appointment = {
  id: number;
  status: string;
  owner_id: number;
};

type TrackingEvent = {
  id: number;
  status: Stage;
  customer_note: string | null;
  created_at: string;
};

class TrackingError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const idSchema = z.coerce.number().int().positive().safe();

const updateSchema = z.object({
  status: z.enum([
    "RECEIVED",
    "CUTTING",
    "BATHING",
    "DRYING",
    "DETAILING",
    "READY",
    "DELIVERED",
  ]),
  customer_note: z.string().trim().max(1000),
  expected_event_id: z.number().int().positive().nullable(),
}).strict();

// Orden del proceso.
const transitions: Record<Stage, Stage[]> = {
  RECEIVED: ["CUTTING"],
  CUTTING: ["BATHING"],
  BATHING: ["DRYING"],
  DRYING: ["DETAILING"],
  DETAILING: ["READY"],
  READY: ["DELIVERED"],
  DELIVERED: [],

  // Solo para conservar posibles registros antiguos.
  GROOMING: ["DETAILING"],
};

const activeStages: Stage[] = [
  "CUTTING",
  "BATHING",
  "DRYING",
  "DETAILING",
  "GROOMING",
];

function findAppointment(id: number) {
  return db.prepare(`
    SELECT a.id, a.status, p.owner_id
    FROM appointments a
    JOIN pets p ON p.id = a.pet_id
    WHERE a.id = ?
  `).get(id) as Appointment | undefined;
}

function getEvents(appointmentId: number) {
  return db.prepare(`
    SELECT id, status, customer_note, created_at
    FROM status_events
    WHERE appointment_id = ?
    ORDER BY id ASC
  `).all(appointmentId) as TrackingEvent[];
}

function allowedStages(
  appointment: Appointment,
  events: TrackingEvent[]
): Stage[] {
  if (
    appointment.status === "CONFIRMED" &&
    events.length === 0
  ) {
    return ["RECEIVED"];
  }

  if (appointment.status !== "IN_PROGRESS") {
    return [];
  }

  const latest = events[events.length - 1];

  return latest ? transitions[latest.status] : [];
}

function getPayload(
  appointment: Appointment,
  isAdmin: boolean
) {
  const events = getEvents(appointment.id);
  const latest = events[events.length - 1];

  return {
    appointment_status: appointment.status,
    current_status: latest?.status ?? null,
    last_event_id: latest?.id ?? null,
    events,
    allowed_statuses: isAdmin
      ? allowedStages(appointment, events)
      : [],
  };
}

// CONSULTAR EL SEGUIMIENTO
trackingRouter.get("/:id", (req, res) => {
  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    throw new TrackingError(400, "Identificador inválido.");
  }

  const user = res.locals.user;
  const appointment = findAppointment(parsedId.data);

  if (
    !appointment ||
    (
      user.role !== "ADMIN" &&
      appointment.owner_id !== user.id
    )
  ) {
    throw new TrackingError(404, "Cita no encontrada.");
  }

  res.json(
    getPayload(appointment, user.role === "ADMIN")
  );
});

// ACTUALIZAR EL SEGUIMIENTO
trackingRouter.post("/:id", (req, res) => {
  const user = res.locals.user;

  if (user.role !== "ADMIN") {
    throw new TrackingError(
      403,
      "Solo el administrador puede actualizar el seguimiento."
    );
  }

  const parsedId = idSchema.safeParse(req.params.id);
  const parsedBody = updateSchema.safeParse(req.body);

  if (!parsedId.success || !parsedBody.success) {
    throw new TrackingError(
      400,
      "Revisa el estado y la nota."
    );
  }

  const id = parsedId.data;
  const data = parsedBody.data;

  const result = db.transaction(() => {
    const appointment = findAppointment(id);

    if (!appointment) {
      throw new TrackingError(404, "Cita no encontrada.");
    }

    const events = getEvents(id);
    const latest = events[events.length - 1];

    if (
      (latest?.id ?? null) !== data.expected_event_id
    ) {
      throw new TrackingError(
        409,
        "El seguimiento cambió. Actualízalo antes de guardar."
      );
    }

    const allowed = allowedStages(appointment, events);

    if (!allowed.includes(data.status)) {
      throw new TrackingError(
        409,
        "Ese cambio no corresponde al siguiente paso."
      );
    }
    // Antes de entregar, exige que el total esté pagado.
if (data.status === "DELIVERED") {
  const paidSale = db.prepare(`
    SELECT s.id
    FROM sales s
    WHERE s.appointment_id = ?
      AND s.status = 'CLOSED'
      AND s.total_cents > 0
      AND s.total_cents = (
        SELECT COALESCE(
          SUM(
            CASE
              WHEN p.kind = 'PAYMENT' THEN p.amount_cents
              ELSE -p.amount_cents
            END
          ),
          0
        )
        FROM payments p
        WHERE p.sale_id = s.id
      )
  `).get(id);

  if (!paidSale) {
    throw new TrackingError(
      409,
      "Primero registra el cobro total en Ventas y cobros."
    );
  }
}

    // Solo una mascota puede estar siendo atendida.
    if (activeStages.includes(data.status)) {
      const occupied = db.prepare(`
        SELECT a.id
        FROM appointments a
        WHERE a.id <> ?
          AND a.status = 'IN_PROGRESS'
          AND (
            SELECT e.status
            FROM status_events e
            WHERE e.appointment_id = a.id
            ORDER BY e.id DESC
            LIMIT 1
          ) IN (
            'CUTTING',
            'BATHING',
            'DRYING',
            'DETAILING',
            'GROOMING'
          )
        LIMIT 1
      `).get(id);

      if (occupied) {
        throw new TrackingError(
          409,
          "Ya hay otra mascota en atención. Termina su servicio antes de comenzar con esta."
        );
      }
    }

    db.prepare(`
      INSERT INTO status_events (
        appointment_id,
        status,
        changed_by,
        customer_note
      )
      VALUES (?, ?, ?, ?)
    `).run(
      id,
      data.status,
      user.id,
      data.customer_note || null
    );

    const appointmentStatus =
      data.status === "DELIVERED"
        ? "COMPLETED"
        : "IN_PROGRESS";

    db.prepare(`
      UPDATE appointments
      SET status = ?
      WHERE id = ?
    `).run(appointmentStatus, id);

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      user.id,
      "UPDATE_TRACKING",
      "appointment",
      id,
      JSON.stringify({
        from: latest?.status ?? null,
        to: data.status,
      })
    );

    return getPayload(
      {
        ...appointment,
        status: appointmentStatus,
      },
      true
    );
  }).immediate();

  res.json(result);
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next
) => {
  if (error instanceof TrackingError) {
    res.status(error.status).json({
      message: error.message,
    });
    return;
  }

  next(error);
};

trackingRouter.use(errorHandler);
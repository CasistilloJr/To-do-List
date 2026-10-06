import { Router } from "express";
import type { ErrorRequestHandler } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../database/connection.js";

export const adminAppointmentsRouter = Router();

const ZONE = "America/Mexico_City";

type Service = {
  id: number;
  name: string;
  price_cents: number;
  price_max_cents: number;
  duration_minutes: number;
  duration_max_minutes: number;
};

class AppointmentError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

adminAppointmentsRouter.use((_req, res, next) => {
  if (res.locals.user.role !== "ADMIN") {
    res.status(403).json({
      message: "Acceso exclusivo del administrador.",
    });
    return;
  }

  next();
});

const createSchema = z.object({
  customer_id: z.number().int().positive().safe(),
  pet_id: z.number().int().positive().safe(),
  service_ids: z
    .array(z.number().int().positive().safe())
    .min(1)
    .max(20)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "No repitas servicios."
    ),
  date: z.iso.date(),
  hour: z.number().int().min(10).max(17),
  notes: z.string().trim().max(1000),
}).strict();

adminAppointmentsRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppointmentError(
      400,
      "Revisa el cliente, la mascota, los servicios y el horario."
    );
  }

  const data = parsed.data;

  const today = DateTime.now()
    .setZone(ZONE)
    .startOf("day");

  const day = DateTime.fromISO(data.date, {
    zone: ZONE,
  });

  if (
    !day.isValid ||
    day.toMillis() < today.toMillis() ||
    day.toMillis() > today.plus({ days: 90 }).toMillis()
  ) {
    throw new AppointmentError(
      400,
      "Selecciona una fecha entre hoy y los próximos 90 días."
    );
  }

  if (day.weekday === 7) {
    throw new AppointmentError(
      400,
      "Los domingos descansamos."
    );
  }

  const start = day.set({
    hour: data.hour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  const startsAt = start.toUTC().toISO()!;

  const appointmentId = db.transaction(() => {
    if (start.toMillis() <= Date.now()) {
      throw new AppointmentError(
        400,
        "Ese horario ya pasó."
      );
    }

    const customer = db.prepare(`
      SELECT id
      FROM users
      WHERE id = ?
        AND role = 'CLIENT'
        AND active = 1
    `).get(data.customer_id);

    if (!customer) {
      throw new AppointmentError(
        404,
        "Cliente activo no encontrado."
      );
    }

    const pet = db.prepare(`
      SELECT id
      FROM pets
      WHERE id = ?
        AND owner_id = ?
        AND active = 1
    `).get(data.pet_id, data.customer_id);

    if (!pet) {
      throw new AppointmentError(
        400,
        "La mascota no pertenece a este cliente o está archivada."
      );
    }

    const occupied = db.prepare(`
      SELECT id
      FROM appointments
      WHERE starts_at = ?
        AND status IN (
          'CONFIRMED',
          'IN_PROGRESS',
          'COMPLETED',
          'NO_SHOW'
        )
      LIMIT 1
    `).get(startsAt);

    if (occupied) {
      throw new AppointmentError(
        409,
        "Ese horario ya tiene una cita confirmada."
      );
    }

    const duplicate = db.prepare(`
      SELECT id
      FROM appointments
      WHERE pet_id = ?
        AND starts_at = ?
        AND status = 'PENDING'
      LIMIT 1
    `).get(data.pet_id, startsAt);

    if (duplicate) {
      throw new AppointmentError(
        409,
        "Esta mascota ya tiene una solicitud pendiente para esa hora. Confírmala desde la lista de citas."
      );
    }

    const serviceQuery = db.prepare(`
      SELECT
        id,
        name,
        price_cents,
        COALESCE(
          price_max_cents,
          price_cents
        ) AS price_max_cents,
        duration_minutes,
        COALESCE(
          duration_max_minutes,
          duration_minutes
        ) AS duration_max_minutes
      FROM services
      WHERE id = ? AND active = 1
    `);

    const services = data.service_ids.map((id) => {
      const service = serviceQuery.get(id) as Service | undefined;

      if (!service) {
        throw new AppointmentError(
          409,
          "Uno de los servicios ya no está disponible."
        );
      }

      return service;
    });

    const durationMax = services.reduce(
      (total, service) =>
        total + service.duration_max_minutes,
      0
    );

    // Es una referencia estimada; no bloquea recepciones posteriores.
    const endsAt = start
      .plus({ minutes: durationMax })
      .toUTC()
      .toISO()!;

    const insertion = db.prepare(`
      INSERT INTO appointments (
        pet_id,
        starts_at,
        ends_at,
        status,
        notes
      )
      VALUES (?, ?, ?, 'CONFIRMED', ?)
    `).run(
      data.pet_id,
      startsAt,
      endsAt,
      data.notes || null
    );

    const id = Number(insertion.lastInsertRowid);

    const insertService = db.prepare(`
      INSERT INTO appointment_services (
        appointment_id,
        service_id,
        service_name,
        price_cents,
        price_max_cents,
        duration_minutes,
        duration_min_minutes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const service of services) {
      insertService.run(
        id,
        service.id,
        service.name,
        service.price_cents,
        service.price_max_cents,
        service.duration_max_minutes,
        service.duration_minutes
      );
    }

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (?, 'CREATE_ADMIN_APPOINTMENT', 'appointment', ?, ?)
    `).run(
      res.locals.user.id,
      id,
      JSON.stringify({
        customer_id: data.customer_id,
        pet_id: data.pet_id,
      })
    );

    return id;
  }).immediate();

  res.status(201).json({
    id: appointmentId,
    message: "Cita creada y confirmada correctamente.",
  });
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next
) => {
  if (error instanceof AppointmentError) {
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
      message:
        "Ese horario acaba de ocuparse. Actualiza la disponibilidad.",
    });
    return;
  }

  next(error);
};

adminAppointmentsRouter.use(errorHandler);
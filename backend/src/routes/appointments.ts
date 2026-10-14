import { Router } from "express";
import type { ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../database/connection.js";

export const appointmentsRouter = Router();

const ZONE = "America/Mexico_City";

const occupiedStatuses = `
  'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'
`;

type Service = {
  id: number;
  name: string;
  price_cents: number;
  price_max_cents: number;
  duration_minutes: number;
  duration_max_minutes: number;
};

type Appointment = {
  id: number;
  pet_id: number;
  owner_id: number;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  pet_name: string;
  owner_name: string;
};

class RequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function now() {
  return DateTime.now().setZone(ZONE);
}

function utc(value: DateTime) {
  return value.toUTC().toISO()!;
}

function hourLabel(hour: number) {
  return `${hour > 12 ? hour - 12 : hour}:00 ${
    hour >= 12 ? "p. m." : "a. m."
  }`;
}

function parseDay(value: unknown) {
  const parsed = z.iso.date().safeParse(value);

  if (!parsed.success) {
    throw new RequestError(400, "Selecciona una fecha válida.");
  }

  const day = DateTime.fromISO(parsed.data, { zone: ZONE });
  const today = now().startOf("day");

  if (
    !day.isValid ||
    day.toMillis() < today.toMillis() ||
    day.toMillis() > today.plus({ days: 90 }).toMillis()
  ) {
    throw new RequestError(
      400,
      "Selecciona una fecha entre hoy y los próximos 90 días."
    );
  }

  return day;
}

function slotIsOccupied(startsAt: string, exceptId = 0) {
  return Boolean(
    db.prepare(`
      SELECT id
      FROM appointments
      WHERE starts_at = ?
        AND id <> ?
        AND status IN (${occupiedStatuses})
      LIMIT 1
    `).get(startsAt, exceptId)
  );
}

function findAppointment(id: number) {
  return db.prepare(`
    SELECT
      a.id,
      a.pet_id,
      a.starts_at,
      a.ends_at,
      a.status,
      a.notes,
      p.owner_id,
      p.name AS pet_name,
      u.name AS owner_name
    FROM appointments a
    JOIN pets p ON p.id = a.pet_id
    JOIN users u ON u.id = p.owner_id
    WHERE a.id = ?
  `).get(id) as Appointment | undefined;
}

const serviceColumns = `
  id,
  name,
  price_cents,
  COALESCE(price_max_cents, price_cents) AS price_max_cents,
  duration_minutes,
  COALESCE(
    duration_max_minutes,
    duration_minutes
  ) AS duration_max_minutes
`;

const createSchema = z.object({
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

const idSchema = z.coerce.number().int().positive().safe();

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Demasiadas solicitudes. Intenta más tarde.",
  },
});

// DATOS PARA EL FORMULARIO DEL CLIENTE
appointmentsRouter.get("/options", (_req, res) => {
  const user = res.locals.user;

  const pets = db.prepare(`
    SELECT id, name
    FROM pets
    WHERE owner_id = ? AND active = 1
    ORDER BY name COLLATE NOCASE
  `).all(user.id);

  const services = db.prepare(`
    SELECT ${serviceColumns}
    FROM services
    WHERE active = 1
    ORDER BY name COLLATE NOCASE
  `).all();

  res.json({
    pets,
    services,
    today: now().toISODate(),
    maxDate: now().plus({ days: 90 }).toISODate(),
  });
});

// DISPONIBILIDAD DE RECEPCIÓN
appointmentsRouter.get("/availability", (req, res) => {
  const day = parseDay(req.query.date);

  if (day.weekday === 7) {
    res.json({
      slots: [],
      message: "Los domingos descansamos.",
    });
    return;
  }

  const current = now().toMillis();

  const slots = Array.from({ length: 8 }, (_, index) => {
    const hour = 10 + index;
    const start = day.set({
      hour,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    return {
      hour,
      label: hourLabel(hour),
      available:
        start.toMillis() > current &&
        !slotIsOccupied(utc(start)),
    };
  });

  res.json({ slots, message: "" });
});

function canHideAppointment(appointment: Appointment) {
  // Una cita cancelada puede ocultarse inmediatamente.
  if (appointment.status === "CANCELLED") {
    return true;
  }

  // Entregadas e inasistencias: solo cuando pasó su horario.
  const startsAt = Date.parse(appointment.starts_at);

  return (
    Number.isFinite(startsAt) &&
    startsAt < Date.now() &&
    ["COMPLETED", "NO_SHOW"].includes(appointment.status)
  );
}
// LISTAR CITAS
appointmentsRouter.get("/", (req, res) => {
  const user = res.locals.user;
  const isAdmin = user.role === "ADMIN";

  const parsedFilter = z
    .enum(["true", "false"])
    .optional()
    .safeParse(req.query.hidden);

  if (!parsedFilter.success) {
    throw new RequestError(
      400,
      "Filtro de historial inválido."
    );
  }

  const hidden = parsedFilter.data === "true";

  const rows = db.prepare(`
    SELECT
      a.id,
      a.pet_id,
      a.starts_at,
      a.ends_at,
      a.status,
      a.notes,
      p.owner_id,
      p.name AS pet_name,
      u.name AS owner_name
    FROM appointments a
    JOIN pets p ON p.id = a.pet_id
    JOIN users u ON u.id = p.owner_id
    WHERE (? = 1 OR p.owner_id = ?)
      AND EXISTS (
        SELECT 1
        FROM appointment_history_hidden h
        WHERE h.appointment_id = a.id
          AND h.user_id = ?
      ) = ?
    ORDER BY a.starts_at DESC, a.id DESC
    LIMIT 200
  `).all(
    isAdmin ? 1 : 0,
    user.id,
    user.id,
    hidden ? 1 : 0
  ) as Appointment[];

  const itemsQuery = db.prepare(`
    SELECT
      service_name,
      price_cents,
      COALESCE(
        price_max_cents,
        price_cents
      ) AS price_max_cents,
      COALESCE(
        duration_min_minutes,
        duration_minutes
      ) AS duration_min_minutes,
      duration_minutes AS duration_max_minutes
    FROM appointment_services
    WHERE appointment_id = ?
    ORDER BY id
  `);

  res.json({
    appointments: rows.map((appointment) => ({
      ...appointment,
      can_hide: canHideAppointment(appointment),
      services: itemsQuery.all(appointment.id),
    })),
  });
});

// SOLICITAR CITA
appointmentsRouter.post("/", requestLimiter, (req, res) => {
  const user = res.locals.user;

  if (user.role !== "CLIENT") {
    throw new RequestError(
      403,
      "Este formulario es para cuentas de clientes."
    );
  }

  const parsed = createSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new RequestError(
      400,
      "Revisa la mascota, los servicios, la fecha y el horario."
    );
  }

  const data = parsed.data;
  const day = parseDay(data.date);

  if (day.weekday === 7) {
    throw new RequestError(400, "Los domingos descansamos.");
  }

  const start = day.set({
    hour: data.hour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  const startsAt = utc(start);

  const appointmentId = db.transaction(() => {
    if (start.toMillis() <= now().toMillis()) {
      throw new RequestError(400, "Ese horario ya pasó.");
    }

    const pet = db.prepare(`
      SELECT id
      FROM pets
      WHERE id = ? AND owner_id = ? AND active = 1
    `).get(data.pet_id, user.id);

    if (!pet) {
      throw new RequestError(404, "Mascota no encontrada.");
    }

    if (slotIsOccupied(startsAt)) {
      throw new RequestError(
        409,
        "Ese horario acaba de ocuparse. Selecciona otro."
      );
    }

    const duplicate = db.prepare(`
      SELECT id
      FROM appointments
      WHERE pet_id = ?
        AND starts_at = ?
        AND status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')
    `).get(data.pet_id, startsAt);

    if (duplicate) {
      throw new RequestError(
        409,
        "Ya tienes una solicitud para esta mascota y horario."
      );
    }

    const serviceQuery = db.prepare(`
      SELECT ${serviceColumns}
      FROM services
      WHERE id = ? AND active = 1
    `);

    const services = data.service_ids.map((id) => {
      const service = serviceQuery.get(id) as Service | undefined;

      if (!service) {
        throw new RequestError(
          409,
          "Uno de los servicios ya no está disponible."
        );
      }

      return service;
    });

    const durationMax = services.reduce(
      (total, service) => total + service.duration_max_minutes,
      0
    );

    // Este final es una referencia estimada.
    // No representa una promesa de entrega ni bloquea recepciones.
    const endsAt = utc(start.plus({ minutes: durationMax }));

    const insertion = db.prepare(`
      INSERT INTO appointments (
        pet_id, starts_at, ends_at, status, notes
      )
      VALUES (?, ?, ?, 'PENDING', ?)
    `).run(data.pet_id, startsAt, endsAt, data.notes || null);

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

    return id;
  }).immediate();

  res.status(201).json({
    id: appointmentId,
    message: "Solicitud enviada. Está pendiente de confirmación.",
  });
});

// CONFIRMAR CITA: SOLO ADMINISTRADOR
appointmentsRouter.patch("/:id/confirm", (req, res) => {
  if (res.locals.user.role !== "ADMIN") {
    throw new RequestError(403, "Acceso exclusivo del administrador.");
  }

  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    throw new RequestError(400, "Identificador inválido.");
  }

  db.transaction(() => {
    const appointment = findAppointment(parsedId.data);

    if (!appointment) {
      throw new RequestError(404, "Cita no encontrada.");
    }

    if (appointment.status !== "PENDING") {
      throw new RequestError(409, "La cita ya no está pendiente.");
    }

    if (Date.parse(appointment.starts_at) <= Date.now()) {
      throw new RequestError(
        409,
        "El horario ya pasó. Cancela esta solicitud."
      );
    }

    if (slotIsOccupied(appointment.starts_at, appointment.id)) {
      throw new RequestError(
        409,
        "Ya existe una cita confirmada para esa hora."
      );
    }

    db.prepare(`
      UPDATE appointments
      SET status = 'CONFIRMED'
      WHERE id = ? AND status = 'PENDING'
    `).run(appointment.id);
  }).immediate();

  res.json({ message: "Cita confirmada." });
});
// MARCAR INASISTENCIA: SOLO ADMINISTRADOR
appointmentsRouter.patch("/:id/no-show", (req, res) => {
  const user = res.locals.user;

  if (user.role !== "ADMIN") {
    throw new RequestError(
      403,
      "Solo el administrador puede registrar una inasistencia."
    );
  }

  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    throw new RequestError(400, "Identificador inválido.");
  }

  db.transaction(() => {
    const appointment = findAppointment(parsedId.data);

    if (!appointment) {
      throw new RequestError(404, "Cita no encontrada.");
    }

    if (appointment.status !== "CONFIRMED") {
      throw new RequestError(
        409,
        "Solo puedes marcar inasistencia en una cita confirmada."
      );
    }

    const startsAt = Date.parse(appointment.starts_at);

    if (!Number.isFinite(startsAt) || startsAt >= Date.now()) {
      throw new RequestError(
        409,
        "La hora programada de recepción todavía no ha pasado."
      );
    }

    // La mascota no debe haber iniciado su seguimiento.
    const received = db.prepare(`
      SELECT id
      FROM status_events
      WHERE appointment_id = ?
      LIMIT 1
    `).get(appointment.id);

    if (received) {
      throw new RequestError(
        409,
        "Esta mascota ya tiene seguimiento registrado. No puedes marcarla como inasistencia."
      );
    }

    // Evita clasificar como inasistencia una cita con venta.
    const sale = db.prepare(`
      SELECT id
      FROM sales
      WHERE appointment_id = ?
      LIMIT 1
    `).get(appointment.id);

    if (sale) {
      throw new RequestError(
        409,
        "Esta cita tiene una venta registrada. Revisa sus datos."
      );
    }

    const update = db.prepare(`
      UPDATE appointments
      SET status = 'NO_SHOW'
      WHERE id = ?
        AND status = 'CONFIRMED'
        AND NOT EXISTS (
          SELECT 1
          FROM status_events
          WHERE appointment_id = ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM sales
          WHERE appointment_id = ?
        )
    `).run(
      appointment.id,
      appointment.id,
      appointment.id
    );

    if (update.changes !== 1) {
      throw new RequestError(
        409,
        "La cita cambió. Actualiza la lista antes de continuar."
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
      VALUES (?, 'MARK_NO_SHOW', 'appointment', ?, ?)
    `).run(
      user.id,
      appointment.id,
      JSON.stringify({
        from: "CONFIRMED",
        to: "NO_SHOW",
        starts_at: appointment.starts_at,
      })
    );
  }).immediate();

  res.json({
    message: "Inasistencia registrada correctamente.",
  });
});

// CANCELAR: ADMINISTRADOR O PROPIETARIO
appointmentsRouter.patch("/:id/cancel", (req, res) => {
  const user = res.locals.user;
  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    throw new RequestError(400, "Identificador inválido.");
  }

  db.transaction(() => {
    const appointment = findAppointment(parsedId.data);

    if (
      !appointment ||
      (user.role !== "ADMIN" && appointment.owner_id !== user.id)
    ) {
      throw new RequestError(404, "Cita no encontrada.");
    }

    if (!["PENDING", "CONFIRMED"].includes(appointment.status)) {
      throw new RequestError(409, "Esta cita ya no se puede cancelar.");
    }

    if (
      user.role !== "ADMIN" &&
      Date.parse(appointment.starts_at) <= Date.now()
    ) {
      throw new RequestError(
        409,
        "El horario ya pasó. Contacta al negocio."
      );
    }

    db.prepare(`
      UPDATE appointments
      SET status = 'CANCELLED'
      WHERE id = ?
    `).run(appointment.id);
  }).immediate();

  res.json({ message: "Cita cancelada." });
});
// OCULTAR O RESTAURAR UNA CITA EN LA LISTA DE LA CUENTA ACTUAL
appointmentsRouter.patch("/:id/history", (req, res) => {
  const user = res.locals.user;

  const parsedId = idSchema.safeParse(req.params.id);

  const parsedBody = z
    .object({
      hidden: z.boolean(),
    })
    .strict()
    .safeParse(req.body);

  if (!parsedId.success || !parsedBody.success) {
    throw new RequestError(
      400,
      "Solicitud de historial inválida."
    );
  }

  if (user.role !== "ADMIN" && user.role !== "CLIENT") {
    throw new RequestError(403, "Acceso no permitido.");
  }

  db.transaction(() => {
    const appointment = findAppointment(parsedId.data);

    if (
      !appointment ||
      (
        user.role !== "ADMIN" &&
        appointment.owner_id !== user.id
      )
    ) {
      throw new RequestError(404, "Cita no encontrada.");
    }

    if (
      parsedBody.data.hidden &&
      !canHideAppointment(appointment)
    ) {
      throw new RequestError(
        409,
"Puedes ocultar citas canceladas en cualquier momento. Las entregadas o marcadas como inasistencia solo pueden ocultarse cuando haya pasado su horario."      );
    }

    if (parsedBody.data.hidden) {
      db.prepare(`
        INSERT INTO appointment_history_hidden (
          user_id,
          appointment_id
        )
        VALUES (?, ?)
        ON CONFLICT(user_id, appointment_id) DO NOTHING
      `).run(user.id, appointment.id);
    } else {
      db.prepare(`
        DELETE FROM appointment_history_hidden
        WHERE user_id = ?
          AND appointment_id = ?
      `).run(user.id, appointment.id);
    }
  }).immediate();

  res.json({
    message: parsedBody.data.hidden
      ? "Cita ocultada de tu lista. Puedes recuperarla en Citas ocultas."
      : "Cita restaurada en tu lista.",
  });
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next
) => {
  if (error instanceof RequestError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    res.status(409).json({
      message: "Ese horario ya está ocupado. Actualiza las citas.",
    });
    return;
  }

  next(error);
};

appointmentsRouter.use(errorHandler);
import { Router } from "express";
import { z } from "zod";
import { db } from "../database/connection.js";

export const servicesRouter = Router();

type Service = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  price_max_cents: number;
  duration_minutes: number;
  duration_max_minutes: number;
  active: number;
};

const idSchema = z.coerce.number().int().positive().safe();

const serviceSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(1500),
    price_cents: z.number().int().min(0).max(99999999),
    price_max_cents: z.number().int().min(0).max(99999999),
    duration_minutes: z.number().int().min(1).max(1440),
    duration_max_minutes: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine(
    (value) => value.price_max_cents >= value.price_cents,
    {
      message: "El precio máximo no puede ser menor que el mínimo.",
      path: ["price_max_cents"],
    }
  )
  .refine(
    (value) =>
      value.duration_max_minutes >= value.duration_minutes,
    {
      message: "La duración máxima no puede ser menor que la mínima.",
      path: ["duration_max_minutes"],
    }
  );

const activeSchema = z.object({
  active: z.boolean(),
}).strict();

const serviceColumns = `
  id,
  name,
  description,
  price_cents,
  COALESCE(price_max_cents, price_cents) AS price_max_cents,
  duration_minutes,
  COALESCE(
    duration_max_minutes,
    duration_minutes
  ) AS duration_max_minutes,
  active
`;

function findService(id: number) {
  return db.prepare(`
    SELECT ${serviceColumns}
    FROM services
    WHERE id = ?
  `).get(id) as Service | undefined;
}

function isDuplicateName(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

// CONSULTAR CATÁLOGO
servicesRouter.get("/", (_req, res) => {
  const isAdmin = res.locals.user.role === "ADMIN";

  const services = db.prepare(`
    SELECT ${serviceColumns}
    FROM services
    WHERE active = 1 OR ? = 1
    ORDER BY active DESC, name COLLATE NOCASE, id
  `).all(isAdmin ? 1 : 0);

  res.json({ services });
});

// Solo administradores pueden modificar el catálogo.
servicesRouter.use((_req, res, next) => {
  if (res.locals.user.role !== "ADMIN") {
    res.status(403).json({
      message: "Solo el administrador puede modificar servicios.",
    });
    return;
  }

  next();
});

// CREAR SERVICIO
servicesRouter.post("/", (req, res) => {
  const result = serviceSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Revisa los datos y los rangos de precio y duración.",
    });
    return;
  }

  const service = result.data;

  try {
    const insertion = db.prepare(`
      INSERT INTO services (
        name,
        description,
        price_cents,
        price_max_cents,
        duration_minutes,
        duration_max_minutes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      service.name,
      service.description || null,
      service.price_cents,
      service.price_max_cents,
      service.duration_minutes,
      service.duration_max_minutes
    );

    res.status(201).json({
      service: findService(Number(insertion.lastInsertRowid)),
    });
  } catch (error) {
    if (isDuplicateName(error)) {
      res.status(409).json({
        message: "Ya existe un servicio con ese nombre.",
      });
      return;
    }

    throw error;
  }
});

// EDITAR SERVICIO
servicesRouter.put("/:id", (req, res) => {
  const parsedId = idSchema.safeParse(req.params.id);
  const result = serviceSchema.safeParse(req.body);

  if (!parsedId.success || !result.success) {
    res.status(400).json({
      message: "Revisa los datos y los rangos de precio y duración.",
    });
    return;
  }

  const service = result.data;

  try {
    const update = db.prepare(`
      UPDATE services
      SET name = ?,
          description = ?,
          price_cents = ?,
          price_max_cents = ?,
          duration_minutes = ?,
          duration_max_minutes = ?
      WHERE id = ?
    `).run(
      service.name,
      service.description || null,
      service.price_cents,
      service.price_max_cents,
      service.duration_minutes,
      service.duration_max_minutes,
      parsedId.data
    );

    if (update.changes === 0) {
      res.status(404).json({
        message: "Servicio no encontrado.",
      });
      return;
    }

    res.json({ service: findService(parsedId.data) });
  } catch (error) {
    if (isDuplicateName(error)) {
      res.status(409).json({
        message: "Ya existe otro servicio con ese nombre.",
      });
      return;
    }

    throw error;
  }
});

// ACTIVAR O DESACTIVAR
servicesRouter.patch("/:id/active", (req, res) => {
  const parsedId = idSchema.safeParse(req.params.id);
  const result = activeSchema.safeParse(req.body);

  if (!parsedId.success || !result.success) {
    res.status(400).json({ message: "Solicitud inválida." });
    return;
  }

  const update = db.prepare(`
    UPDATE services
    SET active = ?
    WHERE id = ?
  `).run(result.data.active ? 1 : 0, parsedId.data);

  if (update.changes === 0) {
    res.status(404).json({ message: "Servicio no encontrado." });
    return;
  }

  res.json({ service: findService(parsedId.data) });
});
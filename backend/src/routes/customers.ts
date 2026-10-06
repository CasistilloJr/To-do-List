import { Router } from "express";
import type { ErrorRequestHandler } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../database/connection.js";

export const customersRouter = Router();

class CustomerError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Customer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  active: number;
  portal_enabled: number;
};

const customerColumns = `
  id,
  name,
  email,
  phone,
  active,
  (password_hash IS NOT NULL) AS portal_enabled
`;

function findCustomer(id: number) {
  return db.prepare(`
    SELECT ${customerColumns}
    FROM users
    WHERE id = ? AND role = 'CLIENT'
  `).get(id) as Customer | undefined;
}

const idSchema = z.coerce.number().int().positive().safe();

function readId(value: unknown) {
  const result = idSchema.safeParse(value);

  if (!result.success) {
    throw new CustomerError(400, "Identificador inválido.");
  }

  return result.data;
}

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\d{10}$/),
  email: z.union([
    z.literal(""),
    z.string().trim().email().max(254),
  ]),
}).strict();

const petSchema = z.object({
  name: z.string().trim().min(1).max(80),
  species: z.enum(["Perro", "Gato", "Otro"]),
  breed: z.string().trim().max(100),
  birth_date: z.union([
    z.literal(""),
    z.iso.date().refine(
      (value) =>
        value <= DateTime.now()
          .setZone("America/Mexico_City")
          .toISODate()!,
      "La fecha no puede estar en el futuro."
    ),
  ]),
  notes: z.string().trim().max(1500),
}).strict();

// Todas las rutas son exclusivas del administrador.
customersRouter.use((_req, res, next) => {
  if (res.locals.user.role !== "ADMIN") {
    res.status(403).json({
      message: "Acceso exclusivo del administrador.",
    });
    return;
  }

  next();
});

// BUSCAR CLIENTES: 50 POR PÁGINA
customersRouter.get("/", (req, res) => {
  const parsed = z.object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  }).safeParse(req.query);

  if (!parsed.success) {
    throw new CustomerError(400, "Búsqueda inválida.");
  }

  const { q, page } = parsed.data;
  const term = `%${q}%`;

  const rows = db.prepare(`
    SELECT ${customerColumns}
    FROM users
    WHERE role = 'CLIENT'
      AND (
        name LIKE ?
        OR COALESCE(email, '') LIKE ?
        OR COALESCE(phone, '') LIKE ?
      )
    ORDER BY name COLLATE NOCASE, id
    LIMIT 51 OFFSET ?
  `).all(term, term, term, (page - 1) * 50);

  res.json({
    customers: rows.slice(0, 50),
    has_more: rows.length > 50,
    page,
  });
});

// CREAR FICHA SIN ACCESO WEB
customersRouter.post("/", (req, res) => {
  const parsed = contactSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new CustomerError(
      400,
      "Revisa el nombre, el teléfono de 10 dígitos y el correo."
    );
  }

  const data = parsed.data;
  const email = data.email.trim().toLowerCase() || null;

  const id = db.transaction(() => {
    const insertion = db.prepare(`
      INSERT INTO users (
        name, email, phone, password_hash, role
      )
      VALUES (?, ?, ?, NULL, 'CLIENT')
    `).run(data.name, email, data.phone);

    const customerId = Number(insertion.lastInsertRowid);

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id, action, entity_type, entity_id
      )
      VALUES (?, 'CREATE_CUSTOMER', 'user', ?)
    `).run(res.locals.user.id, customerId);

    return customerId;
  })();

  res.status(201).json({ customer: findCustomer(id) });
});

// CONSULTAR FICHA, MASCOTAS E HISTORIAL
customersRouter.get("/:id", (req, res) => {
  const id = readId(req.params.id);
  const customer = findCustomer(id);

  if (!customer) {
    throw new CustomerError(404, "Cliente no encontrado.");
  }

  const pets = db.prepare(`
    SELECT id, name, species, breed, birth_date, notes, active
    FROM pets
    WHERE owner_id = ?
    ORDER BY active DESC, name COLLATE NOCASE
  `).all(id);

  const visits = db.prepare(`
    SELECT
      a.id,
      a.starts_at,
      a.status,
      p.name AS pet_name,
      (
        SELECT GROUP_CONCAT(item.service_name, ', ')
        FROM appointment_services item
        WHERE item.appointment_id = a.id
      ) AS service_names
    FROM appointments a
    JOIN pets p ON p.id = a.pet_id
    WHERE p.owner_id = ?
    ORDER BY a.starts_at DESC, a.id DESC
    LIMIT 50
  `).all(id);

  res.json({ customer, pets, visits });
});

// EDITAR CONTACTO
customersRouter.put("/:id", (req, res) => {
  const id = readId(req.params.id);
  const parsed = contactSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new CustomerError(
      400,
      "Revisa el nombre, el teléfono y el correo."
    );
  }

  const data = parsed.data;
  const email = data.email.trim().toLowerCase() || null;

  db.transaction(() => {
    const customer = findCustomer(id);

    if (!customer) {
      throw new CustomerError(404, "Cliente no encontrado.");
    }

    // No cambiamos un correo utilizado para iniciar sesión.
    if (
      customer.portal_enabled === 1 &&
      email !== customer.email?.toLowerCase()
    ) {
      throw new CustomerError(
        400,
        "El cambio de correo de una cuenta web requiere verificación."
      );
    }
        if (email !== (customer.email?.toLowerCase() ?? null)) {
      db.prepare(`
        DELETE FROM account_activation_tokens
        WHERE user_id = ?
      `).run(id);
    }
    db.prepare(`
      UPDATE users
      SET name = ?, phone = ?, email = ?
      WHERE id = ? AND role = 'CLIENT'
    `).run(data.name, data.phone, email, id);

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id, action, entity_type, entity_id
      )
      VALUES (?, 'UPDATE_CUSTOMER', 'user', ?)
    `).run(res.locals.user.id, id);
  })();

  res.json({ customer: findCustomer(id) });
});

// REGISTRAR MASCOTA AL CLIENTE SELECCIONADO
customersRouter.post("/:id/pets", (req, res) => {
  const id = readId(req.params.id);
  const parsed = petSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new CustomerError(400, "Revisa los datos de la mascota.");
  }

  const pet = parsed.data;

  db.transaction(() => {
    const customer = findCustomer(id);

    if (!customer || customer.active !== 1) {
      throw new CustomerError(404, "Cliente activo no encontrado.");
    }

    const insertion = db.prepare(`
      INSERT INTO pets (
        owner_id, name, species, breed, birth_date, notes
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      pet.name,
      pet.species,
      pet.breed || null,
      pet.birth_date || null,
      pet.notes || null
    );

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id, action, entity_type, entity_id
      )
      VALUES (?, 'CREATE_PET', 'pet', ?)
    `).run(res.locals.user.id, Number(insertion.lastInsertRowid));
  })();

  res.status(201).json({ message: "Mascota registrada." });
});

// RECUPERAR UNA MASCOTA ARCHIVADA
customersRouter.patch("/:id/pets/:petId/restore", (req, res) => {
  const customerId = readId(req.params.id);
  const petId = readId(req.params.petId);

  db.transaction(() => {
    const customer = findCustomer(customerId);

    if (!customer || customer.active !== 1) {
      throw new CustomerError(404, "Cliente activo no encontrado.");
    }

    const result = db.prepare(`
      UPDATE pets
      SET active = 1
      WHERE id = ? AND owner_id = ? AND active = 0
    `).run(petId, customerId);

    if (result.changes === 0) {
      throw new CustomerError(
        409,
        "No se encontró una mascota archivada con esos datos."
      );
    }

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id, action, entity_type, entity_id
      )
      VALUES (?, 'RESTORE_PET', 'pet', ?)
    `).run(res.locals.user.id, petId);
  })();

  res.json({ message: "Mascota recuperada." });
});

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next
) => {
  if (error instanceof CustomerError) {
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
      message:
        "Ese correo ya está registrado. Busca al cliente antes de crear otra ficha.",
    });
    return;
  }

  next(error);
};

customersRouter.use(errorHandler);
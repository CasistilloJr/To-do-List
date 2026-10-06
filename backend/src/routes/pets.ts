import { Router } from "express";
import { z } from "zod";
import { db } from "../database/connection.js";

export const petsRouter = Router();

type Pet = {
  id: number;
  name: string;
  species: string;
  breed: string | null;
  birth_date: string | null;
  notes: string | null;
};

// Fecha actual en la zona horaria del negocio.
function todayInColima() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
}

const birthDateSchema = z.union([
  z.literal(""),
  z.iso.date().refine(
    (value) => value <= todayInColima(),
    "La fecha de nacimiento no puede estar en el futuro."
  ),
]);

const petSchema = z.object({
  name: z.string().trim().min(1).max(80),
  species: z.enum(["Perro", "Gato", "Otro"]),
  breed: z.string().trim().max(100),
  birth_date: birthDateSchema,
  notes: z.string().trim().max(1500),
}).strict();

const idSchema = z.coerce.number().int().positive().safe();

// Esta función siempre exige el propietario autenticado.
function findPet(id: number, ownerId: number) {
  return db.prepare(`
    SELECT id, name, species, breed, birth_date, notes
    FROM pets
    WHERE id = ?
      AND owner_id = ?
      AND active = 1
  `).get(id, ownerId) as Pet | undefined;
}

// LISTAR MIS MASCOTAS
petsRouter.get("/", (_req, res) => {
  const ownerId = res.locals.user.id;

  const pets = db.prepare(`
    SELECT id, name, species, breed, birth_date, notes
    FROM pets
    WHERE owner_id = ?
      AND active = 1
    ORDER BY name COLLATE NOCASE, id
  `).all(ownerId);

  res.json({ pets });
});

// CONSULTAR UNA MASCOTA
petsRouter.get("/:id", (req, res) => {
  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({ message: "Identificador inválido." });
    return;
  }

  const pet = findPet(parsedId.data, res.locals.user.id);

  if (!pet) {
    res.status(404).json({ message: "Mascota no encontrada." });
    return;
  }

  res.json({ pet });
});

// REGISTRAR UNA MASCOTA
petsRouter.post("/", (req, res) => {
  const result = petSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message:
        "Revisa el nombre, la especie y los demás datos. La fecha debe ser válida y no estar en el futuro.",
    });
    return;
  }

  const ownerId = res.locals.user.id;
  const pet = result.data;

  const insertion = db.prepare(`
    INSERT INTO pets (
      owner_id,
      name,
      species,
      breed,
      birth_date,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    ownerId,
    pet.name,
    pet.species,
    pet.breed || null,
    pet.birth_date || null,
    pet.notes || null
  );

  res.status(201).json({
    pet: findPet(Number(insertion.lastInsertRowid), ownerId),
  });
});

// EDITAR UNA MASCOTA
petsRouter.put("/:id", (req, res) => {
  const parsedId = idSchema.safeParse(req.params.id);
  const result = petSchema.safeParse(req.body);

  if (!parsedId.success || !result.success) {
    res.status(400).json({
      message: "Revisa los datos de la mascota.",
    });
    return;
  }

  const ownerId = res.locals.user.id;
  const pet = result.data;

  const update = db.prepare(`
    UPDATE pets
    SET name = ?,
        species = ?,
        breed = ?,
        birth_date = ?,
        notes = ?
    WHERE id = ?
      AND owner_id = ?
      AND active = 1
  `).run(
    pet.name,
    pet.species,
    pet.breed || null,
    pet.birth_date || null,
    pet.notes || null,
    parsedId.data,
    ownerId
  );

  if (update.changes === 0) {
    res.status(404).json({ message: "Mascota no encontrada." });
    return;
  }

  res.json({ pet: findPet(parsedId.data, ownerId) });
});

// ARCHIVAR SIN BORRAR SU HISTORIAL
petsRouter.patch("/:id/archive", (req, res) => {
  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({ message: "Identificador inválido." });
    return;
  }

  const ownerId = res.locals.user.id;
  const petId = parsedId.data;

  const outcome = db.transaction(() => {
    if (!findPet(petId, ownerId)) return "NOT_FOUND";

    const appointment = db.prepare(`
      SELECT id
      FROM appointments
      WHERE pet_id = ?
        AND status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')
      LIMIT 1
    `).get(petId);

    if (appointment) return "HAS_APPOINTMENT";

    db.prepare(`
      UPDATE pets
      SET active = 0
      WHERE id = ? AND owner_id = ? AND active = 1
    `).run(petId, ownerId);

    return "OK";
  }).immediate();

  if (outcome === "NOT_FOUND") {
    res.status(404).json({ message: "Mascota no encontrada." });
    return;
  }

  if (outcome === "HAS_APPOINTMENT") {
    res.status(409).json({
      message:
        "Esta mascota tiene citas pendientes, confirmadas o en curso. Resuélvelas antes de archivarla.",
    });
    return;
  }

  res.json({ message: "Mascota archivada." });
});
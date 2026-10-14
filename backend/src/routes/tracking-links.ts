import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../database/connection.js";

export const trackingLinksRouter = Router();
export const publicTrackingRouter = Router();

const idSchema = z.coerce.number().int().positive().safe();

const tokenSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Este router se monta después de requireLogin.
trackingLinksRouter.use((_req, res, next) => {
  if (res.locals.user?.role !== "ADMIN") {
    res.status(403).json({
      message: "Acceso exclusivo del administrador.",
    });
    return;
  }

  next();
});

// Crear o reemplazar el enlace de una cita.
trackingLinksRouter.post("/:id", (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);

  if (!parsed.success) {
    res.status(400).json({ message: "Identificador inválido." });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

  const created = db.transaction(() => {
    const appointment = db.prepare(`
      SELECT id
      FROM appointments
      WHERE id = ?
        AND status IN ('CONFIRMED', 'IN_PROGRESS')
    `).get(parsed.data);

    if (!appointment) return false;

    db.prepare(`
      INSERT INTO tracking_links (
        appointment_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, ?)
      ON CONFLICT(appointment_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        expires_at = excluded.expires_at
    `).run(parsed.data, hashToken(token), expiresAt);

    db.prepare(`
      INSERT INTO audit_logs (
        actor_id, action, entity_type, entity_id
      )
      VALUES (?, 'ISSUE_TRACKING_LINK', 'appointment', ?)
    `).run(res.locals.user.id, parsed.data);

    return true;
  }).immediate();

  if (!created) {
    res.status(409).json({
      message:
        "Solo puedes generar enlaces para citas confirmadas o en atención.",
    });
    return;
  }

  // El token original se entrega una sola vez.
  // La base de datos conserva únicamente su hash.
  res.status(201).json({
    token,
    expires_at: expiresAt,
  });
});

// Desactivar el enlace, incluso si ya caducó.
trackingLinksRouter.delete("/:id", (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);

  if (!parsed.success) {
    res.status(400).json({ message: "Identificador inválido." });
    return;
  }

  db.transaction(() => {
    const result = db.prepare(`
      DELETE FROM tracking_links
      WHERE appointment_id = ?
    `).run(parsed.data);

    if (result.changes > 0) {
      db.prepare(`
        INSERT INTO audit_logs (
          actor_id, action, entity_type, entity_id
        )
        VALUES (?, 'REVOKE_TRACKING_LINK', 'appointment', ?)
      `).run(res.locals.user.id, parsed.data);
    }
  }).immediate();

  res.json({ message: "El enlace de esta cita quedó desactivado." });
});

const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Demasiadas consultas. Espera un minuto.",
  },
});

// Consulta sin sesión, autorizada mediante el token privado.
// Usamos POST para que el token no viaje en la URL de la API.
publicTrackingRouter.post("/", lookupLimiter, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const parsed = tokenSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(404).json({
      message: "Enlace no disponible, desactivado o vencido.",
    });
    return;
  }

  const result = db.transaction(() => {
    const appointment = db.prepare(`
      SELECT
        a.id,
        a.status,
        p.name AS pet_name
      FROM tracking_links l
      JOIN appointments a ON a.id = l.appointment_id
      JOIN pets p ON p.id = a.pet_id
      WHERE l.token_hash = ?
        AND l.expires_at > ?
        AND a.status IN (
          'CONFIRMED',
          'IN_PROGRESS',
          'COMPLETED'
        )
    `).get(hashToken(parsed.data.token), Date.now()) as
      | { id: number; status: string; pet_name: string }
      | undefined;

    if (!appointment) return null;

    const events = db.prepare(`
      SELECT status, created_at
      FROM status_events
      WHERE appointment_id = ?
      ORDER BY id ASC
    `).all(appointment.id) as {
      status: string;
      created_at: string;
    }[];

    return {
      pet_name: appointment.pet_name,
      appointment_status: appointment.status,
      current_status: events.at(-1)?.status ?? null,
      events,
    };
  })();

  if (!result) {
    res.status(404).json({
      message: "Enlace no disponible, desactivado o vencido.",
    });
    return;
  }

  res.json(result);
});
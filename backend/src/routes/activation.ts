import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { z } from "zod";
import { db } from "../database/connection.js";
import { sendActivationEmail } from "../lib/mail.js";

export const activationRouter = Router();

const genericMessage =
  "Si el correo corresponde a una ficha pendiente de activar, recibirás un enlace. Revisa también Spam. Si ya tienes contraseña, inicia sesión.";

const invalidMessage =
  "El enlace no es válido, ya fue utilizado o venció. Solicita otro enlace.";

const lifetime = 30 * 60 * 1000;
const hour = 60 * 60 * 1000;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const requestLimiter = rateLimit({
  windowMs: hour,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Demasiadas solicitudes. Intenta más tarde.",
  },
});

const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Demasiados intentos. Intenta más tarde.",
  },
});

const requestSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();

const confirmSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(12).max(128),
}).strict();

type Candidate = {
  user_id: number;
  email: string;
};

function findCandidate(tokenHash: string) {
  return db.prepare(`
    SELECT t.user_id, t.email
    FROM account_activation_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
      AND t.expires_at > ?
      AND u.active = 1
      AND u.role = 'CLIENT'
      AND u.password_hash IS NULL
      AND u.email = t.email COLLATE NOCASE
  `).get(
    tokenHash,
    Date.now()
  ) as Candidate | undefined;
}

// SOLICITAR EL ENLACE
activationRouter.post(
  "/activation/request",
  requestLimiter,
  async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Escribe un correo válido.",
      });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);

    const prepared = db.transaction(() => {
      const current = Date.now();

      // Limpiar intentos antiguos.
      db.prepare(`
        DELETE FROM account_activation_tokens
        WHERE created_at < ?
      `).run(current - 24 * hour);

      const user = db.prepare(`
        SELECT id
        FROM users
        WHERE email = ? COLLATE NOCASE
          AND role = 'CLIENT'
          AND active = 1
          AND password_hash IS NULL
      `).get(email) as { id: number } | undefined;

      if (!user) return false;

      // Máximo tres enlaces por ficha en una hora.
      // Dejar al menos un minuto entre solicitudes.
      const recent = db.prepare(`
        SELECT COUNT(*) AS total, MAX(created_at) AS latest
        FROM account_activation_tokens
        WHERE user_id = ?
          AND created_at > ?
      `).get(
        user.id,
        current - hour
      ) as {
        total: number;
        latest: number | null;
      };

      if (
        recent.total >= 3 ||
        (
          recent.latest !== null &&
          current - recent.latest < 60000
        )
      ) {
        return false;
      }

      const global = db.prepare(`
        SELECT COUNT(*) AS total
        FROM account_activation_tokens
        WHERE created_at > ?
      `).get(current - hour) as { total: number };

      if (global.total >= 50) return false;

      db.prepare(`
        INSERT INTO account_activation_tokens (
          token_hash,
          user_id,
          email,
          created_at,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        tokenHash,
        user.id,
        email,
        current,
        current + lifetime
      );

      return true;
    }).immediate();

    // No revelar si el correo pertenece a una ficha.
    // Responder antes del envío evita revelar esa información
    // por el tiempo que tarda Gmail.
    res.status(202).json({
      message: genericMessage,
    });

    if (!prepared) return;

    try {
      await sendActivationEmail(email, token);
    } catch {
      // Invalidar el enlace y conservar el intento
      // para respetar los límites de solicitudes.
      db.prepare(`
        UPDATE account_activation_tokens
        SET expires_at = 0
        WHERE token_hash = ?
      `).run(tokenHash);

      console.error(
        "No se pudo enviar una activación. Revisa Gmail y la conexión SMTP."
      );
    }
  }
);

// CREAR LA CONTRASEÑA TRAS VERIFICAR EL ENLACE
activationRouter.post(
  "/activation/confirm",
  confirmLimiter,
  async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message:
          "Revisa el enlace y usa una contraseña de 12 a 128 caracteres.",
      });
      return;
    }

    const tokenHash = hashToken(parsed.data.token);

    if (!findCandidate(tokenHash)) {
      res.status(400).json({
        message: invalidMessage,
      });
      return;
    }

    const passwordHash = await argon2.hash(
      parsed.data.password,
      {
        type: argon2.argon2id,
      }
    );

    const activated = db.transaction(() => {
      // Revalidar porque la ficha o el enlace pudieron
      // cambiar durante el cálculo de la contraseña.
      const candidate = findCandidate(tokenHash);

      if (!candidate) return false;

      const updated = db.prepare(`
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
          AND email = ? COLLATE NOCASE
          AND password_hash IS NULL
          AND active = 1
          AND role = 'CLIENT'
      `).run(
        passwordHash,
        candidate.user_id,
        candidate.email
      );

      if (updated.changes !== 1) {
        throw new Error("No se pudo activar la ficha.");
      }

      // Consumir todos los enlaces de esa ficha.
      db.prepare(`
        DELETE FROM account_activation_tokens
        WHERE user_id = ?
      `).run(candidate.user_id);

      db.prepare(`
        DELETE FROM sessions
        WHERE user_id = ?
      `).run(candidate.user_id);

      db.prepare(`
        INSERT INTO audit_logs (
          actor_id,
          action,
          entity_type,
          entity_id
        )
        VALUES (?, 'ACTIVATE_CUSTOMER_PORTAL', 'user', ?)
      `).run(
        candidate.user_id,
        candidate.user_id
      );

      return true;
    }).immediate();

    if (!activated) {
      res.status(400).json({
        message: invalidMessage,
      });
      return;
    }

    res.json({
      message:
        "Acceso activado. Ya puedes iniciar sesión con tu correo y contraseña.",
    });
  }
);
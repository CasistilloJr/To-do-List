import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import * as argon2 from "argon2";
import { z } from "zod";
import { db } from "../database/connection.js";

export const registerRouter = Router();

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message:
      "Has realizado demasiados intentos de registro. Intenta más tarde.",
  },
});

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "Escribe un teléfono de 10 dígitos."),
    password: z.string().min(12).max(128),
  })
  .strict();

registerRouter.post(
  "/register",
  registerLimiter,
  async (req, res) => {
    const result = registerSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        message:
          "Revisa tus datos: nombre de al menos 2 caracteres, correo válido, teléfono de 10 dígitos y contraseña de 12 a 128 caracteres.",
      });
      return;
    }

    const { name, phone, password } = result.data;
    const email = result.data.email.toLowerCase();

    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);

    if (existing) {
      res.status(409).json({
        message:
          "No se puede registrar ese correo. Si ya tienes una cuenta, inicia sesión.",
      });
      return;
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    try {
      // El rol lo decide el servidor.
      // Todo registro público crea exclusivamente un cliente.
      db.prepare(`
        INSERT INTO users (
          name,
          email,
          phone,
          password_hash,
          role
        )
        VALUES (?, ?, ?, ?, 'CLIENT')
      `).run(name, email, phone, passwordHash);
    } catch (error) {
      // Atiende también registros simultáneos con el mismo correo.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        res.status(409).json({
          message:
"No se puede registrar ese correo. Si ya tienes contraseña, inicia sesión. Si el negocio creó tu ficha sin acceso web, usa «Activar mi acceso» en la pantalla de inicio de sesión."        });
        return;
      }

      throw error;
    }

    res.status(201).json({
      message: "Cuenta creada correctamente. Ya puedes iniciar sesión.",
    });
  }
);
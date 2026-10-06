import { registerRouter } from "./routes/register.js";
import "dotenv/config";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activationRouter } from "./routes/activation.js";
import { customersRouter } from "./routes/customers.js";
import { adminAppointmentsRouter } from "./routes/admin-appointments.js";
import { salesRouter } from "./routes/sales.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { trackingRouter } from "./routes/tracking.js";
import { servicesRouter } from "./routes/services.js";
import { petsRouter } from "./routes/pets.js";
import express from "express";
import type {
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "./database/connection.js";

type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "CLIENT";
};

type LoginUser = PublicUser & {
  password_hash: string | null;
  active: number;
};
const app = express();
const isProduction =
  process.env.NODE_ENV === "production";

const serveFrontend =
  isProduction ||
  process.env.SERVE_FRONTEND === "true";

// Configuración para el acceso directo mediante Render.
// Si posteriormente añadimos otro proxy, la revisaremos.
if (process.env.RENDER === "true") {
  app.set("trust proxy", 1);
}

if (isProduction && !process.env.APP_ORIGIN) {
  throw new Error(
    "Configura APP_ORIGIN con la dirección HTTPS pública."
  );
}

const port = Number(process.env.PORT ?? 3000);
const appOrigin = new URL(
  process.env.APP_ORIGIN ?? "http://localhost:5173"
).origin;

const cookieName = "castle_session";
const sessionDuration = 8 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// Esta función protege los tokens de sesión.
// Las contraseñas se procesan con Argon2.
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readToken(req: Request): string | undefined {
  const token = req.cookies?.[cookieName];

  if (typeof token !== "string" || token.length > 200) {
    return undefined;
  }

  return token;
}

function currentUser(req: Request): PublicUser | undefined {
  const token = readToken(req);

  if (!token) return undefined;

  return db.prepare(`
    SELECT u.id, u.name, u.email, u.role
    FROM sessions AS s
    JOIN users AS u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
      AND u.active = 1
  `).get(
    hashToken(token),
    new Date().toISOString()
  ) as PublicUser | undefined;
}

function requireLogin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const user = currentUser(req);

  if (!user) {
    res.status(401).json({
      message: "Inicia sesión para continuar.",
    });
    return;
  }

  res.locals.user = user;
  next();
}

function requireAdmin(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  const user = res.locals.user as PublicUser;

  if (user.role !== "ADMIN") {
    res.status(403).json({
      message: "No tienes permiso para acceder.",
    });
    return;
  }

  next();
}

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "upgrade-insecure-requests":
          isProduction ? [] : null,
      },
    },
  })
);
app.use(cookieParser());

// Evita almacenar respuestas privadas en la caché.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Comprueba el origen de las operaciones que modifican datos.
app.use("/api", (req, res, next) => {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];

  if (
    !safeMethods.includes(req.method) &&
    req.get("origin") !== appOrigin
  ) {
    res.status(403).json({
      message: "Origen de la solicitud no permitido.",
    });
    return;
  }

  next();
});

app.use(express.json({ limit: "10kb" }));
app.use("/api/auth", registerRouter);
app.use("/api/auth", activationRouter);
app.use("/api/pets", requireLogin, petsRouter);
app.use("/api/services", requireLogin, servicesRouter);
app.use("/api/appointments", requireLogin, appointmentsRouter);
app.use("/api/tracking", requireLogin, trackingRouter);
app.use("/api/sales", requireLogin, salesRouter);
app.use("/api/customers", requireLogin, customersRouter);
app.use(
  "/api/admin-appointments",
  requireLogin,
  adminAppointmentsRouter
);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message:
      "Demasiados intentos. Espera 15 minutos para volver a intentar.",
  },
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

// Reduce diferencias de tiempo entre cuentas existentes e inexistentes.
const dummyHash = await argon2.hash(
  randomBytes(32).toString("hex")
);

// Comprueba que el servidor funciona.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// INICIAR SESIÓN
app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      message: "Revisa el correo y la contraseña.",
    });
    return;
  }

  const email = result.data.email.toLowerCase();

  const user = db.prepare(`
    SELECT id, name, email, role, password_hash, active
    FROM users
    WHERE email = ?
  `).get(email) as LoginUser | undefined;

  const validPassword = await argon2.verify(
    user?.password_hash ?? dummyHash,
    result.data.password
  );
  if (
  !user ||
  !user.password_hash ||
  !validPassword ||
  user.active !== 1
) {
    res.status(401).json({
      message: "Correo o contraseña incorrectos.",
    });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + sessionDuration
  ).toISOString();

  const previousToken = readToken(req);

  db.transaction(() => {
    db.prepare(`
      DELETE FROM sessions
      WHERE expires_at <= ?
    `).run(new Date().toISOString());

    if (previousToken) {
      db.prepare(`
        DELETE FROM sessions
        WHERE token_hash = ?
      `).run(hashToken(previousToken));
    }

    db.prepare(`
      INSERT INTO sessions (
        user_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, ?)
    `).run(user.id, hashToken(token), expiresAt);
  })();

  res.cookie(cookieName, token, {
    ...cookieOptions,
    maxAge: sessionDuration,
  });

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

// CONSULTAR LA SESIÓN ACTUAL
app.get("/api/auth/me", requireLogin, (_req, res) => {
  res.json({ user: res.locals.user });
});

// CERRAR SESIÓN
app.post("/api/auth/logout", (req, res) => {
  const token = readToken(req);

  if (token) {
    db.prepare(`
      DELETE FROM sessions
      WHERE token_hash = ?
    `).run(hashToken(token));
  }

  res.clearCookie(cookieName, cookieOptions);
  res.json({ message: "Sesión cerrada." });
});

// RESUMEN EXCLUSIVO DEL ADMINISTRADOR
app.get(
  "/api/admin/summary",
  requireLogin,
  requireAdmin,
  (_req, res) => {
    const summary = db.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM users
          WHERE role = 'CLIENT' AND active = 1
        ) AS clients,
        (
          SELECT COUNT(*)
          FROM pets
          WHERE active = 1
        ) AS pets,
        (
          SELECT COUNT(*)
          FROM appointments
          WHERE status = 'PENDING'
        ) AS pendingAppointments
    `).get();

    res.json(summary);
  }
);

app.use("/api", (_req, res) => {
  res.status(404).json({
    message: "Ruta no encontrada.",
  });
});
// Entregar la versión compilada de React.
if (serveFrontend) {
  const frontendDirectory = fileURLToPath(
    new URL("../../frontend/dist/", import.meta.url)
  );

  const indexPath = join(
    frontendDirectory,
    "index.html"
  );

  if (!existsSync(indexPath)) {
    throw new Error(
      "Falta frontend/dist/index.html. Ejecuta npm run build en frontend."
    );
  }

  app.use(
    express.static(frontendDirectory, {
      index: false,
      dotfiles: "deny",
    })
  );

  // Permite abrir directamente rutas como /citas
  // o /activar-cuenta y recargarlas en el navegador.
  app.get(/.*/, (req, res, next) => {
    if (
      req.path.startsWith("/assets/") ||
      extname(req.path) ||
      !req.accepts("html")
    ) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexPath);
  });
}

const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next
) => {
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({
      message: "Solicitud inválida.",
    });
    return;
  }

  if (error?.type === "entity.too.large") {
    res.status(413).json({
      message: "Solicitud demasiado grande.",
    });
    return;
  }

  console.error("Error interno:", error?.message);

  res.status(500).json({
    message: "Ocurrió un error en el servidor.",
  });
};

app.use(errorHandler);

const host = isProduction
  ? "0.0.0.0"
  : "127.0.0.1";

app.listen(port, host, () => {
  console.log(
    `Servidor iniciado en el puerto ${port}.`
  );
});
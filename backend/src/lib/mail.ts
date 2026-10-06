import "dotenv/config";
import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER?.trim();
const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

const origin = new URL(
  process.env.APP_ORIGIN ?? "http://localhost:5173"
);

if (!user || !pass) {
  throw new Error(
    "Configura GMAIL_USER y GMAIL_APP_PASSWORD en backend/.env."
  );
}

if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  (
    process.env.NODE_ENV === "production" &&
    origin.protocol !== "https:"
  )
) {
  throw new Error(
    "APP_ORIGIN debe ser el origen del frontend; en producción requiere HTTPS."
  );
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user,
    pass,
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
  disableFileAccess: true,
  disableUrlAccess: true,
});

export async function verifyMailConnection() {
  await transporter.verify();
}

export async function sendActivationEmail(
  to: string,
  token: string
) {
  const url = new URL("/activar-cuenta", origin.origin);

  url.hash = new URLSearchParams({ token }).toString();

  await transporter.sendMail({
    from: {
      name: "Castle Pets",
      address: user!,
    },
    to,
    subject: "Activa tu acceso a Castle Pets",
    text: [
      "Solicitaste activar tu acceso web a Castle Pets.",
      "Abre este enlace para crear tu contraseña:",
      url.toString(),
      "El enlace vence en 30 minutos y solo puede usarse una vez.",
      "Si no lo solicitaste, ignora este mensaje. Tu ficha no se modificará.",
    ].join("\n\n"),
  });
}
import { verifyMailConnection } from "../lib/mail.js";

try {
  await verifyMailConnection();
  console.log("Conexión con Gmail correcta.");
} catch {
  console.error(
    "No se pudo conectar con Gmail. Revisa el correo, la contraseña de aplicación y tu conexión."
  );
  process.exitCode = 1;
}
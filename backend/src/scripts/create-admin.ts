import { input, password } from "@inquirer/prompts";
import * as argon2 from "argon2";
import { z } from "zod";
import { db } from "../database/connection.js";

async function main() {
  console.log("\nCrear administrador de Castle Pet’s\n");

  const name = (
    await input({
      message: "Tu nombre:",
      validate: (value) =>
        value.trim().length >= 2 ||
        "Escribe al menos 2 caracteres.",
    })
  ).trim();

  const email = (
    await input({
      message: "Correo para iniciar sesión:",
      validate: (value) =>
        z.string().email().max(254).safeParse(value.trim()).success ||
        "Escribe un correo válido.",
    })
  ).trim().toLowerCase();

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email);

  if (existing) {
    throw new Error(
      "Ese correo ya está registrado. No se modificó la cuenta existente."
    );
  }

  const secret = await password({
    message: "Contraseña nueva, de 12 a 128 caracteres:",
    mask: "*",
    validate: (value) =>
      (value.length >= 12 && value.length <= 128) ||
      "Usa entre 12 y 128 caracteres.",
  });

  await password({
    message: "Repite la contraseña:",
    mask: "*",
    validate: (value) =>
      value === secret || "Las contraseñas no coinciden.",
  });

  const passwordHash = await argon2.hash(secret, {
    type: argon2.argon2id,
  });

  db.prepare(`
    INSERT INTO users (
      name,
      email,
      password_hash,
      role
    )
    VALUES (?, ?, ?, 'ADMIN')
  `).run(name, email, passwordHash);

  console.log("\nAdministrador creado correctamente.");
  console.log("Correo:", email);
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "No se pudo crear el administrador."
    );

    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
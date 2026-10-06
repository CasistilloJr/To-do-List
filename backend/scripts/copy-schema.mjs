import { copyFileSync, mkdirSync } from "node:fs";

const destination = new URL(
  "../dist/database/",
  import.meta.url
);

mkdirSync(destination, {
  recursive: true,
});

copyFileSync(
  new URL("../src/database/schema.sql", import.meta.url),
  new URL("schema.sql", destination)
);

console.log("Esquema SQL copiado a dist/database.");
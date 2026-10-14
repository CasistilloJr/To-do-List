import "dotenv/config";
import {
  input,
  password,
  select,
  checkbox,
  confirm,
} from "@inquirer/prompts";

type User = {
  id: number;
  name: string;
  role: "ADMIN" | "CLIENT";
};

type Pet = {
  id: number;
  name: string;
};

type Service = {
  id: number;
  name: string;
  price_cents: number;
  price_max_cents: number;
  duration_minutes: number;
  duration_max_minutes: number;
};

type Options = {
  pets: Pet[];
  services: Service[];
  today: string;
  maxDate: string;
};

type Availability = {
  slots: {
    hour: number;
    label: string;
    available: boolean;
  }[];
  message: string;
};

const port = Number(process.env.PORT ?? 3000);

// Este simulador se conecta únicamente a tu computadora.
const baseUrl = `http://127.0.0.1:${port}`;

const origin = new URL(
  process.env.APP_ORIGIN ?? "http://localhost:5173"
).origin;

let sessionCookie = "";

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(cents / 100);
}

function priceRange(min: number, max: number) {
  return min === max
    ? money(min)
    : `${money(min)} a ${money(max)}`;
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return `${hours}:${String(remaining).padStart(2, "0")}`;
}

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Origin: origin,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });

  // Conserva solamente la cookie de esta sesión de prueba.
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith("castle_session=")) {
      sessionCookie = cookie.split(";")[0];
    }
  }

  const data = (await response.json()) as T & {
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.message ?? `La solicitud falló: ${response.status}.`
    );
  }

  return data;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Este simulador solo debe ejecutarse en desarrollo local."
    );
  }

  console.log("\nCastle Pets — simulador local de citas");
  console.log("No envía ni recibe mensajes de WhatsApp.");
  console.log(
    "Si confirmas al final, se guardará una solicitud en tu base local.\n"
  );

  const email = await input({
    message: "Correo de tu cliente de prueba:",
  });

  const customerPassword = await password({
    message: "Contraseña:",
    mask: "*",
  });

  const { user } = await api<{ user: User }>(
    "/api/auth/login",
    "POST",
    {
      email: email.trim(),
      password: customerPassword,
    }
  );

  if (user.role !== "CLIENT") {
    throw new Error(
      "Entra con una cuenta de cliente, no con el administrador."
    );
  }

  console.log(`\nBot: Hola, ${user.name}. Vamos a solicitar una cita.`);

  const options = await api<Options>(
    "/api/appointments/options"
  );

  if (options.pets.length === 0) {
    throw new Error(
      "Esta cuenta no tiene mascotas activas. Registra una en la página."
    );
  }

  if (options.services.length === 0) {
    throw new Error(
      "No hay servicios activos. Agrega uno desde el administrador."
    );
  }

  const petId = await select<number>({
    message: "Bot: ¿Para cuál mascota será la cita?",
    choices: options.pets.map((pet) => ({
      name: pet.name,
      value: pet.id,
    })),
  });

  const serviceIds = await checkbox<number>({
    message:
      "Bot: Elige los servicios. Usa espacio para marcar y Enter para continuar:",
    choices: options.services.map((service) => ({
      name:
        `${service.name} — ` +
        priceRange(service.price_cents, service.price_max_cents),
      value: service.id,
    })),
    validate: (selected) => {
      if (selected.length === 0) {
        return "Selecciona al menos un servicio.";
      }

      if (selected.length > 20) {
        return "Puedes seleccionar hasta 20 servicios.";
      }

      return true;
    },
  });

  let date = "";
  let hour = 0;
  let hourLabel = "";

  while (true) {
    date = await input({
      message:
        `Bot: ¿Qué fecha quieres? Usa AAAA-MM-DD ` +
        `(${options.today} a ${options.maxDate}):`,
      validate: (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
          ? true
          : "Escribe año-mes-día, por ejemplo 2026-10-15.",
    });

    date = date.trim();

    const availability = await api<Availability>(
      `/api/appointments/availability?date=${encodeURIComponent(date)}`
    ).catch((error: unknown) => {
      console.log(
        "\nBot:",
        error instanceof Error
          ? error.message
          : "No se pudo consultar esa fecha."
      );

      return null;
    });

    if (!availability) {
      const retry = await confirm({
        message: "¿Quieres intentar otra vez?",
        default: true,
      });

      if (!retry) return;
      continue;
    }

    const availableSlots = availability.slots.filter(
      (slot) => slot.available
    );

    if (availableSlots.length === 0) {
      console.log(
        "\nBot:",
        availability.message ||
          "Ya no hay horarios de recepción disponibles para esa fecha."
      );

      const anotherDate = await confirm({
        message: "¿Quieres elegir otra fecha?",
        default: true,
      });

      if (!anotherDate) return;
      continue;
    }

    hour = await select<number>({
      message: "Bot: ¿A qué hora quieres traer a tu mascota?",
      choices: availableSlots.map((slot) => ({
        name: slot.label,
        value: slot.hour,
      })),
    });

    hourLabel = availableSlots.find(
      (slot) => slot.hour === hour
    )!.label;

    break;
  }

  const notes = await input({
    message: "Bot: ¿Alguna observación? Puedes dejarla vacía:",
    validate: (value) =>
      value.trim().length <= 1000
        ? true
        : "Escribe un máximo de 1000 caracteres.",
  });

  const pet = options.pets.find((item) => item.id === petId)!;

  const selectedServices = options.services.filter(
    (service) => serviceIds.includes(service.id)
  );

  const minPrice = selectedServices.reduce(
    (sum, service) => sum + service.price_cents,
    0
  );

  const maxPrice = selectedServices.reduce(
    (sum, service) => sum + service.price_max_cents,
    0
  );

  const minDuration = selectedServices.reduce(
    (sum, service) => sum + service.duration_minutes,
    0
  );

  const maxDuration = selectedServices.reduce(
    (sum, service) => sum + service.duration_max_minutes,
    0
  );

  console.log("\nBot: Revisa tu solicitud:");
  console.log(`Mascota: ${pet.name}`);
  console.log(`Fecha: ${date}`);
  console.log(`Recepción: ${hourLabel}`);
  console.log(
    `Servicios: ${selectedServices.map((item) => item.name).join(", ")}`
  );
  console.log(
    `Precio orientativo: ${priceRange(minPrice, maxPrice)}`
  );
  console.log(
    `Duración estimada (horas:minutos): ` +
      `${duration(minDuration)} a ${duration(maxDuration)}`
  );
  console.log(`Observaciones: ${notes.trim() || "Sin observaciones"}`);
  console.log(
    "\nLa hora es de recepción. Puede haber espera mientras termina " +
      "la mascota anterior."
  );
  console.log("El total definitivo se establece al recoger.");
  console.log(
    "La solicitud requiere confirmación del administrador; " +
      "todavía no reserva el horario."
  );

  const accepted = await confirm({
    message: "¿Enviar esta solicitud a la base local?",
    default: false,
  });

  if (!accepted) {
    console.log("\nBot: No se creó ninguna solicitud.");
    return;
  }

  const result = await api<{
    id: number;
    message: string;
  }>("/api/appointments", "POST", {
    pet_id: petId,
    service_ids: serviceIds,
    date,
    hour,
    notes: notes.trim(),
  });

  console.log(`\nBot: ${result.message}`);
  console.log(`Número de solicitud: ${result.id}`);
  console.log(
    "Puedes revisarla en Citas. El administrador podrá confirmarla."
  );
}

try {
  await main();
} catch (error) {
  console.error(
    "\nNo se pudo completar:",
    error instanceof Error ? error.message : "Error inesperado."
  );

  process.exitCode = 1;
} finally {
  if (sessionCookie) {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      console.error(
        "No se pudo cerrar la sesión de prueba en el servidor. " +
          "Caducará según su tiempo de sesión."
      );
    }
  }
}
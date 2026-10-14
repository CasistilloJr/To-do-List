import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

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

type Slot = {
  hour: number;
  label: string;
  available: boolean;
};

type Step = "pet" | "services" | "date" | "hour" | "review";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      data?.message ?? "No se pudo completar la solicitud.",
      response.status
    );
  }

  if (data === null) {
    throw new Error("El servidor devolvió una respuesta inesperada.");
  }

  return data as T;
}

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(cents / 100);
}

function priceRange(min: number, max: number) {
  return min === max ? money(min) : `${money(min)} a ${money(max)}`;
}

function duration(minutes: number) {
  return (
    `${Math.floor(minutes / 60)}:` +
    String(minutes % 60).padStart(2, "0")
  );
}

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

const button =
  "rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white " +
  "hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60";

const secondary =
  "rounded-xl border border-border px-5 py-3 font-semibold " +
  "text-brand-dark hover:bg-brand-soft disabled:opacity-60";

const questions: Record<Step, string> = {
  pet: "Hola. ¿Para cuál de tus mascotas quieres una cita?",
  services: "¿Qué servicios necesita? Puedes seleccionar varios.",
  date: "¿Qué día quieres traerla? Descansamos los domingos.",
  hour: "Estos son los horarios disponibles para recibirla.",
  review: "Revisa los datos antes de enviar tu solicitud.",
};

export default function BookingAssistant() {
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [step, setStep] = useState<Step>("pet");
  const [petId, setPetId] = useState<number | null>(null);
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [uncertain, setUncertain] = useState(false);

  // Impide dos envíos antes de que React actualice la pantalla.
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    api<Options>("/api/appointments/options", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setOptions(data);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudieron cargar tus datos."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [revision]);

  const pet = options?.pets.find((item) => item.id === petId);

  const services =
    options?.services.filter((item) => serviceIds.includes(item.id)) ?? [];

  const minPrice = services.reduce(
    (sum, item) => sum + item.price_cents,
    0
  );

  const maxPrice = services.reduce(
    (sum, item) => sum + item.price_max_cents,
    0
  );

  const minDuration = services.reduce(
    (sum, item) => sum + item.duration_minutes,
    0
  );

  const maxDuration = services.reduce(
    (sum, item) => sum + item.duration_max_minutes,
    0
  );

  function go(next: Step) {
    setError("");
    setInfo("");
    setStep(next);
  }

  function toggleService(id: number) {
    setServiceIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 20
          ? [...current, id]
          : current
    );
  }

  async function loadAvailability() {
    if (!date || busy) return;

    setBusy(true);
    setError("");
    setInfo("");
    setSlot(null);
    setSlots([]);

    try {
      const result = await api<{
        slots: Slot[];
        message: string;
      }>(
        `/api/appointments/availability?date=${encodeURIComponent(date)}`
      );

      const available = result.slots.filter((item) => item.available);

      if (available.length === 0) {
        setInfo(
          result.message ||
            "No quedan horarios disponibles ese día. Elige otra fecha."
        );
        return;
      }

      setSlots(available);
      setStep("hour");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo consultar la disponibilidad."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitAppointment() {
    if (
      submitting.current ||
      uncertain ||
      createdId !== null ||
      !pet ||
      !slot ||
      services.length === 0
    ) {
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");

    try {
      const result = await api<{ id: number; message: string }>(
        "/api/appointments",
        {
          method: "POST",
          body: JSON.stringify({
            pet_id: pet.id,
            service_ids: serviceIds,
            date,
            hour: slot.hour,
            notes: notes.trim(),
          }),
        }
      );

      setCreatedId(result.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status < 500) {
        setError(caught.message);

        if (caught.status === 409) {
          setInfo(
            "Revisa Mis citas antes de repetir la solicitud. " +
              "Si no existe, vuelve a elegir servicios y horario."
          );
        }
      } else {
        // Una interrupción puede ocurrir después de guardar la cita.
        // No repetimos automáticamente la petición.
        setUncertain(true);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (loading) {
    return <p role="status">Preparando el asistente…</p>;
  }

  if (!options) {
    return (
      <div>
        <p role="alert" className="text-danger">
          {error || "No se pudieron cargar tus datos."}
        </p>
        <button
          type="button"
          className={`${secondary} mt-4`}
          onClick={() => setRevision((value) => value + 1)}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (createdId !== null) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl bg-brand-soft p-6">
        <h2 className="text-2xl font-bold text-brand-dark">
          Solicitud enviada
        </h2>
        <p role="status" className="mt-3">
          Tu solicitud #{createdId} para {pet?.name} está pendiente de
          confirmación del administrador.
        </p>
        <p className="mt-2 text-muted">
          El horario todavía no está reservado.
        </p>
        <Link to="/citas" className={`${button} mt-6 inline-block`}>
          Ver mis citas
        </Link>
      </section>
    );
  }

  if (uncertain) {
    return (
      <section className="mx-auto max-w-2xl">
        <h2 className="text-xl font-bold">Comprueba tu solicitud</h2>
        <p role="alert" className="mt-3">
          No pudimos comprobar la respuesta del servidor. La solicitud
          podría haberse guardado. Revisa Mis citas antes de intentarlo
          nuevamente.
        </p>
        <Link to="/citas" className={`${button} mt-5 inline-block`}>
          Revisar mis citas
        </Link>
      </section>
    );
  }

  if (options.pets.length === 0) {
    return (
      <section>
        <p>Primero registra una mascota para solicitar su cita.</p>
        <Link to="/mascotas" className={`${button} mt-4 inline-block`}>
          Ir a Mis mascotas
        </Link>
      </section>
    );
  }

  if (options.services.length === 0) {
    return (
      <p>
        Por ahora no hay servicios disponibles. Contacta al negocio.
      </p>
    );
  }

  return (
    <section className="mx-auto max-w-2xl space-y-5" aria-busy={busy}>
      <div className="flex items-center gap-3">
        <img
          src="/logo-castle-pets.jpeg"
          alt=""
          className="h-12 w-12 rounded-full object-cover"
        />
        <div>
          <h2 className="font-bold text-brand-dark">
            Asistente de Castle Pet’s
          </h2>
          <p className="text-sm text-muted">
            Te acompañamos para solicitar tu cita.
          </p>
        </div>
      </div>

      {pet && step !== "pet" && (
        <div className="ml-6 rounded-2xl rounded-tr-sm bg-brand-dark p-4 text-white">
          <p>Mascota: {pet.name}</p>

          {services.length > 0 && step !== "services" && (
            <p className="mt-2">
              Servicios: {services.map((item) => item.name).join(", ")}
            </p>
          )}

          {(step === "hour" || step === "review") && (
            <p className="mt-2">Fecha: {dateLabel(date)}</p>
          )}

          {step === "review" && slot && (
            <p className="mt-2">Recepción: {slot.label}</p>
          )}
        </div>
      )}

      <div
        aria-live="polite"
        className="mr-6 rounded-2xl rounded-tl-sm bg-brand-soft p-4 text-ink"
      >
        {questions[step]}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      {info && (
        <p role="status" className="rounded-xl bg-brand-soft p-4">
          {info}
        </p>
      )}

      {step === "pet" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {options.pets.map((item) => (
            <button
              type="button"
              key={item.id}
              className={secondary}
              onClick={() => {
                setPetId(item.id);
                go("services");
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      {step === "services" && (
        <div className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="sr-only">Selecciona los servicios</legend>

            {options.services.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4"
              >
                <input
                  type="checkbox"
                  checked={serviceIds.includes(item.id)}
                  disabled={
                    serviceIds.length >= 20 && !serviceIds.includes(item.id)
                  }
                  onChange={() => toggleService(item.id)}
                  className="mt-1 h-5 w-5 accent-[#98146b]"
                />
                <span>
                  <span className="block font-semibold">{item.name}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {priceRange(item.price_cents, item.price_max_cents)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={secondary}
              onClick={() => go("pet")}
            >
              Atrás
            </button>
            <button
              type="button"
              className={button}
              disabled={serviceIds.length === 0}
              onClick={() => go("date")}
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {step === "date" && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void loadAvailability();
          }}
        >
          <label htmlFor="assistant-date" className="block font-semibold">
            Fecha de recepción
          </label>
          <input
            id="assistant-date"
            type="date"
            required
            min={options.today}
            max={options.maxDate}
            value={date}
            disabled={busy}
            onChange={(event) => {
              setDate(event.target.value);
              setSlot(null);
              setInfo("");
              setError("");
            }}
            className="w-full rounded-xl border border-border px-4 py-3"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => go("services")}
            >
              Atrás
            </button>
            <button type="submit" className={button} disabled={busy || !date}>
              {busy ? "Consultando…" : "Consultar horarios"}
            </button>
          </div>
        </form>
      )}

      {step === "hour" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Recibimos una mascota cada hora. Puede haber espera mientras
            terminamos de atender a la anterior.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {slots.map((item) => (
              <button
                type="button"
                key={item.hour}
                className={secondary}
                onClick={() => {
                  setSlot(item);
                  go("review");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={secondary}
            onClick={() => go("date")}
          >
            Elegir otra fecha
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-4">
            <p className="font-semibold">
              Precio orientativo: {priceRange(minPrice, maxPrice)}
            </p>
            <p className="mt-2 text-sm text-muted">
              Duración estimada: {duration(minDuration)} a{" "}
              {duration(maxDuration)} (horas:minutos).
              No incluye una posible espera.
            </p>
            <p className="mt-2 text-sm text-muted">
              El total definitivo se establece al recoger a tu mascota.
            </p>
          </div>

          <label htmlFor="assistant-notes" className="block font-semibold">
            Observaciones opcionales
          </label>
          <textarea
            id="assistant-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            rows={3}
            disabled={busy}
            className="w-full rounded-xl border border-border px-4 py-3"
          />

          <p className="text-sm text-muted">
            Enviar la solicitud no reserva el horario. El administrador
            debe confirmarla.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => {
                setSlot(null);
                go("services");
              }}
            >
              Modificar datos
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void submitAppointment()}
            >
              {busy ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>

          <Link
            to="/citas"
            className="inline-block text-brand-dark underline underline-offset-4"
          >
            Revisar mis citas
          </Link>
        </div>
      )}
    </section>
  );
}
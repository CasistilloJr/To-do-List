import AppointmentTracking from "./AppointmentTracking";
import AdminAppointment from "./AdminAppointment";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type Service = {
  id: number;
  name: string;
  price_cents: number;
  price_max_cents: number;
  duration_minutes: number;
  duration_max_minutes: number;
};

type Item = {
  service_name: string;
  price_cents: number;
  price_max_cents: number;
  duration_min_minutes: number;
  duration_max_minutes: number;
};

type Appointment = {
  id: number;
  starts_at: string;
  status: string;
  notes: string | null;
  pet_name: string;
  owner_name: string;
  services: Item[];
  can_hide: boolean;
};
type Options = {
  pets: { id: number; name: string }[];
  services: Service[];
  today: string;
  maxDate: string;
};

type Slot = {
  hour: number;
  label: string;
  available: boolean;
};

type Props = {
  isAdmin: boolean;
};

const statusNames: Record<string, string> = {
  PENDING: "Pendiente de confirmación",
  CONFIRMED: "Confirmada",
  IN_PROGRESS: "En el establecimiento",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No asistió",
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  dateStyle: "long",
});

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function receptionLabel(value: string) {
  const date = new Date(value);
  const hour = hourFormatter
    .format(date)
    .replace("AM", "a. m.")
    .replace("PM", "p. m.");

  return `${dateFormatter.format(date)}, ${hour}`;
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} h`;

  return `${hours} h ${remainder} min`;
}

function moneyRange(min: number, max: number) {
  const first = money.format(min / 100);
  return min === max
    ? `${first} MXN`
    : `${first}–${money.format(max / 100)} MXN`;
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
    throw new Error(
      response.status === 401
        ? "Tu sesión terminó. Recarga e inicia sesión."
        : data?.message ?? "No se pudo completar la operación."
    );
  }

  return data as T;
}

export default function Appointments({ isAdmin }: Props) {
    const [showHidden, setShowHidden] = useState(false);
  const listPath = `/api/appointments?hidden=${showHidden}`;
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotMessage, setSlotMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [petId, setPetId] = useState("");
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [notes, setNotes] = useState("");

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-4 py-3";

  const buttonClass =
    "rounded-xl border border-brand-dark px-4 py-2 text-brand-dark disabled:opacity-60";

  const reload = useCallback(async () => {
    const data = await api<{ appointments: Appointment[] }>(
      listPath
    );

    setAppointments(data.appointments);
  }, [listPath]);

   useEffect(() => {
    let active = true;

    setLoading(true);
    setAppointments([]);
    setError("");

    api<{ appointments: Appointment[] }>(listPath)
      .then((data) => {
        if (active) {
          setAppointments(data.appointments);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Error al cargar las citas."
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [listPath]);

  useEffect(() => {
    if (!showForm || !date) return;

    let active = true;

    setSlotsLoading(true);
    setSlotMessage("");
    setSlots([]);
    setHour("");

    api<{ slots: Slot[]; message: string }>(
      `/api/appointments/availability?date=${encodeURIComponent(date)}`
    )
      .then((data) => {
        if (!active) return;
        setSlots(data.slots);
        setSlotMessage(data.message);
      })
      .catch((error: unknown) => {
        if (active) {
          setSlotMessage(
            error instanceof Error
              ? error.message
              : "No se pudieron consultar los horarios."
          );
        }
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [date, showForm]);

  async function openForm() {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const data = await api<Options>("/api/appointments/options");

      setOptions(data);
      setPetId("");
      setServiceIds([]);
      setDate(data.today);
      setHour("");
      setNotes("");
      setSlots([]);
      setSlotsLoading(true);
      setShowForm(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Error al abrir.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");

    try {
      await reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Error al actualizar.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!petId || serviceIds.length === 0 || !hour) {
      setError("Selecciona mascota, servicios y horario.");
      return;
    }

    setBusy(true);

    try {
      await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          pet_id: Number(petId),
          service_ids: serviceIds,
          date,
          hour: Number(hour),
          notes,
        }),
      });

      setShowForm(false);
      setSuccess(
        "Solicitud enviada. El horario queda sujeto a confirmación."
      );

      await reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo solicitar.");
    } finally {
      setBusy(false);
    }
  }

    async function changeStatus(
    appointment: Appointment,
    action: "confirm" | "cancel" | "no-show"
  ) {
    if (busy) return;

    const questions = {
      confirm:
        `¿Confirmar la recepción de ${appointment.pet_name} ` +
        `el ${receptionLabel(appointment.starts_at)}?`,

      cancel:
        `¿Cancelar la cita de ${appointment.pet_name}?`,

      "no-show":
        `¿Confirmas que ${appointment.pet_name} no asistió a su cita ` +
        `del ${receptionLabel(appointment.starts_at)}?\n\n` +
        "Hazlo únicamente después de comprobar que no llegó. " +
        "El cambio quedará registrado y contará en las métricas.",
    };

    if (!window.confirm(questions[action])) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await api<{ message: string }>(
        `/api/appointments/${appointment.id}/${action}`,
        { method: "PATCH" }
      );

      setSuccess(result.message);

      try {
        await reload();
      } catch {
        setError(
          "El cambio se guardó, pero no se pudo actualizar la lista. " +
          "Pulsa Actualizar citas."
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo comprobar el resultado. Actualiza las citas antes de reintentar."
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeHistory(
    appointment: Appointment,
    hidden: boolean
  ) {
    if (hidden) {
      const confirmed = window.confirm(
        `¿Ocultar la cita de ${appointment.pet_name} del ${receptionLabel(appointment.starts_at)}? Solo desaparecerá de tu lista. Podrás restaurarla en “Citas ocultas”.`
      );

      if (!confirmed) return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await api<{ message: string }>(
        `/api/appointments/${appointment.id}/history`,
        {
          method: "PATCH",
          body: JSON.stringify({ hidden }),
        }
      );

      setAppointments((current) =>
        current.filter((item) => item.id !== appointment.id)
      );

      setSuccess(result.message);

      await reload();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el historial."
      );
    } finally {
      setBusy(false);
    }
  }

  const selected = options?.services.filter((service) =>
    serviceIds.includes(service.id)
  ) ?? [];

  const priceMin = selected.reduce(
    (total, service) => total + service.price_cents, 0
  );

  const priceMax = selected.reduce(
    (total, service) => total + service.price_max_cents, 0
  );

  const durationMin = selected.reduce(
    (total, service) => total + service.duration_minutes, 0
  );

  const durationMax = selected.reduce(
    (total, service) => total + service.duration_max_minutes, 0
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">
            {isAdmin ? "Administrar citas" : "Mis citas"}
          </h3>
          <p className="mt-1 text-sm text-muted">
            Lunes a sábado, de 10:00 a. m. a 5:30 p. m.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={busy || loading}
            className={buttonClass}
          >
            Actualizar citas
          </button>

          {!isAdmin && !showForm && (
            <button
              type="button"
              onClick={openForm}
              disabled={busy}
              className="rounded-xl bg-brand-dark px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              Solicitar cita
            </button>
          )}
        </div>
      </div>
      <div
        className="mt-4 flex flex-wrap gap-2"
        aria-label="Vista del historial"
      >
        <button
          type="button"
          aria-pressed={!showHidden}
          disabled={busy || loading}
          onClick={() => {
            setSuccess("");
            setShowHidden(false);
          }}
          className={
            buttonClass +
            (!showHidden ? " bg-brand-soft font-semibold" : "")
          }
        >
          Citas visibles
        </button>

        <button
          type="button"
          aria-pressed={showHidden}
          disabled={busy || loading}
          onClick={() => {
            setSuccess("");
            setShowHidden(true);
          }}
          className={
            buttonClass +
            (showHidden ? " bg-brand-soft font-semibold" : "")
          }
        >
          Citas ocultas
        </button>
      </div>

      <p className="mt-2 text-sm text-muted">
        Ocultar una cita solo cambia tu lista. Conserva el
        seguimiento y los cobros. Puedes restaurarla desde
        “Citas ocultas”.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      {success && (
        <p role="status" className="mt-4 rounded-xl bg-success-soft p-4 text-success">
          {success}
        </p>
      )}
      {isAdmin && (
  <AdminAppointment
    onCreated={() => {
      void refresh();
    }}
  />
)}
      {showForm && options && (
        <form
          onSubmit={submit}
          className="mt-5 rounded-2xl bg-brand-soft p-5"
        >
          <fieldset disabled={busy} className="space-y-5">
            <p className="text-sm text-muted">
              La hora seleccionada corresponde a la recepción.
              El servicio puede comenzar después, según las atenciones
              en curso. La hora de entrega se confirmará por separado.
            </p>

            <div>
              <label htmlFor="appointment-pet" className="mb-2 block font-semibold">
                Mascota
              </label>
              <select
                id="appointment-pet"
                required
                value={petId}
                onChange={(event) => setPetId(event.target.value)}
                className={inputClass}
              >
                <option value="">Selecciona una mascota</option>
                {options.pets.map((pet) => (
                  <option key={pet.id} value={pet.id}>{pet.name}</option>
                ))}
              </select>
              {options.pets.length === 0 && (
                <p className="mt-2 text-sm text-muted">
                  Primero registra una mascota en “Mis mascotas”.
                </p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold">Servicios</legend>
              <p className="text-sm text-muted">
                Selecciona servicios complementarios. Evita combinar
                un paquete con servicios que ya incluye.
              </p>
              {options.services.length === 0 && (
                <p>No hay servicios disponibles.</p>
              )}
              {options.services.map((service) => (
                <label
                  key={service.id}
                  className="flex gap-3 rounded-xl border border-border bg-white p-3"
                >
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(service.id)}
                    onChange={(event) => {
                      setServiceIds((current) =>
                        event.target.checked
                          ? [...current, service.id]
                          : current.filter((id) => id !== service.id)
                      );
                    }}
                  />
                  <span>
                    <span className="block font-semibold">{service.name}</span>
                    <span className="text-sm text-muted">
                      {moneyRange(service.price_cents, service.price_max_cents)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {selected.length > 0 && (
              <div className="rounded-xl bg-white p-4">
                <p className="font-semibold">
                  Estimación: {moneyRange(priceMin, priceMax)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Duración de servicios: {durationLabel(durationMin)}
                  {durationMin !== durationMax
                    ? `–${durationLabel(durationMax)}`
                    : ""}. No incluye tiempo de espera.
                </p>
                <p className="mt-1 text-sm text-muted">
                  El precio definitivo se acordará con el negocio.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="appointment-date" className="mb-2 block font-semibold">
                Fecha de recepción
              </label>
              <input
                id="appointment-date"
                type="date"
                required
                min={options.today}
                max={options.maxDate}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setHour("");
                  setSlots([]);
                  setSlotsLoading(true);
                }}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="appointment-hour" className="mb-2 block font-semibold">
                Hora de recepción
              </label>
              <select
                id="appointment-hour"
                required
                disabled={slotsLoading || !date}
                value={hour}
                onChange={(event) => setHour(event.target.value)}
                className={inputClass}
              >
                <option value="">
                  {slotsLoading ? "Consultando horarios…" : "Selecciona una hora"}
                </option>
                {slots.map((slot) => (
                  <option
                    key={slot.hour}
                    value={slot.hour}
                    disabled={!slot.available}
                  >
                    {slot.label}{!slot.available ? " — No disponible" : ""}
                  </option>
                ))}
              </select>
              {slotMessage && (
                <p className="mt-2 text-sm text-muted" role="status">
                  {slotMessage}
                </p>
              )}
              <p className="mt-2 text-sm text-muted">
                Los horarios pendientes no están reservados.
                Espera la confirmación del administrador.
              </p>
            </div>

            <div>
              <label htmlFor="appointment-notes" className="mb-2 block font-semibold">
                Comentarios
              </label>
              <textarea
                id="appointment-notes"
                rows={3}
                maxLength={1000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputClass}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={slotsLoading || !hour || selected.length === 0 || !petId}
                className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Enviando…" : "Enviar solicitud"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className={buttonClass}
              >
                Cerrar formulario
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {loading && <p className="mt-5">Cargando citas…</p>}

      {!loading && appointments.length === 0 && !error && (
        <p className="mt-5 text-muted">
          {showHidden
            ? "No tienes citas ocultas."
            : "No hay citas visibles en tu lista."}
        </p>
      )}

      <div className="mt-5 grid gap-4">
        {appointments.map((appointment) => {
          const min = appointment.services.reduce(
            (total, service) => total + service.price_cents, 0
          );
          const max = appointment.services.reduce(
            (total, service) => total + service.price_max_cents, 0
          );
                    const startsAt = Date.parse(appointment.starts_at);
          const validDate = Number.isFinite(startsAt);
          const future = validDate && startsAt > Date.now();

          const canCancel =
            ["PENDING", "CONFIRMED"].includes(appointment.status) &&
            (isAdmin || future);

          const canMarkNoShow =
            isAdmin &&
            appointment.status === "CONFIRMED" &&
            validDate &&
            startsAt < Date.now();

          return (
            <article
              key={appointment.id}
              className="rounded-2xl border border-border bg-white p-5"
            >
              <p className="font-semibold text-brand-dark">
                {statusNames[appointment.status] ?? appointment.status}
              </p>
              <h4 className="mt-2 text-xl font-bold">
                {appointment.pet_name}
              </h4>

              {isAdmin && (
                <p className="mt-1 text-muted">
                  Cliente: {appointment.owner_name}
                </p>
              )}

              <p className="mt-3 font-semibold">
                Recepción: {receptionLabel(appointment.starts_at)}
              </p>

              <ul className="mt-3 list-inside list-disc text-muted">
                {appointment.services.map((service, index) => (
                  <li key={index}>{service.service_name}</li>
                ))}
              </ul>

              <p className="mt-3">
                Estimación: {moneyRange(min, max)}
              </p>

              {appointment.notes && (
                <p className="mt-3 whitespace-pre-wrap break-words text-muted">
                  Comentarios: {appointment.notes}
                </p>
              )}
              {["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(
  appointment.status
) && (
  <AppointmentTracking
    key={appointment.id}
    appointmentId={appointment.id}
    petName={appointment.pet_name}
    startsAt={appointment.starts_at}
    isAdmin={isAdmin}
    onUpdated={() => {
      void refresh();
    }}
  />
)}
              <div className="mt-4 flex flex-wrap gap-3">
                              {(showHidden || appointment.can_hide) && (
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() =>
                      changeHistory(appointment, !showHidden)
                    }
                    className={buttonClass}
                  >
                    {showHidden ? "Restaurar cita" : "Ocultar cita"}
                  </button>
                )}
                {isAdmin && appointment.status === "PENDING" && future && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(appointment, "confirm")}
                    className="rounded-xl bg-brand-dark px-4 py-2 text-white disabled:opacity-60"
                  >
                    Confirmar recepción
                  </button>
                )}
                                {canMarkNoShow && (
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={() =>
                      void changeStatus(appointment, "no-show")
                    }
                    className="rounded-xl border border-danger px-4 py-2 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60"
                  >
                    Marcar inasistencia
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(appointment, "cancel")}
                    className={buttonClass}
                  >
                    Cancelar cita
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted">
Se muestran hasta 200 citas de la vista seleccionada, ordenadas por fecha de recepción de más reciente a más antigua.
      </p>
    </section>
  );
}
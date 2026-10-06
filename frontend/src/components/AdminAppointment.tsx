import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Customer = {
  id: number;
  name: string;
  phone: string | null;
  active: number;
};

type Pet = {
  id: number;
  name: string;
  active: number;
};

type Service = {
  id: number;
  name: string;
  price_cents: number;
  price_max_cents: number;
  active: number;
};

type Slot = {
  hour: number;
  label: string;
  available: boolean;
};

type Props = {
  onCreated: () => void;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function todayInColima() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
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

export default function AdminAppointment({
  onCreated,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searched, setSearched] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);

  const [pets, setPets] = useState<Pet[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [petId, setPetId] = useState("");
  const [serviceIds, setServiceIds] = useState<number[]>([]);

  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotMessage, setSlotMessage] = useState("");
  const [notes, setNotes] = useState("");

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-4 py-3";

  useEffect(() => {
    if (!open || !date) return;

    let active = true;

    setSlotsLoading(true);
    setSlots([]);
    setHour("");
    setSlotMessage("");

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
  }, [open, date]);

  async function openForm() {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await api<{ services: Service[] }>(
        "/api/services"
      );

      setServices(
        result.services.filter((service) => service.active === 1)
      );

      setCustomer(null);
      setCustomers([]);
      setSearched(false);
      setQuery("");
      setPets([]);
      setPetId("");
      setServiceIds([]);
      setDate(todayInColima());
      setHour("");
      setNotes("");
      setSlots([]);
      setSlotsLoading(true);
      setOpen(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo abrir el formulario."
      );
    } finally {
      setBusy(false);
    }
  }

  async function searchCustomers(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await api<{ customers: Customer[] }>(
        `/api/customers?q=${encodeURIComponent(query.trim())}&page=1`
      );

      setCustomers(
        result.customers.filter((item) => item.active === 1)
      );
      setSearched(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo buscar al cliente."
      );
    } finally {
      setBusy(false);
    }
  }

  async function selectCustomer(selected: Customer) {
    setBusy(true);
    setError("");

    try {
      const result = await api<{
        customer: Customer;
        pets: Pet[];
      }>(`/api/customers/${selected.id}`);

      setCustomer(result.customer);
      setPets(result.pets.filter((pet) => pet.active === 1));
      setPetId("");
      setServiceIds([]);
      setNotes("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar sus mascotas."
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!customer || !petId || !hour || serviceIds.length === 0) {
      setError("Selecciona cliente, mascota, servicios y horario.");
      return;
    }

    const selectedPet = pets.find(
      (pet) => pet.id === Number(petId)
    );

    const selectedSlot = slots.find(
      (slot) => slot.hour === Number(hour)
    );

    if (
      !window.confirm(
        `¿Crear y confirmar la cita de ${selectedPet?.name} para el ${date}, a las ${selectedSlot?.label}?`
      )
    ) {
      return;
    }

    setBusy(true);

    try {
      const result = await api<{ message: string }>(
        "/api/admin-appointments",
        {
          method: "POST",
          body: JSON.stringify({
            customer_id: customer.id,
            pet_id: Number(petId),
            service_ids: serviceIds,
            date,
            hour: Number(hour),
            notes,
          }),
        }
      );

      setOpen(false);
      setSuccess(result.message);
      onCreated();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo crear la cita."
      );
    } finally {
      setBusy(false);
    }
  }

  const selectedServices = services.filter((service) =>
    serviceIds.includes(service.id)
  );

  const minPrice = selectedServices.reduce(
    (sum, service) => sum + service.price_cents,
    0
  );

  const maxPrice = selectedServices.reduce(
    (sum, service) => sum + service.price_max_cents,
    0
  );

  return (
    <section className="mt-5 rounded-2xl border border-border p-4">
      {!open && (
        <button
          type="button"
          onClick={openForm}
          disabled={busy}
          className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Abriendo…" : "Crear cita para un cliente"}
        </button>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-danger-soft p-3 text-danger"
        >
          {error}
        </p>
      )}

      {success && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-success-soft p-3 text-success"
        >
          {success}
        </p>
      )}

      {open && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-bold">
              Nueva cita administrativa
            </h3>

            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="rounded-xl border border-border px-4 py-2"
            >
              Cerrar
            </button>
          </div>

          <p className="text-sm text-muted">
            La cita quedará confirmada al guardarla. La hora corresponde
            a la recepción, no al inicio ni al final del servicio.
          </p>

          <form
            onSubmit={searchCustomers}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-0 flex-1">
              <label
                htmlFor="admin-appointment-search"
                className="mb-2 block font-semibold"
              >
                Buscar cliente
              </label>

              <input
                id="admin-appointment-search"
                required
                maxLength={100}
                placeholder="Nombre, correo o teléfono"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={inputClass}
              />
            </div>

            <button
              disabled={busy}
              className="rounded-xl border border-brand-dark px-4 py-3 text-brand-dark disabled:opacity-60"
            >
              Buscar
            </button>
          </form>

          {searched && customers.length === 0 && (
            <p className="text-sm text-muted">
              No se encontraron clientes activos. Puedes registrar
              uno en “Clientes y mascotas”.
            </p>
          )}

          {customers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Se muestran hasta 50 coincidencias. Afina la búsqueda
                si no encuentras al cliente.
              </p>

              {customers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  onClick={() => selectCustomer(item)}
                  className={`block w-full rounded-xl border p-3 text-left disabled:opacity-60 ${
                    customer?.id === item.id
                      ? "border-brand-dark bg-brand-soft"
                      : "border-border"
                  }`}
                >
                  <span className="block font-semibold">
                    {item.name}
                  </span>
                  <span className="text-sm text-muted">
                    {item.phone || "Sin teléfono"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {customer && (
            <form onSubmit={save}>
              <fieldset disabled={busy} className="space-y-4">
                <p className="rounded-xl bg-brand-soft p-3 font-semibold">
                  Cliente seleccionado: {customer.name}
                </p>

                <div>
                  <label
                    htmlFor="admin-appointment-pet"
                    className="mb-2 block font-semibold"
                  >
                    Mascota
                  </label>

                  <select
                    id="admin-appointment-pet"
                    required
                    value={petId}
                    onChange={(event) => setPetId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Selecciona una mascota</option>
                    {pets.map((pet) => (
                      <option key={pet.id} value={pet.id}>
                        {pet.name}
                      </option>
                    ))}
                  </select>

                  {pets.length === 0 && (
                    <p className="mt-2 text-sm text-muted">
                      Registra o recupera una mascota en “Clientes y mascotas”.
                    </p>
                  )}
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-2 font-semibold">
                    Servicios
                  </legend>

                  {services.length === 0 && (
                    <p>No hay servicios activos.</p>
                  )}

                  {services.map((service) => (
                    <label
                      key={service.id}
                      className="flex gap-3 rounded-xl border border-border p-3"
                    >
                      <input
                        type="checkbox"
                        checked={serviceIds.includes(service.id)}
                        onChange={(event) =>
                          setServiceIds((current) =>
                            event.target.checked
                              ? [...current, service.id]
                              : current.filter((id) => id !== service.id)
                          )
                        }
                      />
                      <span>{service.name}</span>
                    </label>
                  ))}
                </fieldset>

                {selectedServices.length > 0 && (
                  <p className="rounded-xl bg-brand-soft p-3 font-semibold">
                    Estimación: {money.format(minPrice / 100)}
                    {minPrice !== maxPrice
                      ? `–${money.format(maxPrice / 100)}`
                      : ""} MXN
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="admin-appointment-date"
                      className="mb-2 block font-semibold"
                    >
                      Fecha de recepción
                    </label>

                    <input
                      id="admin-appointment-date"
                      type="date"
                      required
                      min={todayInColima()}
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
                    <label
                      htmlFor="admin-appointment-hour"
                      className="mb-2 block font-semibold"
                    >
                      Hora de recepción
                    </label>

                    <select
                      id="admin-appointment-hour"
                      required
                      disabled={slotsLoading || !date}
                      value={hour}
                      onChange={(event) => setHour(event.target.value)}
                      className={inputClass}
                    >
                      <option value="">
                        {slotsLoading
                          ? "Consultando horarios…"
                          : "Selecciona una hora"}
                      </option>

                      {slots.map((slot) => (
                        <option
                          key={slot.hour}
                          value={slot.hour}
                          disabled={!slot.available}
                        >
                          {slot.label}
                          {!slot.available ? " — No disponible" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {slotMessage && (
                  <p role="status" className="text-sm text-muted">
                    {slotMessage}
                  </p>
                )}

                <div>
                  <label
                    htmlFor="admin-appointment-notes"
                    className="mb-2 block font-semibold"
                  >
                    Comentarios de la cita
                  </label>

                  <textarea
                    id="admin-appointment-notes"
                    rows={3}
                    maxLength={1000}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className={inputClass}
                  />

                  <p className="mt-1 text-xs text-muted">
                    Estos comentarios podrán ser visibles para el cliente.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={
                    slotsLoading ||
                    !petId ||
                    !hour ||
                    serviceIds.length === 0
                  }
                  className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "Guardando…" : "Crear y confirmar cita"}
                </button>
              </fieldset>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
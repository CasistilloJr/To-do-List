import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Service = {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  price_max_cents: number;
  duration_minutes: number;
  duration_max_minutes: number;
  active: number;
};

type ServiceForm = {
  name: string;
  description: string;
  price: string;
  duration: string;
};

type Props = {
  isAdmin: boolean;
};

const emptyForm: ServiceForm = {
  name: "",
  description: "",
  price: "",
  duration: "",
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

async function request<T>(
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
        ? "Tu sesión terminó. Recarga la página e inicia sesión."
        : data?.message ?? "No se pudo completar la operación."
    );
  }

  return data as T;
}

function toCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");

  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [pesos, decimals = ""] = normalized.split(".");

  return Number(pesos) * 100 +
    Number(decimals.padEnd(2, "0"));
}

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());

  if (!match) return null;

  const minutes = Number(match[1]) * 60 + Number(match[2]);

  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

function parseRange(
  value: string,
  convert: (value: string) => number | null
): [number, number] | null {
  const parts = value
    .replace(/[–—]/g, "-")
    .split("-")
    .map((part) => part.trim());

  if (parts.length < 1 || parts.length > 2) return null;

  const min = convert(parts[0] ?? "");
  const max = convert(parts[1] ?? parts[0] ?? "");

  if (min === null || max === null || max < min) return null;

  return [min, max];
}

function hoursAndMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return `${hours}:${String(remainder).padStart(2, "0")}`;
}

function inputRange(min: string, max: string) {
  return min === max ? min : `${min}-${max}`;
}

function displayPrice(service: Service) {
  const min = money.format(service.price_cents / 100);
  const max = money.format(service.price_max_cents / 100);

  return service.price_cents === service.price_max_cents
    ? `${min} MXN`
    : `${min}–${max} MXN`;
}

function displayDuration(service: Service) {
  const min = hoursAndMinutes(service.duration_minutes);
  const max = hoursAndMinutes(service.duration_max_minutes);

  return min === max ? `${min} h` : `${min}–${max} h`;
}

export default function ServiceCatalog({ isAdmin }: Props) {
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState<ServiceForm>({ ...emptyForm });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-4 py-3";

  useEffect(() => {
    let active = true;

    request<{ services: Service[] }>("/api/services")
      .then((data) => {
        if (active) setServices(data.services);
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los servicios."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function startNew() {
    setForm({ ...emptyForm });
    setEditingId(null);
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function startEdit(service: Service) {
    setForm({
      name: service.name,
      description: service.description ?? "",
      price: inputRange(
        (service.price_cents / 100).toFixed(2),
        (service.price_max_cents / 100).toFixed(2)
      ),
      duration: inputRange(
        hoursAndMinutes(service.duration_minutes),
        hoursAndMinutes(service.duration_max_minutes)
      ),
    });

    setEditingId(service.id);
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function cancelEdit() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setError("");
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const price = parseRange(form.price, toCents);
    const duration = parseRange(form.duration, toMinutes);

    if (form.name.trim().length < 2) {
      setError("Escribe un nombre de al menos 2 caracteres.");
      return;
    }

    if (!price) {
      setError(
        "Precio inválido. Usa 250 o 200-300, sin separadores de miles. El máximo no puede ser menor que el mínimo."
      );
      return;
    }

    if (!duration) {
      setError(
        "Duración inválida. Usa 1:00 o 1:00-1:30. Debe estar entre 0:01 y 24:00, con el mínimo primero."
      );
      return;
    }

    setBusy(true);

    try {
      const isEditing = editingId !== null;

      const data = await request<{ service: Service }>(
        isEditing ? `/api/services/${editingId}` : "/api/services",
        {
          method: isEditing ? "PUT" : "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim(),
            price_cents: price[0],
            price_max_cents: price[1],
            duration_minutes: duration[0],
            duration_max_minutes: duration[1],
          }),
        }
      );

      setServices((current) =>
        isEditing
          ? current.map((service) =>
              service.id === data.service.id ? data.service : service
            )
          : [...current, data.service]
      );

      setShowForm(false);
      setEditingId(null);
      setForm({ ...emptyForm });

      setSuccess(
        isEditing
          ? "Servicio actualizado correctamente."
          : "Servicio creado correctamente."
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el servicio."
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeAvailability(service: Service) {
    const nextActive = service.active !== 1;

    if (
      !window.confirm(
        nextActive
          ? `¿Activar "${service.name}"?`
          : `¿Desactivar "${service.name}"? Dejará de aparecer para los clientes.`
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const data = await request<{ service: Service }>(
        `/api/services/${service.id}/active`,
        {
          method: "PATCH",
          body: JSON.stringify({ active: nextActive }),
        }
      );

      setServices((current) =>
        current.map((item) =>
          item.id === data.service.id ? data.service : item
        )
      );

      setSuccess(
        nextActive ? "Servicio activado." : "Servicio desactivado."
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo cambiar la disponibilidad."
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="mt-6 text-muted" role="status">
        Cargando servicios…
      </p>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-ink">
            {isAdmin ? "Administrar servicios" : "Servicios disponibles"}
          </h3>
          <p className="mt-1 text-sm text-muted">
            Precios en MXN. Duración estimada en horas y minutos.
          </p>
        </div>

        {isAdmin && !showForm && (
          <button
            type="button"
            onClick={startNew}
            disabled={busy}
            className="rounded-xl bg-brand-dark px-4 py-3 font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            Crear servicio
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-danger-soft p-4 text-danger"
        >
          {error}
        </p>
      )}

      {success && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-success-soft p-4 text-success"
        >
          {success}
        </p>
      )}

      {isAdmin && showForm && (
        <form
          onSubmit={saveService}
          className="mt-5 rounded-2xl border border-border bg-brand-soft p-5"
        >
          <h4 className="mb-5 text-lg font-bold">
            {editingId !== null ? "Editar servicio" : "Crear servicio"}
          </h4>

          <fieldset disabled={busy} className="space-y-4">
            <div>
              <label
                htmlFor="service-name"
                className="mb-2 block font-semibold"
              >
                Nombre *
              </label>
              <input
                id="service-name"
                type="text"
                required
                minLength={2}
                maxLength={100}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="service-description"
                className="mb-2 block font-semibold"
              >
                Descripción
              </label>
              <textarea
                id="service-description"
                rows={4}
                maxLength={1500}
                placeholder="Describe qué incluye y de qué dependen el precio y la duración."
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                className={inputClass}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="service-price"
                  className="mb-2 block font-semibold"
                >
                  Precio o rango en MXN *
                </label>
                <input
                  id="service-price"
                  type="text"
                  required
                  maxLength={25}
                  placeholder="200-300"
                  aria-describedby="price-help"
                  value={form.price}
                  onChange={(event) =>
                    setForm({ ...form, price: event.target.value })
                  }
                  className={inputClass}
                />
                <p id="price-help" className="mt-1 text-sm text-muted">
                  Ejemplos: 250, 250.50 o 200-300.
                </p>
              </div>

              <div>
                <label
                  htmlFor="service-duration"
                  className="mb-2 block font-semibold"
                >
                  Duración o rango *
                </label>
                <input
                  id="service-duration"
                  type="text"
                  required
                  maxLength={20}
                  placeholder="1:00-1:30"
                  aria-describedby="duration-help"
                  value={form.duration}
                  onChange={(event) =>
                    setForm({ ...form, duration: event.target.value })
                  }
                  className={inputClass}
                />
                <p id="duration-help" className="mt-1 text-sm text-muted">
                  Horas:minutos. Ejemplos: 0:30, 1:00 o 1:00-1:30.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {busy ? "Guardando…" : "Guardar servicio"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-xl border border-brand-dark px-5 py-3 text-brand-dark"
              >
                Cancelar
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {!showForm && services.length === 0 && !error && (
        <p className="mt-5 rounded-2xl bg-brand-soft p-6 text-center text-muted">
          {isAdmin
            ? "Todavía no has creado servicios."
            : "Por ahora no hay servicios disponibles."}
        </p>
      )}

      {!showForm && services.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[...services]
            .sort(
              (a, b) =>
                b.active - a.active ||
                a.name.localeCompare(b.name, "es")
            )
            .map((service) => (
              <article
                key={service.id}
                className="min-w-0 rounded-2xl border border-border bg-white p-5"
              >
                {isAdmin && (
                  <span
                    className={
                      service.active === 1
                        ? "inline-block rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success"
                        : "inline-block rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning"
                    }
                  >
                    {service.active === 1 ? "Activo" : "Inactivo"}
                  </span>
                )}

                <h4 className="mt-3 break-words text-xl font-bold">
                  {service.name}
                </h4>

                {service.description && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-muted">
                    {service.description}
                  </p>
                )}

                <p className="mt-5 text-2xl font-bold text-brand-dark">
                  {displayPrice(service)}
                </p>

                <p className="mt-2 text-sm text-muted">
                  Duración estimada: {displayDuration(service)}
                </p>

                {service.price_cents !== service.price_max_cents && (
                  <p className="mt-2 text-sm text-muted">
                    Precio final por confirmar según las características
                    y necesidades de tu mascota.
                  </p>
                )}

                {isAdmin && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(service)}
                      className="rounded-lg border border-brand-dark px-4 py-2 text-brand-dark disabled:opacity-60"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => changeAvailability(service)}
                      className="rounded-lg border border-border px-4 py-2 text-muted disabled:opacity-60"
                    >
                      {service.active === 1 ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                )}
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Customer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  active: number;
  portal_enabled: number;
};

type Pet = {
  id: number;
  name: string;
  species: string;
  breed: string | null;
  birth_date: string | null;
  notes: string | null;
  active: number;
};

type Visit = {
  id: number;
  starts_at: string;
  status: string;
  pet_name: string;
  service_names: string | null;
};

type Detail = {
  customer: Customer;
  pets: Pet[];
  visits: Visit[];
};

const emptyContact = { name: "", phone: "", email: "" };

const emptyPet = {
  name: "",
  species: "Perro",
  breed: "",
  birth_date: "",
  notes: "",
};

const statuses: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  IN_PROGRESS: "En el establecimiento",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No asistió",
};

async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ?? "No se pudo completar la operación."
    );
  }

  return data as T;
}

function formatMoment(value: string) {
  const date = new Date(value);

  const day = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
  }).format(date);

  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace("AM", "a. m.")
    .replace("PM", "p. m.");

  return `${day}, ${hour}`;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [contact, setContact] = useState({ ...emptyContact });
  const [pet, setPet] = useState({ ...emptyPet });

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-3 py-2.5";

  const buttonClass =
    "rounded-xl border border-brand-dark px-4 py-2 text-brand-dark disabled:opacity-60";

  useEffect(() => {
    let active = true;

    api<{
      customers: Customer[];
      has_more: boolean;
    }>("/api/customers")
      .then((data) => {
        if (!active) return;
        setCustomers(data.customers);
        setHasMore(data.has_more);
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error ? error.message : "Error al cargar."
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

  async function loadList(search: string, nextPage: number) {
    const params = new URLSearchParams({
      q: search,
      page: String(nextPage),
    });

    const data = await api<{
      customers: Customer[];
      has_more: boolean;
    }>(`/api/customers?${params.toString()}`);

    setCustomers(data.customers);
    setHasMore(data.has_more);
    setPage(nextPage);
    setAppliedQuery(search);
  }

  async function search(searchText: string, nextPage: number) {
    setBusy(true);
    setError("");

    try {
      await loadList(searchText, nextPage);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Error al buscar.");
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(id: number) {
    const data = await api<Detail>(`/api/customers/${id}`);

    setDetail(data);
    setContact({
      name: data.customer.name,
      phone: data.customer.phone ?? "",
      email: data.customer.email ?? "",
    });
    setShowContact(true);
  }

  async function openCustomer(id: number) {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await loadDetail(id);
      setPet({ ...emptyPet });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Error al abrir.");
    } finally {
      setBusy(false);
    }
  }

  function newCustomer() {
    setDetail(null);
    setContact({ ...emptyContact });
    setPet({ ...emptyPet });
    setError("");
    setSuccess("");
    setShowContact(true);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const data = await api<{ customer: Customer }>(
        detail ? `/api/customers/${detail.customer.id}` : "/api/customers",
        {
          method: detail ? "PUT" : "POST",
          body: JSON.stringify(contact),
        }
      );

      // Conserva el identificador inmediatamente para evitar
      // que un fallo de actualización provoque crear otra ficha.
      setDetail((current) => ({
        customer: data.customer,
        pets: current?.pets ?? [],
        visits: current?.visits ?? [],
      }));

      setSuccess("Ficha guardada correctamente.");

      try {
        await loadList(appliedQuery, page);
      } catch {
        setError(
          "La ficha se guardó, pero no se pudo actualizar el directorio. Vuelve a buscarla."
        );
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function savePet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await api(`/api/customers/${detail.customer.id}/pets`, {
        method: "POST",
        body: JSON.stringify(pet),
      });

      setPet({ ...emptyPet });
      setSuccess("Mascota registrada.");

      try {
        await loadDetail(detail.customer.id);
      } catch {
        setError(
          "La mascota se guardó. Reabre la ficha para verla; no la registres otra vez."
        );
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function restorePet(selectedPet: Pet) {
    if (!detail) return;

    if (!window.confirm(`¿Recuperar a ${selectedPet.name}?`)) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await api(
        `/api/customers/${detail.customer.id}/pets/${selectedPet.id}/restore`,
        { method: "PATCH" }
      );

      setDetail((current) =>
        current
          ? {
              ...current,
              pets: current.pets.map((item) =>
                item.id === selectedPet.id ? { ...item, active: 1 } : item
              ),
            }
          : current
      );

      setSuccess("Mascota recuperada.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo recuperar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      {success && (
        <p role="status" className="rounded-xl bg-success-soft p-4 text-success">
          {success}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search(query, 1);
          }}
          className="flex min-w-0 flex-1 gap-2"
        >
          <input
            aria-label="Buscar por nombre, correo o teléfono"
            placeholder="Nombre, correo o teléfono"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={inputClass}
          />
          <button disabled={busy || loading} className={buttonClass}>
            Buscar
          </button>
        </form>

        <button
          type="button"
          onClick={newCustomer}
          disabled={busy || loading}
          className="rounded-xl bg-brand-dark px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          Nuevo cliente
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-3">
          {loading && <p role="status">Cargando clientes…</p>}

          {!loading && customers.length === 0 && (
            <p className="text-muted">No se encontraron clientes.</p>
          )}

          {customers.map((customer) => (
            <button
              key={customer.id}
              type="button"
              disabled={busy}
              onClick={() => openCustomer(customer.id)}
              className={`w-full rounded-xl border p-4 text-left disabled:opacity-60 ${
                detail?.customer.id === customer.id
                  ? "border-brand-dark bg-brand-soft"
                  : "border-border bg-white"
              }`}
            >
              <span className="block font-semibold">{customer.name}</span>
              <span className="mt-1 block text-sm text-muted">
                {customer.phone || "Sin teléfono"}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {customer.portal_enabled === 1 ? "Cuenta web" : "Sin acceso web"}
                {customer.active === 0 ? " · Inactivo" : ""}
              </span>
            </button>
          ))}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={busy || loading || page === 1}
              onClick={() => search(appliedQuery, page - 1)}
              className={buttonClass}
            >
              Anterior
            </button>
            <span className="text-sm">{page}</span>
            <button
              type="button"
              disabled={busy || loading || !hasMore}
              onClick={() => search(appliedQuery, page + 1)}
              className={buttonClass}
            >
              Siguiente
            </button>
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          {!showContact && (
            <p className="rounded-xl bg-brand-soft p-5">
              Selecciona un cliente o crea una ficha nueva.
            </p>
          )}

          {showContact && (
            <form onSubmit={saveContact} className="rounded-2xl border border-border p-5">
              <h2 className="mb-4 text-xl font-bold">
                {detail ? "Datos del cliente" : "Nuevo cliente"}
              </h2>

              <fieldset disabled={busy} className="space-y-4">
                <div>
                  <label htmlFor="customer-name" className="mb-2 block font-semibold">
                    Nombre completo
                  </label>
                  <input
                    id="customer-name"
                    required
                    minLength={2}
                    maxLength={100}
                    value={contact.name}
                    onChange={(event) =>
                      setContact({ ...contact, name: event.target.value })
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="customer-phone" className="mb-2 block font-semibold">
                    Teléfono de 10 dígitos
                  </label>
                  <input
                    id="customer-phone"
                    type="tel"
                    inputMode="numeric"
                    required
                    pattern="[0-9]{10}"
                    maxLength={10}
                    value={contact.phone}
                    onChange={(event) =>
                      setContact({
                        ...contact,
                        phone: event.target.value.replace(/\D/g, "").slice(0, 10),
                      })
                    }
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="customer-email" className="mb-2 block font-semibold">
                    Correo electrónico — opcional
                  </label>
                  <input
                    id="customer-email"
                    type="email"
                    maxLength={254}
                    disabled={detail?.customer.portal_enabled === 1}
                    value={contact.email}
                    onChange={(event) =>
                      setContact({ ...contact, email: event.target.value })
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {detail?.customer.portal_enabled === 1
                      ? "El correo de acceso requiere verificación para cambiarse."
                      : "Registrar un correo no activa el acceso al portal."}
                  </p>
                </div>

                <button className="rounded-xl bg-brand-dark px-4 py-3 font-semibold text-white">
                  Guardar cliente
                </button>
              </fieldset>
            </form>
          )}

          {detail && (
            <>
              <section className="space-y-3">
                <h2 className="text-xl font-bold">Mascotas del cliente</h2>

                {detail.pets.length === 0 && (
                  <p className="text-muted">Todavía no tiene mascotas registradas.</p>
                )}

                {detail.pets.map((item) => (
                  <article key={item.id} className="rounded-xl border border-border p-4">
                    <h3 className="font-bold">{item.name}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {item.species} · {item.breed || "Sin raza registrada"}
                    </p>
                    {item.birth_date && (
                      <p className="mt-1 text-sm text-muted">
                        Nacimiento: {item.birth_date.split("-").reverse().join("/")}
                      </p>
                    )}
                    {item.notes && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                        {item.notes}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted">
                      {item.active === 1 ? "Activa" : "Archivada"}
                    </p>
                    {item.active === 0 && detail.customer.active === 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => restorePet(item)}
                        className={`mt-3 ${buttonClass}`}
                      >
                        Recuperar mascota
                      </button>
                    )}
                  </article>
                ))}
              </section>

              {detail.customer.active === 1 && (
                <form onSubmit={savePet} className="rounded-2xl bg-brand-soft p-5">
                  <h2 className="mb-4 text-xl font-bold">Registrar mascota</h2>

                  <fieldset disabled={busy} className="space-y-4">
                    <div>
                      <label htmlFor="admin-pet-name" className="mb-2 block font-semibold">
                        Nombre
                      </label>
                      <input
                        id="admin-pet-name"
                        required
                        maxLength={80}
                        value={pet.name}
                        onChange={(event) => setPet({ ...pet, name: event.target.value })}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="admin-pet-species" className="mb-2 block font-semibold">
                        Especie
                      </label>
                      <select
                        id="admin-pet-species"
                        value={pet.species}
                        onChange={(event) => setPet({ ...pet, species: event.target.value })}
                        className={inputClass}
                      >
                        <option>Perro</option>
                        <option>Gato</option>
                        <option>Otro</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="admin-pet-breed" className="mb-2 block font-semibold">
                        Raza — opcional
                      </label>
                      <input
                        id="admin-pet-breed"
                        maxLength={100}
                        value={pet.breed}
                        onChange={(event) => setPet({ ...pet, breed: event.target.value })}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="admin-pet-birth" className="mb-2 block font-semibold">
                        Nacimiento — opcional
                      </label>
                      <input
                        id="admin-pet-birth"
                        type="date"
                        value={pet.birth_date}
                        onChange={(event) => setPet({ ...pet, birth_date: event.target.value })}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="admin-pet-notes" className="mb-2 block font-semibold">
                        Observaciones
                      </label>
                      <textarea
                        id="admin-pet-notes"
                        rows={3}
                        maxLength={1500}
                        value={pet.notes}
                        onChange={(event) => setPet({ ...pet, notes: event.target.value })}
                        className={inputClass}
                      />
                      <p className="mt-1 text-xs text-muted">
                        Estas observaciones forman parte de la ficha visible al propietario.
                      </p>
                    </div>

                    <button className="rounded-xl bg-brand-dark px-4 py-3 font-semibold text-white">
                      Guardar mascota
                    </button>
                  </fieldset>
                </form>
              )}

              <section>
                <h2 className="text-xl font-bold">Historial de citas y servicios</h2>
                <p className="mt-1 text-xs text-muted">Hasta 50 citas, de más reciente a más antigua.</p>

                {detail.visits.length === 0 ? (
                  <p className="mt-3 text-muted">No tiene citas registradas.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {detail.visits.map((visit) => (
                      <article key={visit.id} className="rounded-xl border border-border p-4">
                        <p className="font-semibold">
                          #{visit.id} · {visit.pet_name}
                        </p>
                        <p className="mt-1 text-sm">{formatMoment(visit.starts_at)}</p>
                        <p className="mt-1 text-sm text-brand-dark">
                          {statuses[visit.status] ?? visit.status}
                        </p>
                        <p className="mt-2 text-sm text-muted">
                          {visit.service_names || "Sin servicios registrados"}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
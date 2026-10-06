import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Pet = {
  id: number;
  name: string;
  species: string;
  breed: string | null;
  birth_date: string | null;
  notes: string | null;
};

type PetForm = {
  name: string;
  species: string;
  breed: string;
  birth_date: string;
  notes: string;
};

const emptyForm: PetForm = {
  name: "",
  species: "Perro",
  breed: "",
  birth_date: "",
  notes: "",
};

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

function displayDate(value: string | null) {
  if (!value) return "Sin registrar";

  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default function MyPets() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [form, setForm] = useState<PetForm>({ ...emptyForm });
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

    request<{ pets: Pet[] }>("/api/pets")
      .then((data) => {
        if (active) setPets(data.pets);
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las mascotas."
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

  function startEdit(pet: Pet) {
    setForm({
      name: pet.name,
      species: pet.species,
      breed: pet.breed ?? "",
      birth_date: pet.birth_date ?? "",
      notes: pet.notes ?? "",
    });

    setEditingId(pet.id);
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

  async function savePet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError("Escribe el nombre de la mascota.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const isEditing = editingId !== null;

      const data = await request<{ pet: Pet }>(
        isEditing ? `/api/pets/${editingId}` : "/api/pets",
        {
          method: isEditing ? "PUT" : "POST",
          body: JSON.stringify(form),
        }
      );

      setPets((current) =>
        isEditing
          ? current.map((pet) =>
              pet.id === data.pet.id ? data.pet : pet
            )
          : [...current, data.pet]
      );

      setShowForm(false);
      setEditingId(null);
      setForm({ ...emptyForm });

      setSuccess(
        isEditing
          ? "Datos actualizados correctamente."
          : "Mascota registrada correctamente."
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la mascota."
      );
    } finally {
      setBusy(false);
    }
  }

  async function archivePet(pet: Pet) {
    const confirmed = window.confirm(
      `¿Archivar a ${pet.name}? Dejará de aparecer en tu lista activa, pero se conservará su historial.`
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      await request<{ message: string }>(
        `/api/pets/${pet.id}/archive`,
        { method: "PATCH" }
      );

      setPets((current) =>
        current.filter((item) => item.id !== pet.id)
      );

      setSuccess(`${pet.name} fue archivado correctamente.`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo archivar la mascota."
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="mt-6 text-muted" role="status">
        Cargando tus mascotas…
      </p>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-bold text-ink">
          Mis mascotas
        </h3>

        {!showForm && (
          <button
            type="button"
            onClick={startNew}
            disabled={busy}
            className="rounded-xl bg-brand-dark px-4 py-3 font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            Registrar mascota
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

      {showForm && (
        <form
          onSubmit={savePet}
          className="mt-5 rounded-2xl border border-border bg-brand-soft p-5"
        >
          <h4 className="mb-5 text-lg font-bold">
            {editingId !== null
              ? "Editar mascota"
              : "Registrar mascota"}
          </h4>

          <fieldset disabled={busy} className="space-y-4">
            <div>
              <label
                htmlFor="pet-name"
                className="mb-2 block font-semibold"
              >
                Nombre *
              </label>

              <input
                id="pet-name"
                type="text"
                required
                maxLength={80}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="pet-species"
                className="mb-2 block font-semibold"
              >
                Especie *
              </label>

              <select
                id="pet-species"
                value={form.species}
                onChange={(event) =>
                  setForm({ ...form, species: event.target.value })
                }
                className={inputClass}
              >
                <option value="Perro">Perro</option>
                <option value="Gato">Gato</option>
                <option value="Otro">Otro</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="pet-breed"
                className="mb-2 block font-semibold"
              >
                Raza
              </label>

              <input
                id="pet-breed"
                type="text"
                maxLength={100}
                placeholder="Por ejemplo: Pomerania o mestizo"
                value={form.breed}
                onChange={(event) =>
                  setForm({ ...form, breed: event.target.value })
                }
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="pet-birth"
                className="mb-2 block font-semibold"
              >
                Fecha de nacimiento
              </label>

              <input
                id="pet-birth"
                type="date"
                value={form.birth_date}
                onChange={(event) =>
                  setForm({
                    ...form,
                    birth_date: event.target.value,
                  })
                }
                className={inputClass}
              />

              <p className="mt-1 text-sm text-muted">
                Déjala vacía si no conoces la fecha.
              </p>
            </div>

            <div>
              <label
                htmlFor="pet-notes"
                className="mb-2 block font-semibold"
              >
                Observaciones
              </label>

              <textarea
                id="pet-notes"
                rows={4}
                maxLength={1500}
                placeholder="Cuéntanos si necesita algún cuidado especial."
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
                className={inputClass}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {busy ? "Guardando…" : "Guardar mascota"}
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

      {!showForm && pets.length === 0 && !error && (
        <div className="mt-5 rounded-2xl bg-brand-soft p-6 text-center">
          <p className="font-semibold">
            No tienes mascotas activas registradas.
          </p>
          <p className="mt-2 text-muted">
            Pulsa “Registrar mascota” para agregar una.
          </p>
        </div>
      )}

      {!showForm && pets.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[...pets]
            .sort((a, b) => a.name.localeCompare(b.name, "es"))
            .map((pet) => (
              <article
                key={pet.id}
                className="min-w-0 rounded-2xl border border-border bg-white p-5"
              >
                <p className="text-sm font-semibold text-brand-dark">
                  {pet.species}
                </p>

                <h4 className="mt-1 break-words text-xl font-bold">
                  {pet.name}
                </h4>

                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-semibold">Raza</dt>
                    <dd className="break-words text-muted">
                      {pet.breed || "Sin registrar"}
                    </dd>
                  </div>

                  <div>
                    <dt className="font-semibold">Nacimiento</dt>
                    <dd className="text-muted">
                      {displayDate(pet.birth_date)}
                    </dd>
                  </div>

                  {pet.notes && (
                    <div>
                      <dt className="font-semibold">Observaciones</dt>
                      <dd className="whitespace-pre-wrap break-words text-muted">
                        {pet.notes}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(pet)}
                    className="rounded-lg border border-brand-dark px-4 py-2 text-brand-dark disabled:opacity-60"
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => archivePet(pet)}
                    className="rounded-lg border border-border px-4 py-2 text-muted disabled:opacity-60"
                  >
                    Archivar
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
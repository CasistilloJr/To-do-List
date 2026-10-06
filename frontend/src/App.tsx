import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Customers from "./components/Customers";
import Sales from "./components/Sales";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  Users,
  Banknote,
  CalendarDays,
  ChevronLeft,
  Home,
  LogOut,
  Menu,
  PawPrint,
  Scissors,
  UserRound,
} from "lucide-react";

import ActivateAccount from "./components/ActivateAccount";
import Register from "./components/Register";
import MyPets from "./components/MyPets";
import ServiceCatalog from "./components/ServiceCatalog";
import Appointments from "./components/Appointments";

type User = {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "CLIENT";
};

type Summary = {
  clients: number;
  pets: number;
  pendingAppointments: number;
};

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

  return data as T;
}

// El router se coloca una sola vez.
export default function App() {
  return (
    <BrowserRouter>
      <Application />
    </BrowserRouter>
  );
}

function Application() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Abierto en computadora; cerrado inicialmente en pantallas pequeñas.
  const [menuExpanded, setMenuExpanded] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches
  );

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const result = await api<{ user: User }>("/api/auth/me");

        if (active) {
          setUser(result.user);
        }
      } catch (error) {
        if (
          active &&
          !(error instanceof ApiError && error.status === 401)
        ) {
          setError("No se pudo conectar con el servidor.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void checkSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setPassword("");
      setUser(result.user);
      navigate("/inicio", { replace: true });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar sesión."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError("");

    try {
      await api("/api/auth/logout", {
        method: "POST",
      });

      setUser(null);
      setPassword("");
      setSuccess("");
      navigate("/login", { replace: true });
    } catch {
      setError("No se pudo cerrar la sesión. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  function closeMobileMenu() {
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setMenuExpanded(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-soft">
        <p role="status">Comprobando sesión…</p>
      </main>
    );
  }
    if (
    location.pathname === "/solicitar-acceso" ||
    location.pathname === "/activar-cuenta"
  ) {
    return (
      <ActivateAccount
        key={location.pathname + location.hash}
        mode={
          location.pathname === "/solicitar-acceso"
            ? "request"
            : "confirm"
        }
        signedIn={Boolean(user)}
      />
    );
  }

  // PANTALLAS SIN SESIÓN
  if (!user) {
    return (
      <Routes>
        <Route
          path="/registro"
          element={
            <Register
              onBack={() => {
                setError("");
                navigate("/login");
              }}
              onRegistered={(registeredEmail) => {
                setEmail(registeredEmail);
                setPassword("");
                setError("");
                setSuccess(
                  "Tu cuenta fue creada. Inicia sesión para continuar."
                );
                navigate("/login", { replace: true });
              }}
            />
          }
        />

        <Route
          path="/login"
          element={
            <main className="flex min-h-screen items-center justify-center bg-brand-soft px-4 py-10">
              <section className="w-full max-w-md rounded-3xl border border-border bg-white p-7 shadow-sm">
                <img
                  src="/logo-castle-pets.jpeg"
                  alt="Castle Pet’s"
                  className="mx-auto h-28 w-28 rounded-full object-cover"
                />

                <h1 className="mt-5 text-center text-3xl font-bold text-ink">
                  Castle Pet’s
                </h1>

                <p className="mt-2 text-center text-muted">
                  Ingresa a tu cuenta.
                </p>

                {error && (
                  <p
                    role="alert"
                    className="mt-5 rounded-xl bg-danger-soft p-3 text-danger"
                  >
                    {error}
                  </p>
                )}

                {success && (
                  <p
                    role="status"
                    className="mt-5 rounded-xl bg-success-soft p-3 text-success"
                  >
                    {success}
                  </p>
                )}

                <form
                  onSubmit={handleLogin}
                  className="mt-6 space-y-5"
                >
                  <div>
                    <label
                      htmlFor="login-email"
                      className="mb-2 block font-semibold"
                    >
                      Correo electrónico
                    </label>

                    <input
                      id="login-email"
                      type="email"
                      autoComplete="username"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full rounded-xl border border-border px-4 py-3"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="mb-2 block font-semibold"
                    >
                      Contraseña
                    </label>

                    <input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-xl border border-border px-4 py-3"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                  >
                    {busy ? "Ingresando…" : "Entrar"}
                  </button>
                </form>
                                <div className="mt-5 text-center">
                  <p className="text-sm text-muted">
                    ¿El negocio ya registró tus mascotas?
                  </p>

                  <Link
                    to="/solicitar-acceso"
                    className="mt-2 inline-block font-semibold text-brand-dark underline underline-offset-4"
                  >
                    Activar mi acceso
                  </Link>
                </div>
                
                <div className="mt-6 border-t border-border pt-5 text-center">
                  <p className="text-muted">
                    ¿Todavía no tienes una cuenta?
                  </p>

                  <Link
                    to="/registro"
                    onClick={() => {
                      setError("");
                      setSuccess("");
                    }}
                    className="mt-3 inline-block font-semibold text-brand-dark underline underline-offset-4"
                  >
                    Crear cuenta
                  </Link>
                </div>
              </section>
            </main>
          }
        />

        <Route
          path="*"
          element={<Navigate to="/login" replace />}
        />
      </Routes>
    );
  }

  const isAdmin = user.role === "ADMIN";

 const navigation = [
  {
    path: "/inicio",
    label: "Inicio",
    icon: Home,
  },
  ...(!isAdmin
    ? [
        {
          path: "/mascotas",
          label: "Mis mascotas",
          icon: PawPrint,
        },
      ]
    : []),
  {
    path: "/servicios",
    label: "Servicios",
    icon: Scissors,
  },
  {
    path: "/citas",
    label: isAdmin ? "Citas y seguimiento" : "Mis citas",
    icon: CalendarDays,
  },
 
 ...(isAdmin
  ? [
      {
        path: "/clientes",
        label: "Clientes y mascotas",
        icon: Users,
      },
      {
        path: "/ventas",
        label: "Ventas y cobros",
        icon: Banknote,
      },
    ]
  : []),
];
  const currentTitle =
    navigation.find((item) => item.path === location.pathname)?.label ??
    "Castle Pet’s";

  // PANEL CON SESIÓN
  return (
    <div className="min-h-screen bg-brand-soft">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:p-4"
      >
        Ir al contenido
      </a>

      <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-3 border-b border-border bg-white px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuExpanded((current) => !current)}
            aria-label={menuExpanded ? "Contraer menú" : "Desplegar menú"}
            aria-expanded={menuExpanded}
            aria-controls="main-navigation"
            className="rounded-xl border border-border p-2.5 text-brand-dark hover:bg-brand-soft"
          >
            {menuExpanded ? (
              <ChevronLeft size={22} aria-hidden="true" />
            ) : (
              <Menu size={22} aria-hidden="true" />
            )}
          </button>

          <Link to="/inicio" className="flex min-w-0 items-center gap-3">
            <img
              src="/logo-castle-pets.jpeg"
              alt=""
              className="h-12 w-12 rounded-full object-cover"
            />

            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-brand-dark">
                Castle Pet’s
              </p>
              <p className="text-xs text-muted">
                {isAdmin ? "Administración" : "Portal de clientes"}
              </p>
            </div>
          </Link>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <UserRound
            size={20}
            className="shrink-0 text-brand-dark"
            aria-hidden="true"
          />
          <span className="hidden max-w-48 truncate text-sm font-semibold sm:block">
            {user.name}
          </span>
        </div>
      </header>

      <div
        className={
          menuExpanded
            ? "grid lg:grid-cols-[16rem_minmax(0,1fr)]"
            : "grid lg:grid-cols-[5rem_minmax(0,1fr)]"
        }
      >
        <aside
          id="main-navigation"
          className={[
            menuExpanded ? "block" : "hidden lg:block",
            "border-b border-border bg-white lg:sticky lg:top-20 lg:h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r",
          ].join(" ")}
        >
          <div className="flex h-full flex-col p-3">
            {menuExpanded && (
              <p className="px-3 pb-3 pt-2 text-xs font-semibold uppercase tracking-widest text-muted">
                Menú principal
              </p>
            )}

            <nav aria-label="Navegación principal" className="space-y-2">
              {navigation.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end
                    onClick={closeMobileMenu}
                    title={item.label}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      [
                        "flex items-center gap-3 rounded-xl px-3 py-3 font-semibold",
                        !menuExpanded ? "justify-center" : "",
                        isActive
                          ? "bg-brand-dark text-white"
                          : "text-muted hover:bg-brand-soft hover:text-brand-dark",
                      ].join(" ")
                    }
                  >
                    <Icon size={21} className="shrink-0" aria-hidden="true" />
                    {menuExpanded && <span>{item.label}</span>}
                  </NavLink>
                );
              })}
            </nav>

            <div className="mt-6 border-t border-border pt-4 lg:mt-auto">
              {menuExpanded && (
                <div className="mb-4 rounded-xl bg-brand-soft p-3">
                  <p className="truncate text-sm font-semibold">{user.name}</p>
                  <p className="mt-1 break-words text-xs text-muted">
                    {user.email}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleLogout}
                disabled={busy}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className={[
                  "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-danger hover:bg-danger-soft disabled:opacity-60",
                  !menuExpanded ? "justify-center" : "",
                ].join(" ")}
              >
                <LogOut size={21} className="shrink-0" aria-hidden="true" />
                {menuExpanded && (
                  <span>{busy ? "Cerrando…" : "Cerrar sesión"}</span>
                )}
              </button>
            </div>
          </div>
        </aside>

        <main id="main-content" className="min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm text-muted">
              {isAdmin ? "Panel administrativo" : "Mi cuenta"}
            </p>

            <h1 className="mt-1 text-3xl font-bold text-ink">
              {currentTitle}
            </h1>

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-xl bg-danger-soft p-4 text-danger"
              >
                {error}
              </p>
            )}

            <div className="mt-6 rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-6">
              <Routes>
                <Route
                  path="/inicio"
                  element={<Dashboard key={user.id} user={user} />}
                />

                {!isAdmin && (
                  <Route
                    path="/mascotas"
                    element={<MyPets key={user.id} />}
                  />
                )}

                <Route
                  path="/servicios"
                  element={
                    <ServiceCatalog
                      key={`services-${user.id}`}
                      isAdmin={isAdmin}
                    />
                  }
                />

                <Route
                  path="/citas"
                  element={
                    <Appointments
                      key={`appointments-${user.id}`}
                      isAdmin={isAdmin}
                    />
                  }
                />
                {isAdmin && (
  <Route
    path="/ventas"
    element={<Sales key={`sales-${user.id}`} />}
  />
)}
              {isAdmin && (
  <Route
    path="/clientes"
    element={<Customers key={`customers-${user.id}`} />}
  />
)}

                <Route
                  path="*"
                  element={<Navigate to="/inicio" replace />}
                />
              </Routes>
            </div>

            <footer className="py-6 text-center text-xs text-muted">
              Castle Pet’s · Colima
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function Dashboard({ user }: { user: User }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  const isAdmin = user.role === "ADMIN";

  useEffect(() => {
    if (!isAdmin) return;

    let active = true;

    setSummary(null);
    setError("");

    api<Summary>("/api/admin/summary")
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el resumen."
          );
        }
      });

    return () => {
      active = false;
    };
  }, [isAdmin, revision]);

  return (
    <section>
      <div className="rounded-2xl bg-brand-soft p-6">
        <h2 className="text-2xl font-bold text-ink">
          Hola, {user.name}
        </h2>
        <p className="mt-2 text-muted">
          {isAdmin
            ? "Consulta las solicitudes y organiza la atención de Castle Pet’s."
            : "Gestiona tus mascotas, consulta servicios y revisa tus citas."}
        </p>
      </div>

      {isAdmin && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold">Resumen del negocio</h3>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-brand-dark"
            >
              Actualizar resumen
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-danger">{error}</p>
          ) : summary ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Metric label="Clientes activos" value={summary.clients} />
              <Metric label="Mascotas activas" value={summary.pets} />
              <Metric
                label="Citas pendientes"
                value={summary.pendingAppointments}
              />
            </div>
          ) : (
            <p className="mt-4 text-muted" role="status">
              Cargando resumen…
            </p>
          )}
        </div>
      )}

      <h3 className="mt-8 text-lg font-bold">Accesos rápidos</h3>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Link
          to="/citas"
          className="rounded-2xl border border-border p-5 hover:bg-brand-soft"
        >
          <CalendarDays size={26} className="text-brand-dark" aria-hidden="true" />
          <p className="mt-3 font-bold">
            {isAdmin ? "Gestionar citas" : "Mis citas"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {isAdmin
              ? "Confirma solicitudes y actualiza el seguimiento."
              : "Solicita una cita y consulta el seguimiento de tu mascota."}
          </p>
        </Link>

        <Link
          to={isAdmin ? "/servicios" : "/mascotas"}
          className="rounded-2xl border border-border p-5 hover:bg-brand-soft"
        >
          {isAdmin ? (
            <Scissors size={26} className="text-brand-dark" aria-hidden="true" />
          ) : (
            <PawPrint size={26} className="text-brand-dark" aria-hidden="true" />
          )}

          <p className="mt-3 font-bold">
            {isAdmin ? "Administrar servicios" : "Mis mascotas"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {isAdmin
              ? "Actualiza precios, duraciones y disponibilidad."
              : "Registra mascotas y actualiza sus datos."}
          </p>
        </Link>
      </div>

      <p className="mt-6 text-sm text-muted">
        Atención: lunes a sábado, de 10:00 a. m. a 5:30 p. m.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold text-brand-dark">{value}</p>
    </div>
  );
}
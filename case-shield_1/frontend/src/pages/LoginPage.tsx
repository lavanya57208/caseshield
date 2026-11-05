import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Eye,
  EyeOff,
  AlertCircle,
  Info,
  User,
  Lock,
  Loader2,
  Scale,
  FileLock2,
  ShieldCheck,
  Users,
  BarChart3,
  Fingerprint,
  Landmark,
  ChevronDown,
  LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NormalizedApiError } from "@/lib/api";
import backdrop from "@/assets/login-backdrop.svg";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
type LoginForm = z.infer<typeof LoginSchema>;

const DEMO_ACCOUNTS = [
  { email: "investigator@caseshield.local", role: "Investigator" },
  { email: "senior@caseshield.local", role: "Senior Investigator" },
  { email: "forensic@caseshield.local", role: "Forensic Officer" },
  { email: "prosecutor@caseshield.local", role: "Prosecutor" },
  { email: "judge@caseshield.local", role: "Judge" },
  { email: "lawyer@caseshield.local", role: "Lawyer" },
  { email: "auditor@caseshield.local", role: "Auditor" },
  { email: "admin@caseshield.local", role: "Administrator" },
];

const FEATURES: { icon: LucideIcon; line1: string; line2: string }[] = [
  { icon: FileLock2, line1: "Secure", line2: "Records" },
  { icon: ShieldCheck, line1: "Stronger", line2: "Justice" },
  { icon: Users, line1: "Collaborative", line2: "Access" },
  { icon: BarChart3, line1: "Transparent", line2: "Processes" },
];

const SERIF = { fontFamily: '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif' };

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(LoginSchema) });

  async function onSubmit(values: LoginForm) {
    setServerError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      navigate("/dashboard");
    } catch (err) {
      setServerError((err as NormalizedApiError).message ?? "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(email: string) {
    setValue("email", email);
    setValue("password", "CaseShield#2026");
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-navy-700 text-white">
      {/* Backdrop + navy overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${backdrop})` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-[rgba(11,31,51,0.34)]" aria-hidden="true" />
      <div
        className="absolute inset-0 bg-gradient-to-r from-[rgba(11,31,51,0.6)] via-transparent to-[rgba(11,31,51,0.62)]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1920px] flex-col px-4 py-5 sm:px-8 lg:px-12 lg:py-7">
        {/* Top bar */}
        <header className="flex items-start justify-between gap-6">
          <Brand />
          <InstitutionalMark />
        </header>

        {/* Main composition */}
        <main className="grid flex-1 grid-cols-1 items-center gap-8 py-6 lg:grid-cols-[1fr_minmax(0,520px)_1fr] lg:gap-10 xl:gap-16">
          <FeatureList />

          <div className="mx-auto w-full max-w-[520px] animate-[pop-in_450ms_ease-out] motion-reduce:animate-none">
            <div className="rounded-2xl bg-white/[0.97] px-6 py-8 text-ink shadow-[0_24px_60px_-12px_rgba(5,16,26,0.55)] sm:px-10 sm:py-9">
              <div className="text-center">
                <h1 className="text-3xl font-semibold tracking-tight text-navy-700 sm:text-[2.1rem]">Sign In</h1>
                <p className="mt-1.5 text-sm text-ink-muted">Access your secure workspace</p>
              </div>

              {serverError && (
                <div
                  role="alert"
                  className="mt-6 flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-bg p-3 text-sm text-danger"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  {serverError}
                </div>
              )}

              <form className="mt-7 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
                <div>
                  <label htmlFor="email" className="sr-only">
                    Email / official identifier
                  </label>
                  <div className="relative">
                    <User
                      className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle"
                      aria-hidden="true"
                    />
                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      placeholder="Official email / Username"
                      className={clsx(
                        "h-14 w-full rounded-[10px] border bg-white pl-12 pr-4 text-[15px] text-ink transition placeholder:text-ink-subtle focus:outline-none focus:ring-2",
                        errors.email
                          ? "border-danger focus:border-danger focus:ring-danger/20"
                          : "border-border-strong/70 focus:border-slateblue focus:ring-slateblue/15",
                      )}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      {...register("email")}
                    />
                  </div>
                  {errors.email && (
                    <p id="email-error" className="mt-1.5 text-xs text-danger">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="password" className="sr-only">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle"
                      aria-hidden="true"
                    />
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Password"
                      className={clsx(
                        "h-14 w-full rounded-[10px] border bg-white pl-12 pr-12 text-[15px] text-ink transition placeholder:text-ink-subtle focus:outline-none focus:ring-2",
                        errors.password
                          ? "border-danger focus:border-danger focus:ring-danger/20"
                          : "border-border-strong/70 focus:border-slateblue focus:ring-slateblue/15",
                      )}
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? "password-error" : undefined}
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p id="password-error" className="mt-1.5 text-xs text-danger">
                      {errors.password.message}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 text-sm">
                  <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
                    <input type="checkbox" className="h-4 w-4 rounded border-border-strong accent-navy-700" />
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setNotice("Password resets are handled by your Case Shield administrator.")
                    }
                    className="font-medium text-slateblue hover:text-navy-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-navy-700 text-base font-semibold text-white shadow-sm transition-colors hover:bg-navy-600 active:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {submitting ? "Signing in…" : "Login"}
                </button>
              </form>

              <div className="my-5 flex items-center gap-4 text-xs font-medium text-ink-subtle" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                OR
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={() =>
                  setNotice("Government SSO is a planned integration and is not available in this prototype.")
                }
                className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-lg border border-border-strong/70 bg-white text-[15px] font-semibold text-navy-700 transition-colors hover:border-slateblue/50 hover:bg-surface"
              >
                <Landmark className="h-5 w-5 text-[#B8892F]" aria-hidden="true" />
                <span className="sm:hidden">Government SSO</span>
                <span className="hidden sm:inline">Login with Government SSO</span>
                <span className="rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Prototype
                </span>
              </button>

              {notice && (
                <p
                  role="status"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-slateblue/15 bg-navy-50 p-3 text-xs text-ink-muted"
                >
                  <Info className="mt-px h-3.5 w-3.5 flex-shrink-0 text-slateblue" aria-hidden="true" />
                  {notice}
                </p>
              )}

              <div className="mt-5 flex flex-col items-center text-ink-subtle">
                <Fingerprint className="h-11 w-11 text-slateblue/70" strokeWidth={1.25} aria-hidden="true" />
                <p className="mt-2 text-xs font-medium tracking-wide">
                  Secure <span className="mx-1.5 text-[#D6A64F]">•</span> Verified{" "}
                  <span className="mx-1.5 text-[#D6A64F]">•</span> Trusted
                </p>
              </div>

              <details className="group mt-5 rounded-lg border border-border bg-surface/60 text-left">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                    Demo identities (development)
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="px-4 pb-4">
                  <p className="mb-3 text-xs text-ink-muted">
                    Select an account to autofill credentials. All names and identifiers are fictional. Demo
                    password:{" "}
                    <code className="rounded bg-white px-1 py-0.5 font-mono">CaseShield#2026</code>
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DEMO_ACCOUNTS.map((acc) => (
                      <button
                        key={acc.email}
                        type="button"
                        onClick={() => fillDemo(acc.email)}
                        className="rounded-md border border-border bg-white px-2.5 py-2 text-left text-xs hover:border-teal hover:bg-teal/5"
                      >
                        <span className="block font-medium text-ink">{acc.role}</span>
                        <span className="block truncate text-ink-subtle">{acc.email}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          </div>

          <Tagline />
        </main>

        {/* Tablet: condensed feature strip */}
        <ul className="mx-auto mb-6 hidden w-full max-w-2xl grid-cols-4 gap-4 md:grid lg:hidden">
          {FEATURES.map(({ icon: Icon, line1, line2 }) => (
            <li key={line1} className="flex flex-col items-center text-center text-sm leading-tight text-white/90">
              <Icon className="mb-2 h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
              {line1} {line2}
            </li>
          ))}
        </ul>

        <footer className="text-center text-white/85">
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs tracking-wide sm:text-sm">
            <span>Protecting Information</span>
            <span className="text-white/40" aria-hidden="true">|</span>
            <span>Enabling Justice</span>
            <span className="text-white/40" aria-hidden="true">|</span>
            <span>Serving the Nation</span>
          </p>
          <p className="mt-2 text-[11px] text-white/50">
            Prototype for demonstration purposes. Not an official Government of India system.
          </p>
        </footer>
      </div>
    </div>
  );
}

function ShieldMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 56" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="cs-shield-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B3350" />
          <stop offset="1" stopColor="#0B1F33" />
        </linearGradient>
      </defs>
      <path
        d="M24 2 L44 9 V26 C44 39.5 35.5 49 24 54 C12.5 49 4 39.5 4 26 V9 Z"
        fill="url(#cs-shield-fill)"
        stroke="#D6A64F"
        strokeWidth="2.25"
        strokeLinejoin="round"
      />
      <path
        d="M24 6.5 L40 12 V26 C40 37 33.3 45 24 49.5 C14.7 45 8 37 8 26 V12 Z"
        fill="none"
        stroke="#D6A64F"
        strokeOpacity="0.35"
        strokeWidth="0.75"
      />
      <text
        x="24"
        y="36"
        textAnchor="middle"
        fill="#D6A64F"
        fontSize="24"
        fontWeight="700"
        style={SERIF}
      >
        C
      </text>
    </svg>
  );
}

function Brand() {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 sm:gap-3">
        <Scale className="h-7 w-7 flex-shrink-0 text-[#D6A64F] sm:h-9 sm:w-9" strokeWidth={1.5} aria-hidden="true" />
        <ShieldMark className="h-10 w-9 flex-shrink-0 drop-shadow sm:h-14 sm:w-12" />
        <span
          className="whitespace-nowrap text-2xl font-bold tracking-[0.08em] text-white sm:text-4xl xl:text-[2.75rem]"
          style={SERIF}
        >
          CASE SHIELD
        </span>
      </div>
      <p className="mt-2 text-xs leading-snug text-white/80 sm:text-sm">
        Secure Legal &amp; Investigation
        <br />
        Document Management System
      </p>
    </div>
  );
}

function InstitutionalMark() {
  return (
    <div className="hidden flex-shrink-0 text-right md:block">
      <div className="flex items-center justify-end gap-3">
        <div className="text-sm leading-snug text-white/90">
          <p className="font-semibold">Government of India</p>
          <p>Ministry of Home Affairs</p>
        </div>
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#D6A64F]/70 bg-navy-700/40">
          <Landmark className="h-6 w-6 text-[#D6A64F]" strokeWidth={1.5} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-[11px] font-semibold tracking-[0.25em] text-[#D6A64F]">
        SERVE <span className="text-white/40">|</span> PROTECT <span className="text-white/40">|</span> SECURE
      </p>
    </div>
  );
}

function FeatureList() {
  return (
    <ul className="hidden max-w-[220px] space-y-9 border-l border-white/35 py-2 pl-7 lg:block">
      {FEATURES.map(({ icon: Icon, line1, line2 }) => (
        <li
          key={line1}
          className="group flex items-center gap-4 text-white/90 transition-transform duration-200 hover:translate-x-1"
        >
          <Icon
            className="h-9 w-9 flex-shrink-0 transition-colors group-hover:text-[#D6A64F]"
            strokeWidth={1.25}
            aria-hidden="true"
          />
          <span className="text-base leading-tight">
            {line1}
            <br />
            {line2}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tagline() {
  return (
    <div className="hidden justify-self-end lg:block">
      <p className="text-3xl font-semibold leading-[1.5] tracking-[0.12em] text-white xl:text-[2.6rem]" style={SERIF}>
        LAW
        <br />
        SECURITY
        <br />
        PEOPLE
      </p>
      <p className="mt-3 text-lg font-medium tracking-[0.2em] text-white/90 xl:text-xl">A SAFER INDIA</p>
      <div className="mt-4 flex h-1 w-24 overflow-hidden rounded-full" aria-hidden="true">
        <span className="flex-1 bg-[#FF9933]" />
        <span className="flex-1 bg-white" />
        <span className="flex-1 bg-[#138808]" />
      </div>
    </div>
  );
}

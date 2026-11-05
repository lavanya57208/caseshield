# CASE SHIELD

**Secure Legal & Investigation Document Management System** — a hackathon prototype demonstrating case-centric document management, evidence chain of custody, tamper-evident audit logging, and layered role-based access control for legal and investigation workflows.

> **This is a demonstration prototype**, not a production system and not a real government or judicial platform. It uses entirely fictional people, cases, and documents. It does not claim legal admissibility for any document, does not claim to be "unhackable," and does not claim that any hash chain or optional local ledger is a substitute for legal or cryptographic proof. See [Honesty & scope](#honesty--scope) below.

---

## 1. What this is

CASE SHIELD centralizes legal and investigation case records — cases, documents, evidence, chain of custody, access requests, and a tamper-evident audit trail — behind server-enforced authorization for ten distinct roles. Every module specified in the original brief has a working screen and a real backend flow: real SHA-256 document hashing, real file upload/download, real authorization checks (not just hidden buttons), a real hash-chained audit log with a working "Verify Audit Chain" action, and an honest "AI service not configured" state instead of fabricated AI output.

## 2. Quick start

**Requirements:** Node.js **22.5+** (for the built-in `node:sqlite` module). Nothing else — the server ships with **zero runtime dependencies**.

```bash
cd server
node dist/index.js
```

That's it. The server seeds a fresh SQLite database on first run (if `server/data/case-shield.db` doesn't already exist), serves the API on `http://localhost:4000/api/*`, and serves the already-built frontend from `client/dist` at `http://localhost:4000/`. Open that URL and log in with any of the credentials below.

To reset the demo data at any point, stop the server and delete `server/data/case-shield.db*`, then start it again.

### Rebuilding from source

If you change any TypeScript source, rebuild:

```bash
# Server (zero runtime deps; devDependencies only needed to compile)
cd server
npm install        # pulls in typescript, tsx, @types/node for the build
npm run build       # tsc -> dist/, then copies schema.sql into dist/db/
node dist/index.js

# Client (also zero-dependency; compiles straight to browser-native ES modules)
cd ../client
npm install
npm run build        # tsc -> dist/, then copies public/ -> dist/
```

`npm run dev` in `server/` runs the API from source with `tsx watch` if you'd rather not rebuild on every change.

### Demo credentials

Every seeded user shares the password **`CaseShield@2026`**.

| Employee ID | Name | Role | What they'll see |
|---|---|---|---|
| `INV-1001` | Rohan Mehta | Investigator | 9 of 14 cases (only assigned ones); can upload documents/evidence, cannot see Restricted documents without a grant |
| `SINV-1002` | Ananya Kapoor | Senior Investigator | Broader case access, can edit case metadata, approve/revoke access requests |
| `FOR-1003` | Devika Rao | Forensic Officer | Evidence-focused; can verify evidence integrity |
| `PROS-1004` | Karan Sethi | Prosecutor | Read-heavy access to assigned cases and their documents |
| `JUD-1005` | Justice Meera Iyer | Judge | Read access, no upload |
| `LAW-1006` | Arjun Malhotra | Lawyer | Narrowest access; can request access to specific documents |
| `CRT-1007` | Priya Nair | Court Staff | Can upload court filings, cannot see the global audit log |
| `LIT-1008` | Sanjay Verma | Litigant | External party; sees only what's explicitly granted |
| `ADM-1009` | Neha Joshi | System Administrator | Sees **all** cases for administration, but is **denied** document/evidence content by default — admin ≠ automatic content access |
| `AUD-1010` | Vikram Desai | Auditor | Sees all cases and the full audit trail, but not document content, unless explicitly granted |

The flagship case, **CASE-2026-00427 "Cyber Fraud Investigation"**, is the best one to explore — it has multiple document versions, three evidence items each with a multi-step chain of custody, and access requests in every status (Pending, Approved, Rejected, Revoked, Expired).

**Try this to see RBAC actually enforced, not just hidden in the UI:** log in as `INV-1001` and open the flagship case's Documents tab — you'll see 3 of its 4 documents; the Restricted "Forensic Report" is missing because you're not the uploader and hold no explicit grant. Then log in as `ADM-1009` and try the same case: the System Administrator can see the case exists (for oversight) but a direct API call for that case's document list returns `403 Forbidden` — administrative visibility was deliberately **not** wired to content access, matching the brief's explicit requirement.

---

## 3. Why this isn't a Vite/React/Express/Supabase app, literally

The brief's preferred stack was React + TypeScript + Vite + Tailwind on the frontend, Node + Express on the backend, and Supabase for Postgres/Auth/Storage — with an explicit allowance for "platform equivalents… maintaining the same logical architecture." That allowance is what got exercised here: **the sandbox this was built in has no network access to the npm registry, any CDN, or GitHub**, so nothing outside Node's own built-ins and a handful of pre-installed global tools (`typescript`, `tsx`) could be installed. Rather than produce a half-working scaffold, this was rebuilt as a **zero-dependency equivalent** of the same architecture:

| Brief called for | What's actually running | Why it's an equivalent, not a downgrade |
|---|---|---|
| Vite + React | Hand-written TypeScript compiled straight to native browser ES modules (`tsc` with `NodeNext` modules, `.js`-suffixed relative imports) | Same component-driven structure (pages, shared UI kit, router, API client) with zero build tooling; a real Vite/React port is a mechanical follow-up, not a rewrite (see §7) |
| Express | A ~300-line hand-rolled `Router()`/`app.use()`/middleware-chain framework (`server/src/lib/miniserver.ts`) that intentionally mirrors Express's exact API shape | Route files (`router.get(path, ...handlers)`, `req.params`/`req.body`, `res.status().json()`) are Express-compatible; swapping in real Express means changing one `import`, not the route logic |
| Managed Postgres | Node's built-in `node:sqlite` module, with a schema that mirrors the project's production PostgreSQL schema table-for-table | The real production data layer is PostgreSQL via Prisma (see `/backend` and `/prisma` at the repository root) — the SQLite database here is a runnable stand-in for this prototype only |
| Managed auth/identity provider | Signed session tokens (HMAC-SHA256, hand-rolled, `server/src/lib/jwt.ts`) + `scrypt`-hashed passwords | Same bearer-token flow a real identity provider's JWT would produce; swappable behind the same `requireAuth` middleware. Production auth is Google Identity Platform (see `/backend`) |
| Cloud object storage | Documents stored as real files on disk under `server/data/documents/`, referenced by path in the database | Production storage is Google Cloud Storage (see `GoogleCloudStorageProvider` in `/backend`), not part of this prototype |
| multer, bcrypt, jsonwebtoken, dotenv | Base64 JSON uploads decoded server-side, `crypto.scryptSync`, hand-rolled token signing, a ~15-line `.env` parser | All standard library only |

Everything above is real, working code — not a mock. Every SHA-256 hash, JWT-alike signature, and audit hash chain is genuinely computed, not hardcoded.

---

## 4. Architecture

**Case-centric navigation, as specified.** The top-level sidebar is deliberately narrow: **Dashboard, Cases, Search, Notifications, System Audit Log, Profile.** Documents, Evidence, Chain of Custody, and Access Requests are *not* top-level items — they only exist inside a specific case, under its six tabs: **Overview, Documents, Evidence, Chain of Custody, Audit Trail, Access Requests.**

```
client/                        Frontend — zero-dependency TypeScript, compiles to native ES modules
  src/
    pages/                     Dashboard, Cases, Search, Notifications, Audit Log, Profile, Login
    pages/case/                Case shell + the six in-case tabs
    components/                Shared UI kit: layout/shell, icons, badges, modal
    api.ts, router.ts, state.ts, util.ts
  public/                      index.html, styles.css (design tokens + full design system), favicon
  dist/                        Pre-built output — this is what the server serves

server/                        Backend — zero runtime dependencies, Node built-ins only
  src/
    db/                        schema.sql, seed.ts (demo data), rolePermissions.ts
    lib/                       hash.ts, audit.ts, permissions.ts (RBAC engine), jwt.ts, password.ts, miniserver.ts
    routes/                    auth, cases, documents, evidence, accessRequests, audit, search, dashboard, notifications, users, ledger
    ai/provider.ts             AIProvider interface + NullAIProvider (see §8)
  dist/                        Pre-built output — run this directly with `node dist/index.js`
  data/                        SQLite database + uploaded document files (created at runtime, gitignored)
```

### Authorization model

Every privileged action is checked server-side by `server/src/lib/permissions.ts`, never trusted to the UI alone. The check is layered:

1. **Role default** — does this role get this action on this resource type at all? (`server/src/db/rolePermissions.ts`)
2. **Case membership** — is this user a stakeholder on this specific case? System Administrator and Auditor are the exception: they get case *visibility* for oversight without needing membership.
3. **Document/evidence sensitivity** — a `Restricted` document requires an explicit grant (via an approved access request) or being the original uploader, **even for otherwise-authorized case members.**
4. **Explicit time-limited grants** — the `document_permissions` table, populated only by an *approved* row in `access_requests`.

This is why the RBAC differences are real and testable via `curl`, not just cosmetic: an Investigator's `/api/documents/case/:id` call and a System Administrator's return genuinely different (and in the Administrator's case, sometimes `403`) results for the same case.

### Tamper-evident audit chain

Every mutating action (login, upload, download, approve, revoke, custody transfer, and so on) writes a row to `audit_events` with:

```
event_hash = SHA256(previous_event_hash + canonical_json(event_data))
```

`server/src/lib/audit.ts` computes this on write; `verifyAuditChain()` walks every event in order and recomputes each hash to confirm nothing was altered after the fact. The **System Audit Log → Verify Audit Chain** button in the UI calls this live — in this build it reports `AUDIT CHAIN VERIFIED` after checking every event stored so far. The UI is explicit that this proves internal consistency of this application's own database, not physical/legal immutability (see §8).

---

## 5. Honesty & scope

Per the brief, this build deliberately avoids overclaiming:

- **No legal admissibility claims.** Nowhere does the app assert that a document or its hash is legally admissible evidence.
- **No "unhackable" claims.** Security language throughout (dashboard, profile, login) describes what protections are active ("Protected", "Monitoring Active", "Session-based sign-in") without claiming invulnerability.
- **SHA-256 integrity is framed honestly.** The "Verify Integrity" feature detects whether a file's current hash matches its registered hash — it does not, and does not claim to, *prevent* tampering.
- **Digital signatures are "integration-ready," not real.** The Document Detail view shows a Digital Signature section with status `Integration Ready` and an explicit note: *"No real PKI signature provider is connected in this prototype. This section shows the architecture is signature-ready, not that a cryptographic signature has been applied."*
- **AI Document Intelligence is honest when unconfigured.** With no `AI_API_KEY` set, every AI panel reports `configured: false` and explains that no AI provider is connected — it never fabricates a classification, summary, or extracted metadata. See §8.
- **No real blockchain claim.** No public blockchain is used anywhere in this build. If an optional local integrity ledger is enabled later, it must be described as exactly what it is — a local hash ledger — never as a public/distributed blockchain.
- **No real government, police, or court data.** Every court, case, document, and person in the seed data is fictional and clearly demo-flavored (`@caseshield.demo` emails, invented case numbers, invented court names).

---

## 6. Moving beyond this prototype

This folder (`case-shield/client` + `case-shield/server`) is a self-contained, zero-dependency demo build. It is **not** the project's production stack, and **Supabase is not part of the project's architecture** — it was evaluated early on and explicitly rejected.

The real production implementation lives at the repository root:

- **PostgreSQL** (via Prisma, `/backend`, schema in `/prisma`) for structured application data and metadata.
- **Google Cloud Storage** for document/evidence binaries.
- **Google Cloud KMS/HSM** for key management.
- **Google Secret Manager** for secrets.
- **Google Identity Platform** for authentication/MFA (once implemented).
- **Hyperledger Fabric** for selected integrity/custody records.

This prototype's `server/src/db/` layer is centralized enough that anyone porting its routes onto the real backend does not need to touch route or permission logic — only the data-access module changes. Azure is a possible future provider adapter, not a current runtime dependency, and no Azure-specific code exists yet.

---

## 7. Migrating to Vite + React + Tailwind + Express

The current frontend and backend were structured so this port is mechanical:

- **Backend → Express:** `server/src/lib/miniserver.ts`'s `Router()`/`app.use()`/`get()`/`post()` API was deliberately written to match Express's shape. Once `npm install express` is possible, route files (`server/src/routes/*.ts`) need no logic changes — only the top-level `createApp()`/`Router()` imports change to `express()`/`express.Router()`.
- **Frontend → React:** Each file in `client/src/pages/` and `client/src/components/` is already a self-contained render function that takes a container and produces markup + event wiring — the natural JSX component boundaries. `client/src/router.ts`'s route table maps directly onto React Router routes. `client/src/api.ts` is already a plain fetch wrapper reusable as-is.
- **Styling → Tailwind:** `client/public/styles.css` defines the full design system as CSS custom properties (`--navy`, `--teal`, `--slate-blue`, etc.) matching the brief's exact palette — these map directly onto a `tailwind.config.js` theme extension, and most component class names already describe intent (`.card`, `.badge-success`, `.data-table`) in a way that translates to Tailwind utility groups or `@apply`.
- **Build tooling:** Once npm access is available, `npm install vite @vitejs/plugin-react tailwindcss` and the existing `tsconfig.json` module settings carry over with minimal changes.

---

## 8. AI Document Intelligence

`server/src/ai/provider.ts` defines an `AIProvider` interface (`classify`, `extractMetadata`, `summarize`, `findSimilar`) and a `NullAIProvider` that is used whenever no `AI_API_KEY` is configured in `server/.env`. Every AI-backed endpoint and UI panel checks `configured` before showing any result — with no key set, the Document Detail view's "AI Document Intelligence" section states plainly that no AI service is connected, rather than returning placeholder or fabricated content. To enable it, implement a real provider against `AIProvider` and set `AI_PROVIDER` / `AI_API_KEY` in `.env`; `getAIProvider()` is the single factory function that would need to be pointed at it.

---

## 9. Security notes (prototype-appropriate, not production-hardened)

- Passwords hashed with `crypto.scryptSync` (salted, timing-safe compare) — never stored or logged in plaintext.
- Sessions are signed, expiring (8h) bearer tokens validated server-side on every request via `requireAuth` middleware — not just checked once at login.
- **Every** authorization decision is enforced server-side in `lib/permissions.ts`; the UI hides buttons a user can't use as a courtesy, but the API independently rejects the same action.
- Basic security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) and a simple in-memory rate limiter are applied to all API routes.
- Uploaded documents are stored outside any public web root and served only through an authorization-checked download route — never as static files.
- All input is validated server-side (allowed document types, confidentiality levels, required fields) before being written to the database.
- Every mutating action is written to the hash-chained audit log, including denied/failed actions where relevant (e.g., failed logins).
- This build favors demonstrating the *architecture* of least privilege over production hardening — before any real deployment, add MFA, real TLS termination, a real secrets manager for `JWT_SECRET`, structured logging/alerting, and a security review of the rate limiter and input validation for production traffic levels.

---

## 10. Known limitations of this prototype

- SQLite (via `node:sqlite`, an **experimental** Node API) stands in for Postgres; it's single-process and fine for a demo, not for concurrent production load.
- The custom `miniserver.ts` framework implements only the subset of Express's API this codebase uses — it is not a general-purpose Express replacement.
- File uploads are base64-encoded JSON rather than `multipart/form-data`, which is simpler here but less efficient for very large files.
- The in-memory rate limiter resets on restart and does not share state across multiple server instances.
- No email/SMS delivery is wired up for notifications — they're recorded and shown in-app only.

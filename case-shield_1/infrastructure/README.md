# Infrastructure Notes

This directory documents the reference Google Cloud deployment architecture
described in `docs/architecture.md` §9. It intentionally does not ship
ready-to-apply Terraform/Deployment Manager configuration for this
prototype phase — the notes below are what a production rollout would
provision, kept here so the intent is explicit and reviewable rather than
implied by code.

## Resources (reference architecture)

- **Cloud Run** (or GKE, if workload shape later needs it) running the
  backend API and serving the built frontend, behind:
- **Cloud Load Balancing** (HTTPS) with **Cloud Armor** WAF rules in front
  of it.
- **Cloud SQL for PostgreSQL** — private IP, automated backups, point-in-
  time recovery. Connected via the Cloud SQL Auth Proxy or a private
  services connection, never a public IP.
- **Cloud Storage** — a private bucket for document/evidence binaries, CMEK
  via **Cloud KMS** where the deployment's data classification requires it,
  object versioning enabled, and explicit lifecycle/retention rules per
  document class (see `docs/security-architecture.md` §6/§14 — retention
  is policy-driven, never an implicit property of "being in the bucket").
- **Cloud KMS** (optionally backed by **Cloud HSM** for higher-assurance
  keys) for envelope encryption / future signing key material.
- **Secret Manager** for `JWT_SECRET`, database credentials, and any AI
  provider API keys — never in source, `.env`, or the frontend bundle.
- **Identity Platform** for production authentication, behind the same
  `IdentityProvider` interface the demo identity provider implements.
- **Pub/Sub** for asynchronous work: AI processing jobs, notification
  fan-out, and shipping audit events to a durable sink.
- **Cloud Logging / Cloud Audit Logs** for infrastructure-level logging,
  complementing (not replacing) the application's own `audit_events` table.
- **Vertex AI / Document AI** behind the `AIProvider` interface.

## Environments

- `development` (default): everything runs against local adapters — see
  the root `README.md` and `.env.example`.
- `production`: set `CASE_SHIELD_ENV=production` and populate every
  `GOOGLE_CLOUD_*` / `IDENTITY_PLATFORM_*` / `SECRET_MANAGER_CONFIG`
  variable. The production provider classes
  (`backend/src/modules/**/google-*.provider.ts`,
  `vertex-ai.provider.ts`, `identity-platform.provider.ts`,
  `production-notification.provider.ts`) are structurally complete against
  the documented Google Cloud SDK surfaces but have not been exercised
  against live credentials in this project's development environment —
  validate them against a real GCP project before relying on them.

## Government / public-sector deployment

The application does not hardcode Google Cloud at the business-logic
level — only the adapter implementations under `backend/src/modules/**`
do. Redeploying into an approved Indian government or public-sector cloud
environment means implementing the same five provider interfaces
(`StorageProvider`, `IdentityProvider`, `KeyManagementProvider`,
`AIProvider`, `NotificationProvider`) against that environment's own
services, subject to its own procurement, security assessment, and
data-governance requirements. No part of this repository claims that has
already happened.

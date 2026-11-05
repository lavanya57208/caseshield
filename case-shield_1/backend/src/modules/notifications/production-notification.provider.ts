import { NotificationDispatch, NotificationProvider } from "@/modules/notifications/notification-provider.types";

// PRODUCTION ADAPTER (structural) — publishes to a Pub/Sub topic for
// asynchronous fan-out (email/push/SMS workers), per docs/architecture.md
// §9. Not exercised without live GCP credentials in this sandbox.
export class ProductionNotificationProvider implements NotificationProvider {
  readonly name = "ProductionNotificationProvider (Pub/Sub)";

  async dispatch(_notification: NotificationDispatch): Promise<void> {
    throw new Error(
      "ProductionNotificationProvider is not connected in this environment. Configure a Pub/Sub topic and worker before enabling CASE_SHIELD_ENV=production.",
    );
  }
}

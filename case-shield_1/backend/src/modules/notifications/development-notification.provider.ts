import { NotificationDispatch, NotificationProvider } from "@/modules/notifications/notification-provider.types";
import { logger } from "@/lib/logger";

// DEVELOPMENT ADAPTER — in-app only. The Notification model row is the
// real delivery mechanism in development; this adapter just logs.
export class DevelopmentNotificationProvider implements NotificationProvider {
  readonly name = "DevelopmentNotificationProvider (in-app only)";

  async dispatch(notification: NotificationDispatch): Promise<void> {
    logger.debug({ notification }, "DevelopmentNotificationProvider: (no external channel in development)");
  }
}

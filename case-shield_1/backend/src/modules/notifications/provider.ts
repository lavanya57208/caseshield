import { isProduction } from "@/config/env";
import { NotificationProvider } from "@/modules/notifications/notification-provider.types";
import { DevelopmentNotificationProvider } from "@/modules/notifications/development-notification.provider";
import { ProductionNotificationProvider } from "@/modules/notifications/production-notification.provider";

let instance: NotificationProvider | undefined;

export function getNotificationProvider(): NotificationProvider {
  if (!instance) {
    instance = isProduction ? new ProductionNotificationProvider() : new DevelopmentNotificationProvider();
  }
  return instance;
}

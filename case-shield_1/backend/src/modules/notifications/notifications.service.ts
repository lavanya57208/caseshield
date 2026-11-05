import { prisma } from "@/lib/prisma";
import { getNotificationProvider } from "@/modules/notifications/provider";
import { NotificationType } from "@prisma/client";

export const NotificationsService = {
  async send(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    relatedCaseId?: string;
    relatedDocumentId?: string;
    relatedEvidenceId?: string;
  }) {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        relatedCaseId: input.relatedCaseId,
        relatedDocumentId: input.relatedDocumentId,
        relatedEvidenceId: input.relatedEvidenceId,
      },
    });
    // Fire-and-forget external dispatch; failures here must never block the
    // in-app notification, which has already been persisted above.
    getNotificationProvider()
      .dispatch({ userId: input.userId, type: input.type, title: input.title, body: input.body })
      .catch(() => undefined);
    return notification;
  },

  async listForUser(userId: string) {
    return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  },

  async markRead(userId: string, id: string) {
    return prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
  },

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  },
};

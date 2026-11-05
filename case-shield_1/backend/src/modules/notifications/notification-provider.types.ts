export interface NotificationDispatch {
  userId: string;
  type: string;
  title: string;
  body: string;
}

export interface NotificationProvider {
  readonly name: string;
  /** Fire-and-forget dispatch to whatever out-of-band channel this adapter owns (push/email/webhook). The in-app notification row is always written by NotificationService regardless of this call's outcome. */
  dispatch(notification: NotificationDispatch): Promise<void>;
}

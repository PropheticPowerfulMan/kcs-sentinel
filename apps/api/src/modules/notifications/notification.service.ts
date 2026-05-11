import type { NotificationPreview } from "../../core/types.js";

export const buildArrivalNotification = (studentName: string, recipient: string): NotificationPreview[] => [
  {
    channel: "sms",
    recipient,
    message: `${studentName} has arrived at school and attendance has been verified by KCS SENTINEL.`
  },
  {
    channel: "whatsapp",
    recipient,
    message: `Arrival confirmed for ${studentName}. Real-time attendance sync completed.`
  }
];

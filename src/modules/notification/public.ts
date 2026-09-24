export {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PLACEHOLDERS,
  REQUEST_REPLIED_PLACEHOLDERS,
  placeholdersIn,
  unknownPlaceholders,
  type NotificationCopy,
  type NotificationKind,
  type ShippingCarrier,
} from "./domain/notification";
export {
  DeliverNotifications,
  EmailRejectedError,
  type EmailSender,
  type NotificationDeliveryResult,
  type NotificationQueue,
} from "./application/deliver-notifications";

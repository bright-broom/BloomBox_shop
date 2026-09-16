import type {
  AccountChange,
  AccountPreferences,
} from "../domain/customer-portal";
export type AccountActor = Readonly<{
  customerId: string;
  version: number;
  expiresAt: number;
}>;
export type PortalSnapshot = Readonly<{
  revision: number;
  preferences: AccountPreferences;
}>;
export type AccountRequestKind =
  | "ORDER"
  | "CANCELLATION"
  | "RETURN"
  | "DELIVERY"
  | "OTHER";
export type AccountRequest = Readonly<{
  id: string;
  kind: AccountRequestKind;
  orderId: string | null;
  status: "OPEN" | "REPLIED" | "CLOSED";
  createdAt: string;
  message: string;
  reply: string;
  revision: number;
}>;
export interface CustomerPortalRepository {
  read(actor: AccountActor): Promise<PortalSnapshot>;
  change(
    actor: AccountActor,
    revision: number,
    change: AccountChange,
  ): Promise<void>;
  requests(actor: AccountActor): Promise<readonly AccountRequest[]>;
  request(
    actor: AccountActor,
    input: {
      id: string;
      kind: AccountRequestKind;
      orderId: string | null;
      message: string;
    },
  ): Promise<void>;
  revokeSessions(actor: AccountActor): Promise<void>;
  close(actor: AccountActor): Promise<void>;
}

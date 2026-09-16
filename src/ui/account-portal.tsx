import { JAPAN_PREFECTURES } from "@/modules/fulfillment/public";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { ReactNode } from "react";
import { ACCOUNT_LIMITS } from "@/modules/customer/public";
import type {
  AddressEntry,
  PortalSnapshot,
  AccountRequest,
  CustomerOrder,
} from "@/modules/customer/public";
import type { Product } from "@/modules/catalog/public";
import { customerPortalContent as copy } from "@/shared/infrastructure/content/customer-portal-content";
import { AccountIcon, type AccountIconName } from "./account-icon";
import {
  CopyAddress,
  PortalForm,
  type PortalFormAction,
} from "./account-portal-form";
import { formatMoney } from "@/shared/domain/money";
export const accountSections = [
  "profile",
  "addresses",
  "favorites",
  "support",
  "settings",
] as const;
export type AccountSection = (typeof accountSections)[number];
const icons: Record<AccountSection, AccountIconName> = {
  profile: "user",
  addresses: "truck",
  favorites: "flower",
  support: "help",
  settings: "info",
};
export function AccountPortalNavigation({
  preview = false,
  current,
}: {
  preview?: boolean;
  current?: AccountSection;
}) {
  return (
    <nav className="account-tools" aria-label={copy.settings}>
      {accountSections.map((section) => (
        <Link
          key={section}
          aria-current={current === section ? "page" : undefined}
          href={(preview ? "/preview/account/" : "/account/") + section}
        >
          <AccountIcon name={icons[section]} />
          {copy[section]}
          <AccountIcon name="arrow" />
        </Link>
      ))}
    </nav>
  );
}
export function AccountPortalFrame({
  section,
  children,
  preview = false,
}: {
  section: AccountSection;
  children: ReactNode;
  preview?: boolean;
}) {
  return (
    <section className="section-shell account-page account-dashboard account-portal">
      <header className="account-heading">
        <h1>
          <AccountIcon name={icons[section]} />
          {copy[section]}
        </h1>
        <Link
          className="text-link"
          href={preview ? "/preview/account" : "/account"}
        >
          {copy.home}
        </Link>
      </header>
      {preview ? (
        <p className="account-notice" role="status">
          {copy.sample}
        </p>
      ) : null}
      <AccountPortalNavigation preview={preview} current={section} />
      <div className="account-portal-content">{children}</div>
    </section>
  );
}
function Revision({
  snapshot,
  kind,
}: {
  snapshot: PortalSnapshot;
  kind: string;
}) {
  return (
    <>
      <input type="hidden" name="revision" value={snapshot.revision} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
}
function Field({
  name,
  label,
  value = "",
  optional = false,
  maxLength = ACCOUNT_LIMITS.name,
  type = "text",
  autoComplete,
}: {
  name: string;
  label: string;
  value?: string;
  optional?: boolean;
  maxLength?: number;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="account-field">
      {label}
      <input
        name={name}
        defaultValue={value}
        required={!optional}
        maxLength={maxLength}
        type={type}
        autoComplete={autoComplete}
      />
    </label>
  );
}
export function ProfileEditor({
  snapshot,
  email,
  googleName,
  action,
  preview,
}: {
  snapshot: PortalSnapshot;
  email: string;
  googleName: string;
  action?: PortalFormAction;
  preview?: boolean;
}) {
  return (
    <section className="account-panel">
      <p>{copy.profileNote}</p>
      <PortalForm action={action} preview={preview}>
        <Revision snapshot={snapshot} kind="profile" />
        <Field
          name="name"
          label={copy.name}
          value={snapshot.preferences.name || googleName}
          autoComplete="name"
        />
        <Field
          name="phone"
          label={copy.phone + "（" + copy.optional + "）"}
          value={snapshot.preferences.phone}
          optional
          maxLength={ACCOUNT_LIMITS.phone}
          type="tel"
          autoComplete="tel"
        />
      </PortalForm>
      <h2>{copy.email}</h2>
      <p className="account-wrap">{email}</p>
      <p className="form-hint">{copy.emailNote}</p>
    </section>
  );
}
export function AddressEditor({
  snapshot,
  action,
  preview,
}: {
  snapshot: PortalSnapshot;
  action?: PortalFormAction;
  preview?: boolean;
}) {
  return (
    <>
      <p>{copy.addressNote}</p>
      <div className="account-address-grid">
        {snapshot.preferences.addresses.length ? (
          snapshot.preferences.addresses.map((address) => (
            <section key={address.id} className="account-panel">
              <h2>{address.label}</h2>
              {snapshot.preferences.defaultAddressId === address.id ? (
                <p className="account-status">{copy.default}</p>
              ) : (
                <PortalForm
                  action={action}
                  label={copy.setDefault}
                  preview={preview}
                >
                  <Revision snapshot={snapshot} kind="default-address" />
                  <input type="hidden" name="id" value={address.id} />
                </PortalForm>
              )}
              <address>
                {address.name}
                <br />〒{address.postalCode}
                <br />
                {address.prefecture}
                {address.city}
                {address.line1}
                <br />
                {address.line2}
                <br />
                {address.phone}
              </address>
              {!preview ? (
                <CopyAddress
                  value={[
                    address.name,
                    address.postalCode,
                    address.prefecture + address.city + address.line1,
                    address.line2,
                    address.phone,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                />
              ) : null}
              <details>
                <summary>{copy.edit}</summary>
                <AddressForm
                  snapshot={snapshot}
                  address={address}
                  action={action}
                  preview={preview}
                />
              </details>
              <details>
                <summary>{copy.remove}</summary>
                <PortalForm
                  action={action}
                  label={copy.remove}
                  preview={preview}
                >
                  <Revision snapshot={snapshot} kind="remove-address" />
                  <input type="hidden" name="id" value={address.id} />
                  <label>
                    <input type="checkbox" required />
                    {copy.deleteConfirm}
                  </label>
                </PortalForm>
              </details>
            </section>
          ))
        ) : (
          <p>{copy.emptyAddresses}</p>
        )}
      </div>
      <section className="account-panel">
        <h2>{copy.addAddress}</h2>
        <AddressForm snapshot={snapshot} action={action} preview={preview} />
      </section>
    </>
  );
}
function AddressForm({
  snapshot,
  address,
  action,
  preview,
}: {
  snapshot: PortalSnapshot;
  address?: AddressEntry;
  action?: PortalFormAction;
  preview?: boolean;
}) {
  return (
    <PortalForm action={action} preview={preview} once={!address}>
      <Revision snapshot={snapshot} kind="address" />
      <input type="hidden" name="id" value={address?.id ?? randomUUID()} />
      <Field
        name="label"
        label={copy.label}
        value={address?.label}
        maxLength={ACCOUNT_LIMITS.label}
      />
      <Field
        name="name"
        label={copy.recipientName}
        value={address?.name}
        autoComplete="shipping name"
      />
      <Field
        name="postalCode"
        label={copy.postalCode}
        value={address?.postalCode}
        maxLength={ACCOUNT_LIMITS.postalCode}
        autoComplete="shipping postal-code"
      />
      <label>
        {copy.prefecture}
        <select
          name="prefecture"
          defaultValue={address?.prefecture ?? ""}
          required
          autoComplete="shipping address-level1"
        >
          <option value="" disabled>
            {copy.prefecture}
          </option>
          {JAPAN_PREFECTURES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <Field
        name="city"
        label={copy.city}
        value={address?.city}
        maxLength={ACCOUNT_LIMITS.city}
        autoComplete="shipping address-level2"
      />
      <Field
        name="line1"
        label={copy.line1}
        value={address?.line1}
        maxLength={ACCOUNT_LIMITS.addressLine}
        autoComplete="shipping address-line1"
      />
      <Field
        name="line2"
        label={copy.line2}
        value={address?.line2}
        maxLength={ACCOUNT_LIMITS.addressLine}
        optional
        autoComplete="shipping address-line2"
      />
      <Field
        name="phone"
        label={copy.phone}
        value={address?.phone}
        maxLength={ACCOUNT_LIMITS.phone}
        type="tel"
        autoComplete="shipping tel"
      />
    </PortalForm>
  );
}
export function FavoriteEditor({
  snapshot,
  products,
  candidates,
  action,
  preview,
}: {
  snapshot: PortalSnapshot;
  products: readonly (Product | null)[];
  candidates: readonly Product[];
  action?: PortalFormAction;
  preview?: boolean;
}) {
  return (
    <>
      <p>{copy.favoriteNote}</p>
      <div className="account-address-grid">
        {snapshot.preferences.favorites.length ? (
          snapshot.preferences.favorites.map((id, index) => (
            <section className="account-panel" key={id}>
              <h2>{products[index]?.name ?? copy.unavailableProduct}</h2>
              {products[index] ? (
                <>
                  <p>{formatMoney(products[index].price)}</p>
                  <Link
                    className="text-link"
                    href={"/flowers/" + products[index].slug}
                  >
                    {copy.openProduct}
                  </Link>
                </>
              ) : null}
              <PortalForm action={action} label={copy.remove} preview={preview}>
                <Revision snapshot={snapshot} kind="unfavorite" />
                <input type="hidden" name="productId" value={id} />
              </PortalForm>
            </section>
          ))
        ) : (
          <p>{copy.emptyFavorites}</p>
        )}
      </div>
      <section className="account-panel">
        <h2>{copy.addFavorite}</h2>
        <PortalForm action={action} preview={preview} label={copy.addFavorite}>
          <Revision snapshot={snapshot} kind="favorite" />
          <label>
            {copy.browse}
            <select name="productId" required>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </PortalForm>
      </section>
    </>
  );
}
export function AccountSettings({
  snapshot,
  action,
  sessionAction,
  preview,
}: {
  snapshot: PortalSnapshot;
  action?: PortalFormAction;
  sessionAction?: PortalFormAction;
  preview?: boolean;
}) {
  return (
    <>
      <section className="account-panel">
        <h2>{copy.marketing}</h2>
        <p>{copy.marketingNote}</p>
        <PortalForm action={action} preview={preview}>
          <Revision snapshot={snapshot} kind="marketing" />
          <label className="account-check">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={snapshot.preferences.marketing}
            />
            {copy.marketing}
          </label>
        </PortalForm>
      </section>
      <section className="account-panel">
        <h2>{copy.security}</h2>
        <p>{copy.google}</p>
        <p>{copy.revokeNote}</p>
        <PortalForm
          action={sessionAction}
          preview={preview}
          label={copy.revoke}
        />
      </section>
      <section className="account-panel">
        <h2>{copy.export}</h2>
        <p>{copy.exportNote}</p>
        {!preview ? (
          <a className="secondary-button" href="/account/export" download>
            {copy.export}
          </a>
        ) : null}
      </section>
      <section className="account-panel">
        <details>
          <summary>{copy.close}</summary>
          <p>{copy.closeNote}</p>
          <PortalForm
            action={sessionAction}
            preview={preview}
            label={copy.close}
          >
            <input type="hidden" name="close" value="yes" />
            <label className="account-check">
              <input type="checkbox" name="confirm" required />
              {copy.closeConfirm}
            </label>
          </PortalForm>
        </details>
      </section>
    </>
  );
}
export function AccountSupport({
  requests,
  orders,
  selectedOrder,
  action,
  preview,
}: {
  requests: readonly AccountRequest[];
  orders: readonly CustomerOrder[];
  selectedOrder?: string;
  action?: PortalFormAction;
  preview?: boolean;
}) {
  return (
    <>
      <section className="account-panel">
        <p>{copy.requestNote}</p>
        <PortalForm action={action} preview={preview} label={copy.send}>
          <input type="hidden" name="id" value={randomUUID()} />
          <label>
            {copy.kind}
            <select
              name="requestKind"
              defaultValue={selectedOrder ? "ORDER" : "OTHER"}
            >
              {Object.entries(copy.kinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.order}
            <select name="orderId" defaultValue={selectedOrder ?? ""}>
              <option value="">{copy.noOrder}</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.message}
            <textarea
              name="message"
              required
              maxLength={ACCOUNT_LIMITS.message}
              rows={6}
              aria-describedby="request-message-hint"
            />
          </label>
          <p id="request-message-hint" className="form-hint">
            {copy.messageHint}
          </p>
        </PortalForm>
      </section>
      <section className="account-panel">
        <h2>{copy.requests}</h2>
        {requests.length ? (
          requests.map((request) => (
            <article className="account-request" key={request.id}>
              <header>
                <h3>{copy.kinds[request.kind]}</h3>
                <p className="account-status">
                  {copy.statuses[request.status]}
                </p>
              </header>
              <time dateTime={request.createdAt}>
                {new Date(request.createdAt).toLocaleDateString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                })}
              </time>
              <details>
                <summary>{copy.confirmation}</summary>
                <code>{request.id}</code>
              </details>
              <p className="account-prewrap">{request.message}</p>
              {request.reply ? (
                <blockquote>
                  <strong>{copy.reply}</strong>
                  <p className="account-prewrap">{request.reply}</p>
                </blockquote>
              ) : null}
              {request.orderId ? (
                <Link
                  className="text-link"
                  href={"/account/orders/" + request.orderId}
                >
                  {copy.order}
                </Link>
              ) : null}
            </article>
          ))
        ) : (
          <p>{copy.emptyRequests}</p>
        )}
      </section>
    </>
  );
}

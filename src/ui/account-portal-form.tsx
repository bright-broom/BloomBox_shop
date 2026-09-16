"use client";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import type { PortalActionState } from "@/app/account/portal-actions";
import { customerPortalContent as copy } from "@/shared/infrastructure/content/customer-portal-content";
export type PortalFormAction = (
  previous: PortalActionState,
  form: FormData,
) => Promise<PortalActionState>;
export function PortalForm({
  action,
  children,
  label = copy.save,
  preview = false,
  once = false,
}: {
  action?: PortalFormAction;
  children?: ReactNode;
  label?: string;
  preview?: boolean;
  once?: boolean;
}) {
  const [state, submit, pending] = useActionState<PortalActionState, FormData>(
    action ?? (async () => ({ status: "idle" })),
    { status: "idle" },
  );
  const error =
    state.error && Object.hasOwn(copy, state.error)
      ? String(copy[state.error as keyof typeof copy])
      : copy.unavailable;
  return (
    <form action={submit} className="account-editor">
      <fieldset
        disabled={
          pending ||
          preview ||
          state.status === "sent" ||
          (once && state.status === "saved")
        }
      >
        {children}
        <button className="primary-button" type="submit">
          {pending ? copy.pending : label}
        </button>
      </fieldset>
      <div aria-live="polite">
        {once && state.status === "saved" ? (
          <button
            type="button"
            className="text-link"
            onClick={() => window.location.reload()}
          >
            {copy.addAddress}
          </button>
        ) : null}
        {state.status === "saved" || state.status === "sent" ? (
          <p role="status">{copy[state.status]}</p>
        ) : null}
        {state.status === "error" ? (
          <p role="alert" className="form-error">
            {error}{" "}
            {state.error === "expired" ? (
              <Link href="/account/login">{copy.login}</Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </form>
  );
}
export function CopyAddress({ value }: { value: string }) {
  const [status, setStatus] = useState("");
  return (
    <div>
      <button
        className="text-link"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus(copy.copied);
          } catch {
            setStatus(copy.copyFailed);
          }
        }}
      >
        {copy.copyAddress}
      </button>
      <span role="status">{status}</span>
    </div>
  );
}
export function PrintOrder() {
  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => window.print()}
    >
      {copy.print}
    </button>
  );
}

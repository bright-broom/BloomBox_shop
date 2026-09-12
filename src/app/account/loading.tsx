import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
export default function AccountLoading() {
  return <section className="section-shell account-page" aria-busy="true">
    <header className="account-heading"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1></header>
    <p role="status">{copy.loading}</p>
  </section>;
}

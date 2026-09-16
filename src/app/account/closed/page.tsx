import Link from "next/link";
import { customerPortalContent as copy } from "@/shared/infrastructure/content/customer-portal-content";
export const metadata = {
  title: copy.close,
  robots: { index: false, follow: false },
};
export default function ClosedAccount() {
  return (
    <section className="section-shell login-page">
      <h1>{copy.close}</h1>
      <p role="status">{copy.closeDone}</p>
      <Link className="secondary-button" href="/">
        BloomBox
      </Link>
    </section>
  );
}

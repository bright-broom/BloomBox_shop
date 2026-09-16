import type { Metadata } from "next";
import { requireOperatorLogin } from "@/shared/infrastructure/security/auth-entry";
import {
  openOperatorReport,
  operatorReportInput,
} from "@/shared/infrastructure/security/operator-auth/operations-console";
import { consoleResource } from "@/shared/infrastructure/security/operator-auth/console-resource";
import { operationsConsoleContent as copy } from "@/shared/infrastructure/content/operations-console-content";
import { OPERATOR_REPORT_PERIODS } from "@/modules/order/public";
import {
  ConsoleHeader,
  ConsoleState,
  ReportMetrics,
  DailyReport,
} from "@/ui/operations-console";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy.reports,
  robots: { index: false, follow: false },
};
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperatorLogin("/operations/reports");
  const input = await searchParams,
    parsed = operatorReportInput.safeParse(input);
  const state = await consoleResource(() => openOperatorReport(input));
  return (
    <>
      <ConsoleHeader title={copy.reports} lead={copy.todayIncluded} />
      <form className="ops-period" method="get" action="/operations/reports">
        <label htmlFor="report-period">{copy.period}</label>
        <select
          id="report-period"
          name="days"
          defaultValue={parsed.success ? parsed.data.days : "30"}
        >
          {OPERATOR_REPORT_PERIODS.map((days) => (
            <option key={days} value={days}>
              {days}
              {copy.days}
            </option>
          ))}
        </select>
        <button className="secondary-button" type="submit">
          {copy.refresh}
        </button>
      </form>
      {state.status === "ready" ? (
        <>
          <ReportMetrics report={state.value} />
          <DailyReport report={state.value} />
          <dl className="ops-facts">
            <div>
              <dt>{copy.captured}</dt>
              <dd>
                {state.value.captured}
                {copy.unit}
              </dd>
            </div>
            <div>
              <dt>{copy.cancelled}</dt>
              <dd>
                {state.value.cancelled}
                {copy.unit}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <ConsoleState status={state.status} />
      )}
    </>
  );
}

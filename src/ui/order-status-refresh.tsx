"use client";

import {
  ORDER_STATUS_POLL_INTERVAL_MS,
  ORDER_STATUS_POLL_LIMIT,
} from "@/modules/order/public";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function OrderStatusRefresh({ reference }: { reference: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (attempt >= ORDER_STATUS_POLL_LIMIT) return;
    const timer = window.setTimeout(() => {
      setAttempt((current) => current + 1);
      router.refresh();
    }, ORDER_STATUS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, reference, router]);

  return (
    <div className="order-refresh" role="status">
      <p>
        {attempt < ORDER_STATUS_POLL_LIMIT
          ? "注文確定まで、このページを自動で更新します。"
          : "確認に時間がかかっています。時間をおいてページを更新してください。"}
      </p>
      <button className="text-button" type="button" onClick={() => router.refresh()}>
        今すぐ更新
      </button>
    </div>
  );
}

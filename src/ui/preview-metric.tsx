"use client";
import { useEffect, useRef } from "react";
import { recordPreviewMetric, type PreviewMetric as Metric } from "@/shared/infrastructure/preview-metrics";

export function PreviewMetric({ event }: { event: Metric }) {
  const serialized = JSON.stringify(event);
  const last = useRef<string | undefined>(undefined);
  useEffect(() => { if (last.current !== serialized) { recordPreviewMetric(JSON.parse(serialized)); last.current = serialized; } }, [serialized]);
  return null;
}

"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface AgentSeriesPoint {
  date: string;
  assigned: number;
  replied: number;
  handled: number;
  passthrough: number;
}

export function AgentSeriesChart({ data }: { data: AgentSeriesPoint[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="h-72 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      {mounted ? (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={(d) => d.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #e5e7eb",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="assigned"
            stroke="#64748b"
            strokeWidth={2}
            dot={false}
            name="Assigned"
          />
          <Line
            type="monotone"
            dataKey="replied"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
            name="Replied"
          />
          <Line
            type="monotone"
            dataKey="handled"
            stroke="#16a34a"
            strokeWidth={2}
            dot={false}
            name="Handled"
          />
          <Line
            type="monotone"
            dataKey="passthrough"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            name="Passthrough"
          />
        </LineChart>
      </ResponsiveContainer>
      ) : null}
    </div>
  );
}

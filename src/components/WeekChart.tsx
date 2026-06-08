"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface WeekChartDatum {
  name: string;
  handled: number;
  passthrough: number;
}

export function WeekChart({ data }: { data: WeekChartDatum[] }) {
  return (
    <div className="h-72 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-15}
            dy={8}
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
          <Bar
            dataKey="handled"
            stackId="r"
            fill="#16a34a"
            name="Handled"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="passthrough"
            stackId="r"
            fill="#94a3b8"
            name="Passthrough"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

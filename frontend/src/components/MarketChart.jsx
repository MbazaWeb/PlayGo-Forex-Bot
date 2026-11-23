import React from 'react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Brush } from 'recharts';

export default function MarketChart({ data, tall, line = false, label = 'Value' }) {
  const safe = Array.isArray(data) ? data.filter((d) => d && Number.isFinite(Number(d.value))) : [];

  if (!safe.length) {
    return <div className={'chart ' + (tall ? 'tall' : '')}><p role="status">No data.</p></div>;
  }

  const Chart = line ? LineChart : AreaChart;

  return (
    <div className={'chart ' + (tall ? 'tall' : '')}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={safe} margin={{ top: 10, right: 6, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#37d8bd" stopOpacity={0.23} />
              <stop offset="95%" stopColor="#37d8bd" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#253040" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#7f8c9e', fontSize: 11 }} minTickGap={24} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#7f8c9e', fontSize: 11 }} axisLine={false} tickLine={false} orientation="right" />
          <Tooltip
            contentStyle={{ background: '#18212e', border: '1px solid #344051', borderRadius: 12, color: '#fff' }}
            formatter={(v) => [Number(v).toLocaleString(undefined, { maximumFractionDigits: 5 }), label]}
          />
          {line ? (
            <Line type="linear" dataKey="value" stroke="#45d5c5" dot={false} />
          ) : (
            <Area type="monotone" dataKey="value" stroke="#45d5c5" strokeWidth={2.3} fill="url(#area)" dot={false} activeDot={{ r: 5, fill: '#45d5c5' }} />
          )}
          {/* BRUSH: Hii inaongeza uwezo wa kuzoom na kusogeza */}
          <Brush dataKey="time" height={30} stroke="#45d5c5" fill="#131c28" travellerWidth={10} />
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}
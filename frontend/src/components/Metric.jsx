import React from 'react';
import { Activity } from 'lucide-react';

export default function Metric({ title, value, change, icon: Icon = Activity, positive }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{title}</span>
        <span className="metric-icon"><Icon size={19} /></span>
      </div>
      <strong>{value}</strong>
      <small className={positive ? 'gain' : 'muted'}>{change || 'Demo workspace'}</small>
    </div>
  );
}
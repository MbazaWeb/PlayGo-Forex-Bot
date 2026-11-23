import React, { useEffect, useRef } from 'react';
// 1. Import series types mpya pamoja na createChart
import {
  createChart,
  ColorType,
  CrosshairMode,
  AreaSeries,
  LineSeries,
  CandlestickSeries
} from 'lightweight-charts';

export default function ProChart({ data, type = 'Candlestick', height = 400 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !data || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#7f8c9e',
      },
      grid: {
        vertLines: { color: '#253040' },
        horzLines: { color: '#253040' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#45d5c5', width: 1, style: 3, labelBackgroundColor: '#18212e' },
        horzLine: { color: '#45d5c5', width: 1, style: 3, labelBackgroundColor: '#18212e' },
      },
      timeScale: {
        borderColor: '#253040',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#253040',
      },
      width: containerRef.current.clientWidth,
      height: height,
    });

    chartRef.current = chart;

    let series;

    // 2. Tumia addSeries(SeriesType, options)
    if (type === 'Line') {
      series = chart.addSeries(LineSeries, {
        color: '#45d5c5',
        lineWidth: 2,
      });
      series.setData(data.map((d) => ({
        time: d.epoch,
        value: Number(d.close),
      })));
    } else if (type === 'Area') {
      series = chart.addSeries(AreaSeries, {
        lineColor: '#45d5c5',
        topColor: 'rgba(69, 213, 197, 0.4)',
        bottomColor: 'rgba(69, 213, 197, 0.0)',
        lineWidth: 2,
      });
      const areaData = data.map((d) => ({
        time: d.epoch,
        value: Number(d.close),
      }));
      series.setData(areaData);
    } else {
      // Kwa Candlestick, tumia CandlestickSeries
      series = chart.addSeries(CandlestickSeries, {
        upColor: '#45d5c5',
        downColor: '#ff6985',
        borderVisible: false,
        wickUpColor: '#45d5c5',
        wickDownColor: '#ff6985',
      });

      const candleData = data.map((d) => ({
        time: d.epoch,
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
      }));
      series.setData(candleData);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, type, height]);

  return (
    <div className="pro-chart-container" style={{ position: 'relative', width: '100%' }}>
      <div ref={containerRef} />
    </div>
  );
}
import React, { useEffect, useRef, useState } from 'react';
// 1. Import series types mpya pamoja na createChart
import {
  createChart,
  ColorType,
  CrosshairMode,
  AreaSeries,
  LineSeries,
  CandlestickSeries
} from 'lightweight-charts';

export default function ProChart({ data, type = 'Candlestick', height = 400, showAverage = false, tools = false }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [hover, setHover] = useState(null);

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

    if (showAverage) {
      const average = chart.addSeries(LineSeries, {
        color: '#ffcf69', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      });
      average.setData(data.slice(19).map((row, index) => ({
        time: row.epoch,
        value: data.slice(index, index + 20).reduce((sum, bar) => sum + bar.close, 0) / 20,
      })));
    }

    if (tools) {
      const bars = new Map(data.map(row => [row.epoch, row]));
      chart.subscribeCrosshairMove(event => setHover(bars.get(event.time) || null));
    }
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      chart.applyOptions({ width, height: tools && width < 480 ? 300 : height });
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    handleResize();

    return () => {
      observer.disconnect();
      chartRef.current = null;
      chart.remove();
    };
  }, [data, type, height, showAverage, tools]);

  const candle = data?.includes(hover) ? hover : data?.at(-1);

  return (
    <div className="pro-chart-container" style={{ position: 'relative', width: '100%' }}>
      {tools && candle && <div className="terminal-chart-readout">
        <div><span>O {candle.open}</span><span>H {candle.high}</span><span>L {candle.low}</span><span>C {candle.close}</span></div>
        <button type="button" className="outline" onClick={() => chartRef.current?.timeScale().fitContent()}>Reset view</button>
      </div>}
      <div ref={containerRef} />
    </div>
  );
}
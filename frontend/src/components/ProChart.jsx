import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize } from 'lucide-react';
import { createChart, ColorType, CrosshairMode, AreaSeries, LineSeries, CandlestickSeries } from 'lightweight-charts';

const up = '#55d6ad';
const down = '#ff8995';
const seriesTypes = { Candlestick: CandlestickSeries, Area: AreaSeries, Line: LineSeries };

export default function ProChart({ data, type = 'Candlestick', height = 400, showAverage = false, tools = false }) {
  const container = useRef(null);
  const plot = useRef(null);
  const [hoverTime, setHoverTime] = useState(null);

  useEffect(() => {
    const element = container.current;
    const chart = createChart(element, {
      width: element.clientWidth, height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#acbad2' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#26344a' } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: '#334158', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#334158' },
    });
    const price = chart.addSeries(seriesTypes[type], type === 'Candlestick' ? {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
    } : type === 'Area' ? {
      lineColor: '#91abff', topColor: '#7698ff60', bottomColor: '#7698ff00', lineWidth: 2,
    } : { color: '#91abff', lineWidth: 2 });
    const average = chart.addSeries(LineSeries, {
      color: '#f6c879', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    });
    plot.current = { chart, price, average, initialized: false };
    if (tools) chart.subscribeCrosshairMove(event => setHoverTime(event.time ?? null));
    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: element.clientWidth, height: element.clientWidth < 480 ? Math.min(height, 300) : height });
    });
    observer.observe(element);
    return () => { observer.disconnect(); plot.current = null; chart.remove(); };
  }, [height, tools, type]);

  useEffect(() => {
    const { chart, price, average, initialized } = plot.current;
    const precision = Math.min(8, Math.max(2, ...data.flatMap(row =>
      [row.open, row.high, row.low, row.close].map(value => {
        const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
        return (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
      }))));
    price.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    price.setData(data.map(({ epoch: time, open, high, low, close }) => type === 'Candlestick'
      ? { time, open, high, low, close } : { time, value: close }));
    average.setData(showAverage ? data.slice(19).map((row, index) => ({
      time: row.epoch, value: data.slice(index, index + 20).reduce((sum, bar) => sum + bar.close, 0) / 20,
    })) : []);
    if (!initialized && data.length) {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 70), to: data.length + 2 });
      plot.current.initialized = true;
    }
  }, [data, type, showAverage, height, tools]);

  function zoom(factor) {
    const scale = plot.current.chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    if (!range) return;
    const width = Math.max(8, Math.min(data.length + 3, (range.to - range.from) * factor));
    scale.setVisibleLogicalRange({ from: range.to - width, to: range.to });
  }
  const candle = data.find(row => row.epoch === hoverTime) ?? data.at(-1);
  return <div className="pro-chart-container">
    {tools && candle && <div className="terminal-chart-readout">
      <div>{[['O', candle.open], ['H', candle.high], ['L', candle.low], ['C', candle.close]].map(([key, value]) =>
        <span key={key}>{key} <b>{value}</b></span>)}</div>
      <div className="chart-tools" role="group" aria-label="Chart view">
        <button type="button" className="outline" aria-label="Zoom in" onClick={() => zoom(.7)}><Plus size={16} /></button>
        <button type="button" className="outline" aria-label="Zoom out" onClick={() => zoom(1.4)}><Minus size={16} /></button>
        <button type="button" className="outline" aria-label="Fit all candles" onClick={() => plot.current.chart.timeScale().fitContent()}><Maximize size={16} /></button>
      </div>
    </div>}
    <div ref={container} role="img" aria-label={type + ' price history in UTC' + (showAverage ? ' with 20-bar moving average' : '')} />
  </div>;
}

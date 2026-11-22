import test from 'node:test';
import assert from 'node:assert/strict';
import {readMarkets,readCandles} from './derivMarkets.js';

test('keeps unfamiliar market groups and deduplicates symbols',()=>{
 const row={underlying_symbol:'X',underlying_symbol_name:'Example',market:'new_market'};
 assert.deepEqual(readMarkets({active_symbols:[row,row,{}]}),[{symbol:'X',name:'Example',group:'new market'}]);
});

test('uses broker OHLC and rejects inconsistent candles',()=>{
 const candle={epoch:'1720000000',open:'5',high:'8',low:'4',close:'7'};
 const rows=readCandles({candles:[candle,{...candle,low:'6'},{...candle,high:null}]});
 assert.equal(rows.length,1);
 assert.deepEqual([rows[0].open,rows[0].high,rows[0].low,rows[0].value],[5,8,4,7]);
});

import test from 'node:test';import assert from 'node:assert/strict';import {paperRisk} from './paperRisk.js';
const base=()=>({cash:10000,positions:[],history:[],halted:false});
test('valid paper order passes',()=>assert.equal(paperRisk(base(),{price:1,units:100}),null));
test('rejects invalid orders',()=>{for(const [price,units] of [[0,10],[-1,10],[1,0],[1,1.5],[Infinity,2]])assert.ok(paperRisk(base(),{price,units}));});
test('enforces order and total exposure',()=>{assert.match(paperRisk(base(),{price:1,units:1001}),/1,000/);const l=base();l.positions=[{entry:1,units:2500}];assert.match(paperRisk(l,{price:1,units:600}),/3,000/);});
test('enforces emergency stop and daily loss',()=>{const l=base();l.halted=true;assert.match(paperRisk(l,{price:1,units:10}),/paused/);l.halted=false;l.history=[{pnl:-200,closedAt:'2026-11-20T12:00:00Z'}];assert.match(paperRisk(l,{price:1,units:10},new Date('2026-11-20T18:00:00Z')),/loss/);assert.equal(paperRisk(l,{price:1,units:10},new Date('2026-11-21T00:00:00Z')),null);});

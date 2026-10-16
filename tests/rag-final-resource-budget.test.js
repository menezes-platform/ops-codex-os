'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateBudget}=require('../scripts/evaluate-rag-final-resource-budget');
const limits={ram_peak_mb:850,queue_depth:100,p95_latency_ms:1200,battery_drain_percent_hour:5};
const measured={source:'observed',device:'desktop-windows',trace_sha256:'sha256:'+'a'.repeat(64),
 observed_at:'2026-10-15T18:00:00Z',ram_peak_mb:420,queue_depth:3,p95_latency_ms:600,
 battery_drain_percent_hour:0};
test('task_40_contract no unmeasured trace can claim pass',()=>{
 assert.equal(evaluateBudget({source:'synthetic'},limits).pass,false);
 assert.equal(evaluateBudget(null,limits).pass,false);
 assert.equal(evaluateBudget(measured,{}).pass,false);
 const result=evaluateBudget(measured,limits);
 assert.equal(result.pass,true);assert.equal(result.throttle,false);
});
test('task_40_contract overloaded queue forces throttling',()=>{
 const r=evaluateBudget({...measured,queue_depth:120},limits);
 assert.equal(r.pass,false);assert.equal(r.throttle,true);
});
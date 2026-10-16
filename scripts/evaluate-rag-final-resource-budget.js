'use strict';
// A measurement-only gate. Thresholds must be configured by the owner, not guessed from a host.
const REQUIRED=['ram_peak_mb','queue_depth','p95_latency_ms','battery_drain_percent_hour'];
function evaluateBudget(measuredTrace,configuredLimits) {
 const metrics={};
 const valid=measuredTrace && typeof measuredTrace==='object' && !Array.isArray(measuredTrace) &&
   measuredTrace.source==='observed' && ['desktop-windows','moto-g75'].includes(measuredTrace.device) &&
   /^sha256:[a-f0-9]{64}$/.test(measuredTrace.trace_sha256||'') &&
   typeof measuredTrace.observed_at==='string' && !Number.isNaN(Date.parse(measuredTrace.observed_at));
 const limits=!!configuredLimits && typeof configuredLimits==='object' && !Array.isArray(configuredLimits) &&
   REQUIRED.every(k=>Number.isFinite(configuredLimits[k]) && configuredLimits[k]>0);
 if (!valid || !limits) return Object.freeze({pass:false,throttle:false,reason:'UNVERIFIED_TRACE_OR_LIMITS',metrics:{}});
 let pass=true,throttle=false;
 for(const key of REQUIRED){
  const actual=measuredTrace[key],max=configuredLimits[key];
  if (!Number.isFinite(actual)||actual<0) return Object.freeze({pass:false,throttle:false,reason:'TRACE_INVALID',metrics:{}});
  metrics[key]={actual,max,exceeded:actual>max};
  if (actual>max) pass=false;
 }
 throttle=metrics.queue_depth.exceeded;
 return Object.freeze({pass,throttle,reason:pass?'MEASURED_WITHIN_BUDGET':'MEASURED_OVER_BUDGET',metrics});
}
if(require.main===module){process.stderr.write('Use evaluateBudget with observed trace and owner-configured limits; no implicit live probes.\n');}
module.exports={evaluateBudget};
'use strict';
const ALLOWED_SOURCES = new Set(['manual','git','agent','android_share','terminal']);
const SECRET = /(?:\b(?:password|passwd|api[_-]?key|secret|access[_-]?token|authorization)\s*[:=]\s*\S+|\bbearer\s+[a-z0-9_.-]{12,}|\b(?:sk-|ghp_|github_pat_)[a-z0-9_-]{16,})/i;
function assessCapture({sourceType,consentReceipt,content} = {}) {
 const denied = reason => ({allowed:false,reason});
 if (typeof sourceType !== 'string' || !ALLOWED_SOURCES.has(sourceType)) return denied('SENSITIVE_SOURCE');
 if (!consentReceipt || typeof consentReceipt !== 'object' ||
     Array.isArray(consentReceipt) || consentReceipt.active !== true ||
     consentReceipt.scope !== 'personal/current' ||
     consentReceipt.source_type !== sourceType ||
     typeof consentReceipt.receipt_id !== 'string' || !consentReceipt.receipt_id.trim())
   return denied('CONSENT_REQUIRED');
 if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content,'utf8') > 16384)
   return denied('CONTENT_INVALID');
 if (SECRET.test(content)) return denied('SECRET_DETECTED');
 return {allowed:true,reason:'ALLOWED',content};
}
module.exports = { assessCapture };
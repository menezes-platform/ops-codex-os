'use strict';
// Personal access must be supplied by the authenticated runtime, never model text.
function resolvePersonalScope({verifiedOwner,source} = {}) {
 if (source !== 'runtime' && source !== 'authenticated-session') throw new Error('OWNER_CONTEXT_UNTRUSTED');
 if (!verifiedOwner || typeof verifiedOwner !== 'object' ||
     Array.isArray(verifiedOwner) || verifiedOwner.verified !== true ||
     typeof verifiedOwner.principal_id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(verifiedOwner.principal_id) ||
     Object.keys(verifiedOwner).some(k => !['verified','principal_id'].includes(k)))
   throw new Error('OWNER_NOT_VERIFIED');
 return 'personal/current';
}
module.exports = { resolvePersonalScope };
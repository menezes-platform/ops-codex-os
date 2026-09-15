function resolveToolProfile(manifest = {}, needs = []) {
  const requested = Array.isArray(needs) ? needs : [];
  const required = ['PersistFlow'];
  for (const capability of requested) {
    const tool = manifest[capability];
    if (typeof tool !== 'string' || !tool.trim()) continue;
    if (!required.includes(tool)) required.push(tool);
  }
  return { required };
}

module.exports = { resolveToolProfile };

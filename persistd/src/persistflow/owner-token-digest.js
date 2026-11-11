const fs = require('node:fs');
const path = require('node:path');

// Owner approval is separate from the existing service bearer credential.
// Only an absent file preserves the legacy default. Present bad config fails closed.
function loadOwnerTokenDigest({dataDirectory} = {}) {
  let descriptor;
  try {
    if (!path.isAbsolute(dataDirectory || '') || /(?:^|[/\\])(?:public_html|hbuilds)(?:[/\\]|$)/.test(dataDirectory)) throw Error();
    const directory = path.join(dataDirectory, 'owner-auth');
    const filename = path.join(directory, 'current.sha256');
    let current = path.parse(filename).root;
    for (const component of filename.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
      if (stat.isSymbolicLink() || (current !== filename && !stat.isDirectory())) throw Error();
      if (current === directory && (stat.mode & 0o777) !== 0o700) throw Error();
    }
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size < 64 || stat.size > 65) throw Error();
    const text = fs.readFileSync(descriptor, 'utf8');
    if (!/^[a-f0-9]{64}\n?$/.test(text)) throw Error();
    return text.trim();
  } catch {
    throw new Error('OWNER_DIGEST_INVALID');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
module.exports = {loadOwnerTokenDigest};

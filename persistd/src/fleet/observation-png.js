const { crc32, inflateSync } = require('node:zlib');

// The canonical host emits non-interlaced 8-bit PNG. Check the full stream before
// forwarding image content to an MCP consumer; no external decoder or artifact.
function validatePng(bytes, width, height) {
  const invalid = () => { throw Error('INVALID_OBSERVATION_RESULT'); };
  let offset = 8, channels, sawData = false, dataEnded = false, ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || data.readUInt32BE(0) !== width || data.readUInt32BE(4) !== height
        || data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) invalid();
      channels = {0: 1, 2: 3, 4: 2, 6: 4}[data[9]];
      if (!channels) invalid();
    } else if (type === 'IDAT') {
      if (dataEnded) invalid();
      sawData = true; compressed.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData || end !== bytes.length) invalid();
      ended = true;
    } else {
      // Reject unknown critical chunks, repeated headers and unexpected palettes.
      if (type[0] === type[0].toUpperCase()) invalid();
      if (sawData) dataEnded = true;
    }
    offset = end;
  }
  if (!ended) invalid();
  const stride = width * channels + 1, expected = stride * height;
  let decoded;const input=Buffer.concat(compressed);
  try { decoded = inflateSync(input, {maxOutputLength: expected, info: true}); }
  catch { invalid(); }
  if (decoded.buffer.length !== expected || decoded.engine.bytesWritten !== input.length) invalid();
  for (let row = 0; row < height; row++) if (decoded.buffer[row * stride] > 4) invalid();
}
module.exports = {validatePng};

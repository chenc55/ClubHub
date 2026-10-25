// Jimp 0.22 calls CommonJS `fromBuffer`; patched file-type is ESM-only.
// Keep that one API while using the upstream patched parser without copying it.
let parser
module.exports.fromBuffer = async function fromBuffer(buffer) {
  parser ||= import('file-type-modern')
  return (await parser).fileTypeFromBuffer(buffer)
}

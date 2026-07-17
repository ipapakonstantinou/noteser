// Jest stub for uuid. Since v14 the package ships ESM only and trips
// Jest's default CJS loader. The app only imports { v4 }, and Node's
// crypto.randomUUID() produces a real v4 UUID, so tests keep genuine
// behavior without transforming the package.

const { randomUUID } = require('crypto')

module.exports = {
  v4: () => randomUUID(),
}

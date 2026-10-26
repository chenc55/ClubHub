'use strict'

// Offline tests must model real administrator records, not just mint JWTs.
function createAdminFixtures() {
  return ['super', 'auditor', 'viewer'].map((role, i) => ({
    _id: `a-${i + 1}`, username: ['root', 'auditor1', 'viewer1'][i],
    role, name: role, status: 'normal', deleted: 0, created_at: new Date(0),
    password_hash: 'unused-offline-fixture',
  }))
}

function adminCollection(rows = createAdminFixtures()) {
  return {
    where(condition) {
      const found = rows.filter(row => Object.entries(condition).every(([key, value]) => row[key] === value))
      const query = { limit: () => query, get: async () => ({ data: found.slice() }) }
      return query
    },
  }
}

module.exports = { createAdminFixtures, adminCollection }

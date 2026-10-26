// A required status check must fail, rather than be skipped, if any prerequisite fails.
let results
try { results = JSON.parse(process.env.REQUIRED_JOB_RESULTS || '{}') }
catch { console.error('Missing or invalid prerequisite results'); process.exit(1) }
const required = ['build-and-browser', 'dependencies', 'secrets']
const failed = required.filter(name => results?.[name]?.result !== 'success')
if (failed.length) {
  console.error(`Required jobs did not succeed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('Build, dependency audits and secret scan all succeeded')

// Local-only synthetic demo. No cloud services are contacted.
const { spawn } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const env = { ...process.env, VITE_API_BASE: 'http://127.0.0.1:4175', VITE_ENABLE_TEST_LOGIN: 'true' }
const children = []
function launch(cwd, script, args = []) {
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.on('error', (error) => { console.error(error.message); shutdown(1) })
  child.on('exit', (code) => { if (code) shutdown(code) })
}
let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exit(code)
}
launch(root, path.join(__dirname, 'server.cjs'))
launch(path.join(root, 'uniapp'), path.join(root, 'uniapp/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), ['--host', '127.0.0.1', '--port', '5173', '--strictPort'])
launch(path.join(root, 'admin'), path.join(root, 'admin/node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', '5174', '--strictPort'])
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
console.log('Local synthetic demo: student http://127.0.0.1:5173 | admin http://127.0.0.1:5174')

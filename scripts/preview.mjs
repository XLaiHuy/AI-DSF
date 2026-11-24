import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const apiEntry = fileURLToPath(new URL('../apps/api/dist/main.js', import.meta.url))
if (!existsSync(apiEntry)) {
  console.error('Chưa có bản build API. Chạy pnpm --filter api build trước khi mở preview.')
  process.exit(1)
}

const windows = process.platform === 'win32'
const options = { cwd, stdio: 'inherit', windowsHide: true, detached: !windows }
const pnpmEntry = process.env.npm_execpath
const children = [
  spawn(process.execPath, [apiEntry], options),
  pnpmEntry && /\.[cm]?js$/i.test(pnpmEntry)
    ? spawn(process.execPath, [pnpmEntry, '--filter', 'web', 'start'], options)
    : windows
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'pnpm --filter web start'], options)
      : spawn('pnpm', ['--filter', 'web', 'start'], options),
]

let shuttingDown = false
function stop(exitCode) {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
    if (windows) spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
      .on('error', () => child.kill())
    else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
}

process.once('SIGINT', () => stop(130))
process.once('SIGTERM', () => stop(143))
for (const child of children) {
  child.once('exit', (code) => stop(code ?? 1))
  child.once('error', (error) => {
    console.error(error.message)
    stop(1)
  })
}

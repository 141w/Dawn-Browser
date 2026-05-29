const { spawn } = require('child_process')
const { ipcMain } = require('electron')

class ScriptRunner {
  constructor() {
    this._activeProcesses = new Map()
  }

  run(language, code, timeout = 30000) {
    return new Promise((resolve, reject) => {
      let cmd, args

      switch ((language || '').toLowerCase()) {
        case 'bash':
        case 'sh':
          cmd = process.platform === 'win32' ? 'cmd' : 'bash'
          args = process.platform === 'win32' ? ['/c', code] : ['-c', code]
          break
        case 'python':
        case 'python3':
          cmd = process.platform === 'win32' ? 'python' : 'python3'
          args = ['-c', code]
          break
        case 'node':
        case 'javascript':
        case 'js':
          cmd = 'node'
          args = ['-e', code]
          break
        default:
          reject(new Error(`Unsupported language: ${language}. Supported: bash, python, node`))
          return
      }

      const proc = spawn(cmd, args, {
        timeout,
        shell: false,
        env: { ...process.env },
        cwd: process.env.HOME || process.env.USERPROFILE || process.cwd()
      })

      const procId = 'script_' + Date.now()
      this._activeProcesses.set(procId, proc)

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => { stdout += data.toString() })
      proc.stderr.on('data', (data) => { stderr += data.toString() })

      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch {}
        resolve({ ok: false, exitCode: -1, stdout: stdout.substring(0, 10000), stderr: 'Script timed out after ' + timeout + 'ms', timedOut: true })
      }, timeout)

      proc.on('close', (exitCode) => {
        clearTimeout(timer)
        this._activeProcesses.delete(procId)
        resolve({
          ok: exitCode === 0,
          exitCode,
          stdout: stdout.substring(0, 10000),
          stderr: stderr.substring(0, 5000)
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        this._activeProcesses.delete(procId)
        resolve({ ok: false, exitCode: -1, stdout: '', stderr: err.message })
      })
    })
  }

  killAll() {
    for (const [, proc] of this._activeProcesses) {
      try { proc.kill('SIGKILL') } catch {}
    }
    this._activeProcesses.clear()
  }
}

const scriptRunner = new ScriptRunner()

function registerScriptRunnerIpc() {
  ipcMain.handle('run-script', async (_event, language, code, timeout) => {
    try {
      return await scriptRunner.run(language, code, timeout)
    } catch (e) {
      return { ok: false, exitCode: -1, stdout: '', stderr: e.message }
    }
  })

  ipcMain.handle('kill-scripts', () => {
    scriptRunner.killAll()
    return { success: true }
  })
}

module.exports = { scriptRunner, registerScriptRunnerIpc }

const { app, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
const { execSync, exec } = require('child_process')
const os = require('os')

const SKILLS_DIR = path.join(app.getPath('userData'), 'skills')
const MANIFEST_PATH = path.join(SKILLS_DIR, 'manifest.json')

function ensureDir() {
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveManifest(manifest) {
  ensureDir()
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}

function findSkillMd(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isFile() && e.name === 'SKILL.md') return path.join(dir, e.name)
    if (e.isDirectory()) {
      const found = findSkillMd(path.join(dir, e.name))
      if (found) return found
    }
  }
  return null
}

function readSkillMeta(skillDir) {
  const mdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(mdPath)) return null
  const content = fs.readFileSync(mdPath, 'utf8')
  const fm = parseFrontmatter(content)
  return {
    name: fm.name || path.basename(skillDir),
    description: fm.description || '',
    filePath: mdPath,
    baseDir: skillDir,
    source: 'installed',
    disableModelInvocation: false
  }
}

function parseFrontmatter(content) {
  if (!content) return {}
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return {}
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return {}
  const block = trimmed.slice(3, end).trim()
  const result = {}
  let currentKey = null
  let currentIndent = 0
  let collecting = false
  let collected = ''

  for (const line of block.split('\n')) {
    const indent = line.search(/\S/)
    if (indent === -1) {
      if (collecting) collected += '\n'
      continue
    }
    const trimmedLine = line.trim()
    const colonIdx = trimmedLine.indexOf(':')
    if (colonIdx > 0 && !collecting) {
      const key = trimmedLine.slice(0, colonIdx).trim()
      let value = trimmedLine.slice(colonIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (value === '' || value === '|' || value === '>') {
        currentKey = key
        currentIndent = indent
        collecting = true
        collected = ''
      } else {
        result[key] = value
      }
    } else if (collecting && indent > currentIndent) {
      collected += (collected ? '\n' : '') + trimmedLine
    } else if (collecting) {
      result[currentKey] = collected
      collecting = false
      collected = ''
      currentKey = null
      const ci = trimmedLine.indexOf(':')
      if (ci > 0) {
        const k = trimmedLine.slice(0, ci).trim()
        let v = trimmedLine.slice(ci + 1).trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1)
        }
        result[k] = v
      }
    }
  }
  if (collecting) result[currentKey] = collected
  return result
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirSync(srcPath, destPath)
    else fs.copyFileSync(srcPath, destPath)
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        downloadFile(res.headers.location, dest).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error('HTTP ' + res.statusCode))
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', (err) => { file.close(); fs.unlinkSync(dest); reject(err) })
  })
}

async function installFromGithub(githubUrl, useSymlink) {
  ensureDir()
  const manifest = loadManifest()

  // Parse GitHub URL: https://github.com/owner/repo or owner/repo
  let owner, repo
  const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\s]+)/)
  if (urlMatch) {
    owner = urlMatch[1]
    repo = urlMatch[2].replace(/\.git$/, '')
  } else if (githubUrl.match(/^[^\/]+\/[^\/]+$/)) {
    [owner, repo] = githubUrl.split('/')
  } else {
    throw new Error('Invalid GitHub URL format')
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.git`
  const tmpDir = path.join(os.tmpdir(), `dawn-skill-${Date.now()}`)
  const skillName = repo

  try {
    // Try git clone first
    try {
      execSync(`git clone --depth 1 "${cloneUrl}" "${tmpDir}"`, { timeout: 30000, stdio: 'pipe' })
    } catch {
      // Fallback: download zip
      const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`
      const zipPath = path.join(os.tmpdir(), `dawn-skill-${Date.now()}.zip`)
      await downloadFile(zipUrl, zipPath)
      // Extract using PowerShell (built-in on Windows)
      const tmpExtract = tmpDir + '_extract'
      fs.mkdirSync(tmpExtract, { recursive: true })
      try {
        execSync('powershell -Command "Expand-Archive -Path \'' + zipPath + '\' -DestinationPath \'' + tmpExtract + '\' -Force"', { timeout: 30000, stdio: 'pipe' })
      } catch {
        // Fallback: try tar
        execSync('tar -xf "' + zipPath + '" -C "' + tmpExtract + '"', { timeout: 30000, stdio: 'pipe' })
      }
      // Move contents from nested directory
      const nested = fs.readdirSync(tmpExtract).find(d => d.startsWith(repo))
      if (nested) {
        const nestedPath = path.join(tmpExtract, nested)
        copyDirSync(nestedPath, tmpDir)
        fs.rmSync(tmpExtract, { recursive: true })
      } else {
        copyDirSync(tmpExtract, tmpDir)
        fs.rmSync(tmpExtract, { recursive: true })
      }
      fs.unlinkSync(zipPath)
    }

    // Find SKILL.md
    const skillMdPath = findSkillMd(tmpDir)
    if (!skillMdPath) throw new Error('No SKILL.md found in repository')

    const skillDir = path.dirname(skillMdPath)
    const destDir = path.join(SKILLS_DIR, skillName)

    // Remove old version if exists
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true })

    if (useSymlink) {
      fs.symlinkSync(skillDir, destDir, 'junction')
    } else {
      copyDirSync(skillDir, destDir)
    }

    const meta = readSkillMeta(destDir)
    manifest[skillName] = {
      source: `github:${owner}/${repo}`,
      installedAt: Date.now(),
      mode: useSymlink ? 'symlink' : 'copy',
      path: destDir
    }
    saveManifest(manifest)

    return { success: true, skill: meta }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
  }
}

async function installFromZip(zipPath) {
  ensureDir()
  const manifest = loadManifest()

  const tmpDir = path.join(os.tmpdir(), `dawn-skill-zip-${Date.now()}`)
  try {
    const tmpExtract = tmpDir + '_extract'
    fs.mkdirSync(tmpExtract, { recursive: true })
    try {
      execSync('powershell -Command "Expand-Archive -Path \'' + zipPath + '\' -DestinationPath \'' + tmpExtract + '\' -Force"', { timeout: 30000, stdio: 'pipe' })
    } catch {
      execSync('tar -xf "' + zipPath + '" -C "' + tmpExtract + '"', { timeout: 30000, stdio: 'pipe' })
    }
    copyDirSync(tmpExtract, tmpDir)
    fs.rmSync(tmpExtract, { recursive: true })

    const skillMdPath = findSkillMd(tmpDir)
    if (!skillMdPath) throw new Error('No SKILL.md found in ZIP')

    const fm = parseFrontmatter(fs.readFileSync(skillMdPath, 'utf8'))
    const skillName = fm.name || path.basename(zipPath, '.zip')
    const skillDir = path.dirname(skillMdPath)
    const destDir = path.join(SKILLS_DIR, skillName)

    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true })
    copyDirSync(skillDir, destDir)

    const meta = readSkillMeta(destDir)
    manifest[skillName] = {
      source: `zip:${path.basename(zipPath)}`,
      installedAt: Date.now(),
      mode: 'copy',
      path: destDir
    }
    saveManifest(manifest)

    return { success: true, skill: meta }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
  }
}

function uninstallSkill(name) {
  const manifest = loadManifest()
  const entry = manifest[name]
  if (!entry) return false

  const skillDir = entry.path || path.join(SKILLS_DIR, name)
  if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true })

  delete manifest[name]
  saveManifest(manifest)
  return true
}

async function updateSkill(name) {
  const manifest = loadManifest()
  const entry = manifest[name]
  if (!entry || !entry.source.startsWith('github:')) {
    throw new Error('Can only update GitHub-installed skills')
  }
  const githubPath = entry.source.replace('github:', '')
  const useSymlink = entry.mode === 'symlink'
  uninstallSkill(name)
  return installFromGithub(githubPath, useSymlink)
}

function listInstalled() {
  ensureDir()
  const manifest = loadManifest()
  const result = []
  for (const [name, entry] of Object.entries(manifest)) {
    const skillDir = entry.path || path.join(SKILLS_DIR, name)
    if (!fs.existsSync(skillDir)) continue
    const meta = readSkillMeta(skillDir)
    if (meta) {
      result.push({ ...meta, installInfo: entry })
    }
  }
  return result
}

function openSkillFolder(name) {
  const skillDir = path.join(SKILLS_DIR, name)
  if (fs.existsSync(skillDir)) shell.openPath(skillDir)
}

function registerSkillIpc() {
  ipcMain.handle('skill:install-github', async (event, url, useSymlink) => {
    try { return await installFromGithub(url, useSymlink) }
    catch (e) { console.error('[SkillManager] Install failed:', e.message); return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:install-zip', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths[0]) return { success: false, error: 'Cancelled' }
      return await installFromZip(result.filePaths[0])
    } catch (e) { console.error('[SkillManager] ZIP install failed:', e.message); return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:uninstall', (event, name) => {
    try { return uninstallSkill(name) }
    catch (e) { console.error('[SkillManager] Uninstall failed:', e.message); return false }
  })

  ipcMain.handle('skill:update', async (event, name) => {
    try { return await updateSkill(name) }
    catch (e) { console.error('[SkillManager] Update failed:', e.message); return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:list', () => {
    try { return listInstalled() }
    catch { return [] }
  })

  ipcMain.handle('skill:open-folder', (event, name) => {
    try { openSkillFolder(name) }
    catch {}
  })
}

module.exports = { registerSkillIpc }
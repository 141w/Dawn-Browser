import { ref } from 'vue'

/* ── Types ── */
// Skill: { name, description, filePath, baseDir, source, disableModelInvocation }
// SkillEntry: { skill, frontmatter, invocation, metadata }

/* ── State ── */
const skills = ref([])
const skillEntries = ref([])
let _loaded = false

/* ── YAML frontmatter parser ── */
function parseFrontmatterBlock(content) {
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

  const lines = block.split('\n')
  for (const line of lines) {
    const indent = line.search(/\S/)
    if (indent === -1) {
      if (collecting) collected += '\n'
      continue
    }
    const content = line.trim()
    const colonIdx = content.indexOf(':')
    if (colonIdx > 0 && !collecting) {
      const key = content.slice(0, colonIdx).trim()
      let value = content.slice(colonIdx + 1).trim()
      // Unquote
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (value === '' || value === '|' || value === '>') {
        // Multi-line or block scalar
        currentKey = key
        currentIndent = indent
        collecting = true
        collected = value === '' ? '' : ''
      } else {
        result[key] = value
      }
    } else if (collecting && indent > currentIndent) {
      collected += (collected ? '\n' : '') + content
    } else if (collecting) {
      result[currentKey] = collected
      collecting = false
      collected = ''
      currentKey = null
      // Re-process this line
      const c2 = content
      const ci2 = c2.indexOf(':')
      if (ci2 > 0) {
        const k2 = c2.slice(0, ci2).trim()
        let v2 = c2.slice(ci2 + 1).trim()
        if ((v2.startsWith('"') && v2.endsWith('"')) ||
            (v2.startsWith("'") && v2.endsWith("'"))) {
          v2 = v2.slice(1, -1)
        }
        result[k2] = v2
      }
    }
  }
  if (collecting) result[currentKey] = collected

  // Parse nested metadata.openclaw JSON
  if (result.metadata) {
    try {
      result._metadata = JSON.parse(result.metadata)
    } catch {
      // Try parsing as YAML-style nested
      try {
        const jsonStr = result.metadata
          .replace(/(\w+):/g, '"$1":')
          .replace(/:\s*"([^"]*?)"/g, (m, v) => `: "${v}"`)
        result._metadata = JSON.parse(jsonStr)
      } catch {
        result._metadata = {}
      }
    }
  }

  return result
}

/* ── Boolean parser ── */
function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const s = String(raw).trim().toLowerCase()
  if (s === 'true' || s === '1') return true
  if (s === 'false' || s === '0') return false
  return fallback
}

/* ── Skill invocation policy ── */
function resolveInvocationPolicy(frontmatter) {
  return {
    userInvocable: parseBool(frontmatter['user-invocable'], true),
    disableModelInvocation: parseBool(frontmatter['disable-model-invocation'], false)
  }
}

/* ── Available skills prompt (OpenClaw-compatible XML) ── */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatSkillsForPrompt(skillsList) {
  const visible = skillsList.filter(s => !s.disableModelInvocation)
  if (visible.length === 0) return ''

  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    'Use the read tool to load a skill file when the task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use that absolute path in tool commands.',
    '',
    '<available_skills>'
  ]
  for (const skill of visible) {
    lines.push('  <skill>')
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    lines.push(`    <description>${escapeXml(skill.description)}</description>`)
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
    lines.push('  </skill>')
  }
  lines.push('</available_skills>')
  return lines.join('\n')
}

/* ── Build slash command specs ── */
function buildSkillCommandSpecs(skillsList) {
  const commands = []
  for (const skill of skillsList) {
    const entry = skillEntries.value.find(e => e.skill.name === skill.name)
    const invocation = entry?.invocation || resolveInvocationPolicy({})
    if (!invocation.userInvocable) continue

    const rawName = skill.name
    const cmdName = rawName.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'skill'
    commands.push({
      name: '/' + cmdName,
      description: (skill.description || '').slice(0, 100),
      category: 'skill',
      skillName: skill.name,
      skillFilePath: skill.filePath,
      execute: async (context, args) => {
        // Skill slash commands load the SKILL.md content and present it as context
        return {
          type: 'prompt',
          message: `Please use the skill "${skill.name}". Read the skill file at: ${skill.filePath}\n\nThe skill description is: ${skill.description}`
        }
      }
    })
  }
  return commands
}

/* ── Load skills from SKILL.md files ── */
async function loadSkills() {
  if (_loaded) return
  _loaded = true

  const entries = []

  // Use Vite glob to discover all SKILL.md files
  const skillModules = import.meta.glob('/skills/**/SKILL.md', {
    query: '?raw',
    import: 'default',
    eager: true
  })

  for (const [filePath, content] of Object.entries(skillModules)) {
    try {
      const frontmatter = parseFrontmatterBlock(content)
      const name = frontmatter.name?.trim()
      const description = frontmatter.description?.trim()
      if (!name || !description) {
        console.warn('[SkillSystem] Skipping skill with missing name/description:', filePath)
        continue
      }

      const invocation = resolveInvocationPolicy(frontmatter)
      const baseDir = filePath.replace(/\/SKILL\.md$/, '')

      const skill = {
        name,
        description,
        filePath,
        baseDir,
        source: 'bundled',
        disableModelInvocation: invocation.disableModelInvocation
      }

      entries.push({
        skill,
        frontmatter,
        invocation,
        metadata: frontmatter._metadata || null
      })
    } catch (e) {
      console.error('[SkillSystem] Error loading skill:', filePath, e)
    }
  }

  // Sort alphabetically
  entries.sort((a, b) => a.skill.name.localeCompare(b.skill.name))

  skillEntries.value = entries
  skills.value = entries.map(e => e.skill)

  console.log(
    '[SkillSystem] Loaded ' + skills.value.length + ' skills:',
    skills.value.map(s => s.name).join(', ')
  )

  return skills.value
}

/* ── Public API ── */
export function useSkillSystem() {
  loadSkills()

  return {
    skills,
    skillEntries,
    loadSkills,
    formatSkillsForPrompt,
    buildSkillCommandSpecs,
    parseFrontmatterBlock
  }
}

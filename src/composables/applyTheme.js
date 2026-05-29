/**
 * Apply theme from config to document.documentElement.
 * Called at app startup in every entry point.
 */
export function applyThemeFromStorage() {
  try {
    const saved = localStorage.getItem('dawn-ai-config')
    if (saved) {
      const config = JSON.parse(saved)
      const theme = config.theme || 'light'
      document.documentElement.setAttribute('data-theme', theme)
      if (config.fontSize) {
        document.documentElement.style.fontSize = config.fontSize + 'px'
      }
    }
  } catch {}
}

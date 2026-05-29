<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { t } from './composables/useI18n'
import { resolveUrl } from './composables/useSearchEngine'

const query = ref('')
const searchInput = ref(null)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return t('newtab.greeting.midnight')
  if (h < 12) return t('newtab.greeting.morning')
  if (h < 14) return t('newtab.greeting.noon')
  if (h < 18) return t('newtab.greeting.afternoon')
  return t('newtab.greeting.evening')
})

const shortcuts = [
  { name: 'GitHub', url: 'https://github.com', letter: 'Gh', color: 'var(--color-text)' },
  { name: 'Google', url: 'https://www.google.com', letter: 'Go', color: 'var(--color-text)' },
  { name: 'Bilibili', url: 'https://www.bilibili.com', letter: 'Bi', color: 'var(--color-text)' },
  { name: '知乎', url: 'https://www.zhihu.com', letter: '知', color: 'var(--color-text)' },
  { name: 'YouTube', url: 'https://www.youtube.com', letter: 'Yt', color: 'var(--color-text)' },
  { name: 'Twitter', url: 'https://x.com', letter: 'X', color: 'var(--color-text)' },
]

function navigateTo(url) {
  if (window.electronAPI && window.electronAPI.navigate) {
    window.electronAPI.navigate(url)
  } else {
    window.location.href = url
  }
}

function submit() {
  const url = resolveUrl(query.value)
  if (url) navigateTo(url)
}

function go(url) {
  navigateTo(url)
}

const now = ref(new Date())
let timer = null

onMounted(() => {
  timer = setInterval(() => { now.value = new Date() }, 1000)
  if (searchInput.value) {
    searchInput.value.focus()
  }
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const timeStr = computed(() => {
  const d = now.value
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
})

const dateStr = computed(() => {
  const d = now.value
  const days = [t('newtab.sun'), t('newtab.mon'), t('newtab.tue'), t('newtab.wed'), t('newtab.thu'), t('newtab.fri'), t('newtab.sat')]
  return `${d.getMonth() + 1}/${d.getDate()} ${days[d.getDay()]}`
})
</script>

<template>
  <div class="newtab">
    <div class="center">
      <div class="time">{{ timeStr }}</div>
      <div class="date">{{ dateStr }}</div>
      <div class="greeting">{{ greeting }}</div>

      <div class="search-wrap">
        <div class="search" :class="{ focused: query.length > 0 }">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            @keydown.enter="submit"
            :placeholder="t('newtab.search')"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="shortcuts">
        <button v-for="s in shortcuts" :key="s.name" class="shortcut" @click="go(s.url)">
          <div class="shortcut-letter" :style="{ background: s.color }">{{ s.letter }}</div>
          <span class="shortcut-name">{{ s.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.newtab {
  min-height: 100vh;
  background: var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Camera Plain Variable', ui-sans-serif, system-ui, sans-serif;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 520px;
  padding: 0 24px;
}

.time {
  font-size: 72px;
  font-weight: 600;
  letter-spacing: -3px;
  line-height: 1;
  color: var(--color-text);
}

.date {
  font-size: 16px;
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.greeting {
  font-size: 24px;
  font-weight: 400;
  color: var(--color-text);
  margin-bottom: 32px;
}

.search-wrap {
  width: 100%;
}

.search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  height: 48px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  transition: all 0.2s ease;
}

.search.focused {
  border-color: var(--color-border-interactive);
  box-shadow: var(--color-shadow) 0px 4px 12px;
}

.search-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 16px;
  font-family: inherit;
  color: var(--color-text);
  line-height: 1.5;
}

.search input::placeholder {
  color: var(--color-text-muted);
}

.shortcuts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  margin-top: 40px;
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  color: var(--color-text);
}

.shortcut:hover {
  background: var(--color-bg-active);
  border-color: var(--color-border-interactive);
  box-shadow: var(--color-shadow) 0px 4px 12px;
}

.shortcut:active {
  opacity: 0.8;
}

.shortcut-letter {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-bg-elevated);
  box-shadow:
    rgba(255, 255, 255, 0.2) 0px 0.5px 0px 0px inset,
    var(--color-shadow) 0px 0px 0px 0.5px inset,
    var(--color-shadow-sm) 0px 1px 2px 0px;
  flex-shrink: 0;
}

.shortcut-name {
  font-size: 14px;
  font-weight: 400;
  color: var(--color-text);
}
</style>
// Voice composable: TTS (Text-to-Speech) + STT (Speech-to-Text)
// Uses browser built-in SpeechSynthesis and Web Speech API

import { ref, computed } from 'vue'

const isSpeaking = ref(false)
const isListening = ref(false)
const listeningTranscript = ref('')
const listeningInterim = ref('')
const selectedVoice = ref(null)
const speechRate = ref(1.0)
const autoRead = ref(false)

let currentUtterance = null
let recognition = null

// ─── TTS (Text-to-Speech) ───

let _voicesReady = false
const _voicesPromise = new Promise(resolve => {
  if (typeof speechSynthesis === 'undefined') { resolve(); return }
  const voices = speechSynthesis.getVoices()
  if (voices.length > 0) { _voicesReady = true; resolve(); return }
  speechSynthesis.onvoiceschanged = () => { _voicesReady = true; resolve() }
})

function getVoices() {
  if (typeof speechSynthesis === 'undefined') return []
  return speechSynthesis.getVoices()
}

async function ensureVoices() {
  if (!_voicesReady) await _voicesPromise
}

function getVoicesForLang(lang) {
  const prefix = lang === 'zh' ? 'zh' : 'en'
  return getVoices().filter(v => v.lang.startsWith(prefix))
}

function detectLanguage(text) {
  if (!text) return 'en'
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  return chineseChars > text.length * 0.1 ? 'zh' : 'en'
}

async function speak(text, lang) {
  if (!text) return
  stopSpeaking()
  await ensureVoices()

  const utterance = new SpeechSynthesisUtterance(text)
  const effectiveLang = lang || detectLanguage(text)
  utterance.lang = effectiveLang === 'zh' ? 'zh-CN' : 'en-US'
  utterance.rate = speechRate.value
  utterance.pitch = 1.0

  // Select voice
  const voices = getVoicesForLang(effectiveLang)
  if (selectedVoice.value) {
    const v = voices.find(v => v.name === selectedVoice.value)
    if (v) utterance.voice = v
  } else if (voices.length > 0) {
    utterance.voice = voices[0]
  }

  utterance.onstart = () => { isSpeaking.value = true }
  utterance.onend = () => { isSpeaking.value = false; currentUtterance = null }
  utterance.onerror = () => { isSpeaking.value = false; currentUtterance = null }

  currentUtterance = utterance
  speechSynthesis.speak(utterance)
}

function stopSpeaking() {
  speechSynthesis.cancel()
  isSpeaking.value = false
  currentUtterance = null
}

// ─── STT (Speech-to-Text) ───

function isListeningSupported() {
  return !!(typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition))
}

function startListening(lang) {
  if (!isListeningSupported()) return false
  stopListening()

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition = new SpeechRecognition()
  recognition.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  listeningTranscript.value = ''
  listeningInterim.value = ''

  recognition.onresult = (event) => {
    let final = ''
    let interim = ''
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript
      } else {
        interim += event.results[i][0].transcript
      }
    }
    if (final) listeningTranscript.value += final
    listeningInterim.value = interim
  }

  recognition.onstart = () => { isListening.value = true }
  recognition.onend = () => {
    isListening.value = false
    listeningInterim.value = ''
  }
  recognition.onerror = (e) => {
    console.warn('[Voice] Speech recognition error:', e.error)
    isListening.value = false
  }

  recognition.start()
  return true
}

function stopListening() {
  if (recognition) {
    try { recognition.stop() } catch {}
    recognition = null
  }
  isListening.value = false
}

function toggleListening(lang) {
  if (isListening.value) {
    stopListening()
  } else {
    startListening(lang)
  }
}

// ─── Config ───

function loadVoiceConfig() {
  try {
    const saved = localStorage.getItem('dawn-voice-config')
    if (saved) {
      const cfg = JSON.parse(saved)
      if (cfg.selectedVoice) selectedVoice.value = cfg.selectedVoice
      if (cfg.speechRate) speechRate.value = cfg.speechRate
      if (cfg.autoRead !== undefined) autoRead.value = cfg.autoRead
    }
  } catch {}
}

function saveVoiceConfig() {
  localStorage.setItem('dawn-voice-config', JSON.stringify({
    selectedVoice: selectedVoice.value,
    speechRate: speechRate.value,
    autoRead: autoRead.value
  }))
}

export function useVoice() {
  loadVoiceConfig()

  return {
    // TTS
    isSpeaking, speak, stopSpeaking,
    getVoices, getVoicesForLang, detectLanguage,
    selectedVoice, speechRate, autoRead, saveVoiceConfig,
    // STT
    isListening, isListeningSupported, startListening, stopListening, toggleListening,
    listeningTranscript, listeningInterim
  }
}
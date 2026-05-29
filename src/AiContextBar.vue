<script setup>
import { useContextRef } from './composables/useContextRef'

const { contextRefs, removeContextRef } = useContextRef()
</script>

<template>
  <div v-if="contextRefs.length > 0" class="acb-root">
    <span v-for="ref in contextRefs" :key="ref.id" class="acb-chip" @click="removeContextRef(ref.id)" :title="ref.preview || ref.label">
      <span class="acb-chip-icon">{{ ref.icon }}</span>
      <span class="acb-chip-label">{{ ref.label }}</span>
      <span class="acb-chip-x">&times;</span>
    </span>
  </div>
</template>

<style scoped>
.acb-root {
  display: flex; flex-wrap: wrap; gap: 3px; padding: 4px 10px; flex-shrink: 0;
}
.acb-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 6px; background: rgba(59,130,246,0.08);
  border: 1px solid rgba(59,130,246,0.12); border-radius: 10px;
  font-size: 10px; cursor: pointer; transition: all 0.1s;
  max-width: 140px;
}
.acb-chip:hover { background: rgba(255,95,86,0.08); border-color: rgba(255,95,86,0.2); }
.acb-chip-icon { font-size: 11px; flex-shrink: 0; }
.acb-chip-label { font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acb-chip-x { font-size: 12px; color: var(--color-text-muted); flex-shrink: 0; }
</style>

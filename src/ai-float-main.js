import { createApp } from "vue";
import "./theme.css";
import { applyThemeFromStorage } from "./composables/applyTheme.js";
import AiFloat from "./AiFloat.vue";

applyThemeFromStorage();
createApp(AiFloat).mount("#app");

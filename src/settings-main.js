import { createApp } from "vue";
import "./theme.css";
import { applyThemeFromStorage } from "./composables/applyTheme.js";
import BrowserSettings from "./BrowserSettings.vue";

applyThemeFromStorage();
const app = createApp(BrowserSettings, { embedded: false });
app.mount("#app");

import { createApp } from "vue";
import "./theme.css";
import { applyThemeFromStorage } from "./composables/applyTheme.js";
import PanelOverlay from "./PanelOverlay.vue";

applyThemeFromStorage();
const app = createApp(PanelOverlay);
app.mount("#app");

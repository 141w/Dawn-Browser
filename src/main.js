import { createApp } from "vue";
import "./theme.css";
import { applyThemeFromStorage } from "./composables/applyTheme.js";
import App from "./App.vue";

applyThemeFromStorage();
const app = createApp(App);

app.config.errorHandler = (err, instance, info) => {
  console.error('[Dawn] Vue error:', err);
  document.title = 'ERROR: ' + err.message;
};

app.mount("#app");
console.log('[Dawn] App mounted successfully');

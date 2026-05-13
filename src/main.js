import { createApp } from "vue";
import App from "./App.vue";

const app = createApp(App)

app.config.errorHandler = (err, instance, info) => {
  console.error('[Dawn] Global Vue error:', err.message, '\nStack:', err.stack, '\nComponent:', instance?.$?.type?.name || instance?.type?.__name || 'unknown', '\nInfo:', info)
}

app.mount("#app");
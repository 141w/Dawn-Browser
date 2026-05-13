import { createApp } from "vue";
import BrowserSettings from "./BrowserSettings.vue";

const app = createApp(BrowserSettings, { embedded: false });
app.mount("#app");

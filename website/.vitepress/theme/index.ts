import DefaultTheme from "vitepress/theme";
import "./custom.css";
import AexPlayground from "./AexPlayground.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("AexPlayground", AexPlayground);
  },
};

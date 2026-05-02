import DefaultTheme from "vitepress/theme";
import "./custom.css";
import AexPlayground from "./AexPlayground.vue";
import Layout from "./Layout.vue";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("AexPlayground", AexPlayground);
  },
};

import { defineConfig } from "vitepress";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const aexGrammar = {
  ...JSON.parse(
    readFileSync(
      resolve(__dirname, "../../packages/aex-vscode/syntaxes/aex.tmLanguage.json"),
      "utf8"
    )
  ),
  name: "aex",
  aliases: ["AEX"],
};

export default defineConfig({
  srcDir: resolve(__dirname, "../../docs"),
  base: "/aex/",
  title: "AEX",
  description: "Executable contracts for AI agents.",
  lang: "en-US",
  appearance: true,
  markdown: {
    languages: [aexGrammar],
  },
  vite: {
    resolve: {
      alias: {
        "node:fs": resolve(__dirname, "stubs/fs.js"),
      },
    },
  },
  themeConfig: {
    logo: {
      text: "AEX"
    },
    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "Language", link: "/language/overview" },
      { text: "Examples", link: "/examples/" },
      { text: "CLI", link: "/reference/cli" },
      { text: "Integrations", link: "/integrations/" },
      { text: "Policy", link: "/reference/policy" },
      { text: "Security", link: "/reference/security" },
      { text: "Playground", link: "/playground" }
    ],
    sidebar: {
      "/": [
        {
          text: "Getting Started",
          items: [
            { text: "Overview", link: "/" },
            { text: "Quickstart", link: "/quickstart" }
          ]
        },
        {
          text: "Language",
          items: [{ text: "Overview", link: "/language/overview" }]
        },
        {
          text: "Examples",
          collapsed: false,
          items: [
            { text: "Catalog", link: "/examples/" },
            { text: "Fix Failing Test", link: "/examples/fix-test" },
            { text: "Review Pull Request", link: "/examples/review-pr" },
            { text: "Support Ticket Reply", link: "/examples/support-ticket" },
            { text: "Research Brief", link: "/examples/research-brief" },
            { text: "Threat Monitor", link: "/examples/security" }
          ]
        },
        {
          text: "Integrations",
          items: [
            { text: "Overview", link: "/integrations/" },
            { text: "MCP Gateway", link: "/integrations/mcp" },
            { text: "OpenAI Agents SDK", link: "/integrations/openai-agents" },
            { text: "LangGraph", link: "/integrations/langgraph" },
            { text: "GitHub Actions", link: "/integrations/github-actions" },
            { text: "AGENTS.md", link: "/integrations/agents-md" }
          ]
        },
        {
          text: "Reference",
          items: [
            { text: "Policy", link: "/reference/policy" },
            { text: "Security Model", link: "/reference/security" },
            { text: "CLI Reference", link: "/reference/cli" }
          ]
        },
        {
          text: "Tools",
          items: [
            { text: "Playground", link: "/playground" }
          ]
        },
        {
          text: "Community",
          items: [
            { text: "Contributing", link: "/community/contributing" },
            { text: "Roadmap", link: "/community/roadmap" }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/harsh-nod/aex" }
    ],
    footer: {
      message: "Enforce first, execute second.",
      copyright: "© " + new Date().getFullYear() + " AEX contributors."
    }
  },
  head: [
    [
      "meta",
      { name: "theme-color", content: "#0f172a" }
    ]
  ]
});

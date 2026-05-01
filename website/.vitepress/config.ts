import { defineConfig } from "vitepress";
import { resolve } from "node:path";

export default defineConfig({
  srcDir: resolve(__dirname, "../../docs"),
  title: "AEX",
  description: "Executable contracts for AI agents.",
  lang: "en-US",
  appearance: true,
  themeConfig: {
    logo: {
      text: "AEX"
    },
    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "Language", link: "/language/overview" },
      { text: "Examples", link: "/examples/" },
      { text: "Integrations", link: "/integrations/" },
      { text: "Policy", link: "/reference/policy" }
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
            { text: "Research Brief", link: "/examples/research-brief" }
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
          items: [{ text: "Policy", link: "/reference/policy" }]
        },
        {
          text: "Community",
          items: [{ text: "Contributing", link: "/community/contributing" }]
        }
      ]
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/harsh-nod/aex" }
    ],
    footer: {
      message: "Prompts are not permissions.",
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

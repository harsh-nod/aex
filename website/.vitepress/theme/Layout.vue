<script setup>
import DefaultTheme from "vitepress/theme";
const { Layout } = DefaultTheme;
</script>

<template>
  <div class="pre-release-banner">
    The CLI is published on npm (<code>npm i -g @aex-lang/cli</code>). APIs are experimental and may change before v1.0.
    <a href="/aex/community/roadmap">Roadmap &rarr;</a>
  </div>
  <Layout />
</template>

<script setup>
import DefaultTheme from "vitepress/theme";
const { Layout } = DefaultTheme;
</script>

<template>
  <div class="pre-release-banner">
    AEX is in pre-release &mdash; APIs may change and packages are not yet published to npm.
    <a href="/aex/community/roadmap">See the roadmap &rarr;</a>
  </div>
  <Layout />
</template>

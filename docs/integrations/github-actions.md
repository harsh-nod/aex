# GitHub Actions

Validate contracts on every push and pull request.

```yaml
name: AEX

on:
  pull_request:
  push:
    branches: [main]

jobs:
  aex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aex-lang/setup-aex@v0
      - run: aex check tasks/**/*.aex
```

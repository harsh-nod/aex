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

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install AEX
        run: |
          git clone https://github.com/harsh-nod/aex.git /tmp/aex
          cd /tmp/aex
          npm ci
          npm run build
          npm link --workspace @aex-lang/cli

      - name: Validate contracts
        run: aex check tasks/**/*.aex

      - name: Format check
        run: aex fmt tasks/**/*.aex --check
```

Once AEX is published to npm, this simplifies to:

```yaml
      - run: npx @aex-lang/cli check tasks/**/*.aex
```

<script setup lang="ts">
import { ref, computed } from "vue";
import { parseAEX, compileTask } from "@aex-lang/parser";
import { validateText } from "@aex-lang/validator";

const EXAMPLES = [
  {
    label: "Fix Failing Test",
    source: `agent fix_test v0

goal "Fix the failing test with the smallest safe change."

use file.read, file.write, tests.run
deny network.*, secrets.read

need test_cmd: str
need target_files: list[file]

do tests.run(cmd=test_cmd) -> failure
do file.read(paths=target_files) -> sources

make patch: diff from failure, sources with:
  - fix the failing test
  - preserve public behavior
  - do not touch unrelated files

check patch touches only target_files
confirm before file.write

do file.write(diff=patch) -> result
do tests.run(cmd=test_cmd) -> final

check final.passed

return {
  status: "fixed",
  patch: patch,
  test: final
}`,
  },
  {
    label: "Support Ticket",
    source: `agent support_ticket v0

goal "Draft a customer support reply using CRM context."

use crm.lookup, ticket.read, email.draft
deny email.send, payment.*, admin.*, secrets.read

need customer_id: str
need ticket_id: str

do crm.lookup(id=customer_id) -> customer
do ticket.read(id=ticket_id) -> ticket

make reply: markdown from customer, ticket with:
  - summarize the customer's issue
  - acknowledge prior interactions
  - propose the next step
  - mark any uncertainty

check reply does not include customer.internal_notes

do email.draft(to=customer.email, body=reply) -> draft

return draft`,
  },
  {
    label: "Hello World",
    source: `agent hello v0

goal "Greet the user by name."

use console.log

need name: str

do console.log(msg=name) -> result

return result`,
  },
  {
    label: "Policy File",
    source: `policy workspace v0

goal "Default security boundary for this repository."

use file.read, file.write, tests.run, git.*
deny network.*, secrets.read

confirm before file.write

budget calls=100`,
  },
];

const source = ref(EXAMPLES[0].source);
const activeTab = ref<"parsed" | "validation" | "ir">("parsed");

const parseResult = computed(() => {
  try {
    const result = parseAEX(source.value, { tolerant: true });
    return { data: result, error: null };
  } catch (e: any) {
    return { data: null, error: e.message ?? String(e) };
  }
});

const validationResult = computed(() => {
  try {
    const result = validateText(source.value);
    return { data: result, error: null };
  } catch (e: any) {
    return { data: null, error: e.message ?? String(e) };
  }
});

const compiledIR = computed(() => {
  const pr = parseResult.value;
  if (!pr.data) return { data: null, error: "Parse failed" };
  try {
    const ir = compileTask(pr.data.task);
    return { data: ir, error: null };
  } catch (e: any) {
    return { data: null, error: e.message ?? String(e) };
  }
});

function loadExample(index: number) {
  source.value = EXAMPLES[index].source;
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}
</script>

<template>
  <div class="playground-toolbar">
    <label class="playground-select-label">
      <span>Load example:</span>
      <select @change="loadExample(Number(($event.target as HTMLSelectElement).value))">
        <option v-for="(ex, i) in EXAMPLES" :key="i" :value="i">{{ ex.label }}</option>
      </select>
    </label>
  </div>

  <div class="playground-container">
    <div class="playground-editor">
      <textarea v-model="source" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" />
    </div>

    <div class="playground-output">
      <div class="tab-bar">
        <button :class="{ active: activeTab === 'parsed' }" @click="activeTab = 'parsed'">Parsed</button>
        <button :class="{ active: activeTab === 'validation' }" @click="activeTab = 'validation'">
          Validation
          <span v-if="validationResult.data && validationResult.data.issues.length" class="badge badge-error">
            {{ validationResult.data.issues.length }}
          </span>
        </button>
        <button :class="{ active: activeTab === 'ir' }" @click="activeTab = 'ir'">IR</button>
      </div>

      <div class="output-content">
        <!-- Parsed AST -->
        <template v-if="activeTab === 'parsed'">
          <div v-if="parseResult.data && parseResult.data.diagnostics.length" class="diagnostics">
            <div v-for="(d, i) in parseResult.data.diagnostics" :key="i" class="diagnostic warning">
              <span class="severity-dot warning" />
              <span v-if="d.line" class="line-num">Line {{ d.line }}:</span>
              {{ d.message }}
            </div>
          </div>
          <pre v-if="parseResult.data">{{ formatJson(parseResult.data.task) }}</pre>
          <pre v-else class="error-text">{{ parseResult.error }}</pre>
        </template>

        <!-- Validation -->
        <template v-if="activeTab === 'validation'">
          <div v-if="validationResult.error" class="error-text pad">{{ validationResult.error }}</div>
          <div v-else-if="validationResult.data">
            <div v-if="validationResult.data.issues.length === 0" class="success-msg">No issues found.</div>
            <div v-else class="issue-list">
              <div v-for="(issue, i) in validationResult.data.issues" :key="i" class="issue" :class="issue.severity">
                <span class="severity-dot" :class="issue.severity" />
                <span v-if="issue.code" class="issue-code">[{{ issue.code }}]</span>
                <span v-if="issue.line" class="line-num">Line {{ issue.line }}:</span>
                {{ issue.message }}
              </div>
            </div>
          </div>
        </template>

        <!-- Compiled IR -->
        <template v-if="activeTab === 'ir'">
          <pre v-if="compiledIR.data">{{ formatJson(compiledIR.data) }}</pre>
          <pre v-else class="error-text">{{ compiledIR.error }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.playground-toolbar {
  margin-bottom: 1rem;
}

.playground-select-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--aex-text-2, var(--vp-c-text-2));
}

.playground-select-label select {
  padding: 0.35rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--aex-card-border, var(--vp-c-border));
  background: var(--aex-card-bg, var(--vp-c-bg-soft));
  color: var(--aex-text-1, var(--vp-c-text-1));
  font-family: var(--vp-font-family-base);
  font-size: 0.85rem;
  cursor: pointer;
}

.playground-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  min-height: 500px;
}

.playground-editor textarea {
  width: 100%;
  height: 100%;
  min-height: 460px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  line-height: 1.6;
  background: var(--aex-card-bg, var(--vp-c-bg-soft));
  color: var(--aex-text-1, var(--vp-c-text-1));
  border: 1px solid var(--aex-code-border, var(--vp-c-border));
  border-radius: 12px;
  padding: 1rem;
  resize: vertical;
  tab-size: 2;
  outline: none;
  box-sizing: border-box;
}

.playground-editor textarea:focus {
  border-color: var(--vp-c-brand-1);
}

.playground-output {
  background: var(--aex-card-bg, var(--vp-c-bg-soft));
  border: 1px solid var(--aex-card-border, var(--vp-c-border));
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--aex-panel-border, var(--vp-c-border));
  background: var(--aex-panel-bg, var(--vp-c-bg-alt));
  flex-shrink: 0;
}

.tab-bar button {
  padding: 0.6rem 1.2rem;
  font-family: var(--vp-font-family-base);
  font-size: 0.85rem;
  color: var(--aex-text-2, var(--vp-c-text-2));
  background: transparent;
  border: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  transition: color 0.15s, border-color 0.15s;
}

.tab-bar button:hover {
  color: var(--aex-text-1, var(--vp-c-text-1));
}

.tab-bar button.active {
  color: var(--aex-link, var(--vp-c-brand-1));
  border-bottom-color: var(--vp-c-brand-1);
}

.badge {
  font-size: 0.7rem;
  padding: 0.1rem 0.45rem;
  border-radius: 8px;
  font-weight: 600;
}

.badge-error {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.output-content {
  flex: 1;
  overflow: auto;
  max-height: 460px;
}

.output-content pre {
  padding: 1rem;
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--aex-text-1, var(--vp-c-text-1));
  white-space: pre-wrap;
  word-break: break-word;
}

.error-text {
  color: #f87171 !important;
}

.pad {
  padding: 1rem;
}

.diagnostics {
  padding: 0.75rem 1rem 0;
}

.diagnostic {
  font-size: 0.82rem;
  padding: 0.3rem 0;
  color: var(--aex-text-2, var(--vp-c-text-2));
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.success-msg {
  padding: 1rem;
  color: #4ade80;
  font-size: 0.9rem;
}

.issue-list {
  padding: 0.75rem 1rem;
}

.issue {
  font-size: 0.82rem;
  padding: 0.4rem 0;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  color: var(--aex-text-1, var(--vp-c-text-1));
}

.severity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
  position: relative;
  top: 1px;
}

.severity-dot.error {
  background: #ef4444;
}

.severity-dot.warning {
  background: #f59e0b;
}

.issue-code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--aex-text-2, var(--vp-c-text-2));
}

.line-num {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--aex-text-2, var(--vp-c-text-2));
}

@media (max-width: 768px) {
  .playground-container {
    grid-template-columns: 1fr;
  }

  .playground-editor textarea {
    min-height: 250px;
  }

  .output-content {
    max-height: 350px;
  }
}
</style>

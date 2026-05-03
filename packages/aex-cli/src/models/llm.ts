/**
 * Simple string-in / string-out LLM caller for `aex draft`.
 * Separate from ModelHandler (which handles `make` steps in `aex run`).
 */

function parseProvider(raw: string): { provider: string; model?: string } {
  const idx = raw.indexOf(":");
  if (idx > 0) {
    return { provider: raw.slice(0, idx), model: raw.slice(idx + 1) };
  }
  return { provider: raw };
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required. Set it or use --model anthropic.",
    );
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model ?? process.env.OPENAI_MODEL ?? "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. Set it or use --model openai.",
    );
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const textBlock = data.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  providerSpec?: string,
): Promise<string> {
  const raw = providerSpec ?? process.env.AEX_MODEL;
  if (!raw) {
    throw new Error(
      "No model provider specified. Use --model <provider> or set AEX_MODEL.",
    );
  }

  const { provider, model } = parseProvider(raw);

  switch (provider) {
    case "openai":
      return callOpenAI(systemPrompt, userPrompt, model);
    case "anthropic":
      return callAnthropic(systemPrompt, userPrompt, model);
    default:
      throw new Error(
        `Unknown model provider "${provider}". Available: openai, anthropic`,
      );
  }
}

import type { ModelHandler } from "@aex-lang/runtime";

export const anthropicHandler: ModelHandler = async (step, context) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required when using the Anthropic model handler.",
    );
  }

  const inputContext = step.inputs.map((name) => {
    const value = context.variables.get(name) ?? context.inputs[name];
    return `### ${name}\n${JSON.stringify(value, null, 2)}`;
  });

  const instructions = step.instructions
    .map((instruction) => `- ${instruction}`)
    .join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: `You are generating a ${step.type} artifact for an AEX contract. Generate only the ${step.type} content. Do not include explanations, markdown fences, or surrounding text.`,
      messages: [
        {
          role: "user",
          content: `## Available context\n\n${inputContext.join("\n\n")}\n\n## Instructions\n\n${instructions}`,
        },
      ],
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
};

import type { ModelHandler } from "@aex-lang/runtime";

export const openaiHandler: ModelHandler = async (step, context) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required when using the OpenAI model handler.",
    );
  }

  const inputContext = step.inputs.map((name) => {
    const value = context.variables.get(name) ?? context.inputs[name];
    return `### ${name}\n${JSON.stringify(value, null, 2)}`;
  });

  const instructions = step.instructions
    .map((instruction) => `- ${instruction}`)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are generating a ${step.type} artifact for an AEX contract. Generate only the ${step.type} content. Do not include explanations, markdown fences, or surrounding text.`,
        },
        {
          role: "user",
          content: `## Available context\n\n${inputContext.join("\n\n")}\n\n## Instructions\n\n${instructions}`,
        },
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
};

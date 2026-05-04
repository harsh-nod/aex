import type { ModelHandler } from "@aex-lang/runtime";
import { openaiHandler } from "./openai.js";
import { anthropicHandler } from "./anthropic.js";
import path from "node:path";

const providers: Record<string, ModelHandler> = {
  openai: openaiHandler,
  anthropic: anthropicHandler,
};

export async function resolveModelHandler(
  provider?: string,
  handlerPath?: string,
): Promise<ModelHandler | undefined> {
  const name = provider ?? process.env.AEX_MODEL;

  if (name) {
    const handler = providers[name];
    if (!handler) {
      const known = Object.keys(providers).join(", ");
      throw new Error(
        `Unknown model provider "${name}". Available providers: ${known}`,
      );
    }
    return handler;
  }

  if (handlerPath) {
    const resolved = path.isAbsolute(handlerPath)
      ? handlerPath
      : path.resolve(process.cwd(), handlerPath);
    const mod = (await import(resolved)) as { default?: ModelHandler };
    if (typeof mod.default !== "function") {
      throw new Error(
        `Model handler at "${handlerPath}" must export a default function.`,
      );
    }
    return mod.default;
  }

  return undefined;
}

const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export function checkApiKeyAvailable(
  provider: string,
): { envVar: string; available: boolean } | null {
  const envVar = PROVIDER_ENV_VARS[provider];
  if (!envVar) return null;
  return { envVar, available: !!process.env[envVar] };
}

import { type PluginContext, type GeneratorController as SdkController, type Chat as SdkChat } from "@lmstudio/sdk";
import { generate } from "./generator.js";
import type { GeneratorController } from "./generator.js";
import type { Chat } from "./utils.js";

/**
 * Adapt the SDK GeneratorController to the interface expected by generator.ts
 */
function adaptController(sdkCtl: SdkController): GeneratorController {
  return {
    write: (text: string) => sdkCtl.fragmentGenerated(text),
    statusUpdate: (message: string) => console.log(`[generator] ${message}`),
    setConfig: (_key: string, _value: unknown) => {
      // Config is managed via config.json on disk, not the SDK config API
    },
  };
}

/**
 * Adapt the SDK Chat to the plain object expected by generator.ts
 */
function adaptChat(sdkChat: SdkChat): Chat {
  const messages: Chat["messages"] = [];
  for (const msg of sdkChat) {
    messages.push({ role: msg.getRole(), content: msg.getText() });
  }
  return { messages };
}

export async function main(context: PluginContext) {
  context.withGenerator(async (sdkCtl, sdkChat) => {
    await generate(adaptController(sdkCtl), adaptChat(sdkChat));
  });
}

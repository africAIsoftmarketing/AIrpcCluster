import { LMStudioClient, type GeneratorController as SdkController, type Chat as SdkChat } from "@lmstudio/sdk";
import { generate } from "./generator.js";
import type { GeneratorController } from "./generator.js";
import type { Chat } from "./utils.js";

/**
 * Adapt the SDK's GeneratorController to the interface expected by generator.ts
 */
function adaptController(sdkCtl: SdkController): GeneratorController {
  return {
    write: (text: string) => sdkCtl.fragmentGenerated(text),
    statusUpdate: (message: string) => console.log(`[generator] ${message}`),
    setConfig: (_key: string, _value: unknown) => {
      // No SDK equivalent — config is managed via config.json on disk
    },
  };
}

/**
 * Adapt the SDK's Chat history to the plain object expected by generator.ts
 */
function adaptChat(sdkChat: SdkChat): Chat {
  const messages: Chat["messages"] = [];
  for (const msg of sdkChat) {
    messages.push({ role: msg.getRole(), content: msg.getText() });
  }
  return { messages };
}

const client = new LMStudioClient();
const host = client.plugins.getSelfRegistrationHost();

host.setGenerator(async (sdkCtl, sdkChat) => {
  await generate(adaptController(sdkCtl), adaptChat(sdkChat));
});

host.initCompleted().catch((err) => {
  console.error("[plugin] Failed to complete initialization:", err);
});

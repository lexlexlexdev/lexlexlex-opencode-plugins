/**
 * secret-mask for OpenCode.
 *
 * The masking logic is the Pi extension (pi-extension.ts + engine.ts + policy.ts);
 * pi-shim.ts maps OpenCode's V2 hooks onto the Pi extension API so the policy,
 * the registry and every masking path stay identical.
 */
import { Plugin } from "./plugin.ts";
import { createPiApi, install } from "./pi-shim.ts";
import secretMask from "./pi-extension.ts";

export default Plugin.define({
  id: "secret-mask",
  async setup(ctx) {
    const shim = createPiApi();
    const installed = await install(ctx, shim, secretMask);
    const tools = shim.tools;
    if (tools.length > 0) {
      await ctx.tool.transform((editor) => {
        for (const definition of tools) {
          editor.add({
            id: definition.name,
            name: definition.name,
            description: definition.description,
            input: definition.parameters,
            execute: async (input, toolCtx) =>
              definition.execute("", input, toolCtx?.signal, undefined, installed.ctx),
          });
        }
      });
    }
    return () => installed.dispose();
  },
});

/**
 * Local stand-in for \`Plugin.define\` from @opencode/plugin.
 *
 * The plugin loader cannot resolve that package from a local plugin directory in
 * this build, and the definition it produces is a plain object anyway.
 */
export interface PluginContext { [key: string]: any }
export interface PluginDefinition {
  id: string;
  setup: (ctx: PluginContext) => Promise<(() => void) | void> | (() => void) | void;
}
export const Plugin = {
  define(definition: PluginDefinition): PluginDefinition {
    return definition;
  },
};

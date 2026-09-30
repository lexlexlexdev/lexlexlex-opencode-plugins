/**
 * Adapter between the OpenCode V2 plugin API and the Pi extension API that
 * pi-extension.ts was written against.
 *
 * Pi hook                      OpenCode hook
 *   input                        session.hook("prompt")
 *   before_provider_request      session.hook("context")   (+ copy fallback, see below)
 *   tool_call                    tool.hook("execute.before")
 *   tool_result                  tool.hook("execute.after")
 *   session_before_compact       session.hook("compaction")
 *   session_before_tree          -- no equivalent in OpenCode
 *   session_start / _shutdown    plugin setup / cleanup
 */
import { envVarName, walkStrings } from "./engine.ts";

type Handler = (event: any, ctx?: any) => any;

const TAG = "[secret-mask]";

function log(text: string, level = "info"): void {
  try {
    console.error(`${TAG} ${level}: ${text}`);
  } catch {
    // Logging must never break masking.
  }
}

/**
 * OpenCode calls the shell tool `shell` (the `bash` name arrives only as an alias), while
 * the ported handlers match on Pi's `bash`. Normalise the name before dispatching.
 */
function toolNameOf(tool: string): string {
  return tool === "shell" ? "bash" : tool;
}

/**
 * Content parts that carry binary payloads. The ported walker treats only images and data
 * URLs as binary, so a `media` part holding base64 would be rewritten and the attachment
 * destroyed. Those parts step aside for the duration of a masking pass.
 */
const BINARY_PART_TYPES = new Set(["media", "image", "input_image", "image_url", "audio", "file"]);

function hideBinaryParts(messages: unknown): () => void {
  const stash: { list: any[]; index: number; part: any }[] = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const parts = (message as any)?.content;
    if (!Array.isArray(parts)) continue;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part && typeof part === "object" && BINARY_PART_TYPES.has(String((part as any).type ?? ""))) {
        stash.push({ list: parts, index, part });
        try {
          parts[index] = { type: "text", text: "" };
        } catch {
          stash.pop();
        }
      }
    }
  }
  return () => {
    for (const { list, index, part } of stash) {
      try {
        list[index] = part;
      } catch {
        // Best effort: a frozen list keeps the blank stub, which at worst loses an attachment.
      }
    }
  };
}

export interface PiShim {
  api: any;
  tools: any[];
  handlers: Map<string, Handler[]>;
}

export function createPiApi(): PiShim {
  const handlers = new Map<string, Handler[]>();
  const tools: any[] = [];
  const api: any = {
    on(name: string, fn: Handler): void {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
    },
    registerTool(definition: any): void {
      tools.push(definition);
    },
    registerCommand(name: string): void {
      // OpenCode commands receive no arguments and cannot prompt the user, so the
      // /secret-* commands have no faithful equivalent. The registry is filled from
      // user prompts, tool output and redact-listed files instead.
      log(`command ${name} is not available in OpenCode; the registry updates from prompts, tool output and redact-listed files`);
    },
  };
  return { api, tools, handlers };
}

/**
 * Copy of a tool input that adds Pi's `path` alias. A copy, not a prototype view: the
 * ported handlers read the input with Object.entries/JSON walks, which only see own
 * enumerable keys. Fields a handler may rewrite are copied back by the caller.
 */
function inputView(input: Record<string, any>): Record<string, any> {
  const view: Record<string, any> = { ...input };
  if (typeof input.filePath === "string") view.path = input.filePath;
  else if (typeof input.file_path === "string") view.path = input.file_path;
  return view;
}

export interface Installed {
  ctx: any;
  dispose: () => void;
}

export async function install(open: any, shim: PiShim, piExtension: (api: any) => void): Promise<Installed> {
  const cwd = open?.location?.directory ?? process.cwd();
  let aborted = false;
  const ui = {
    setStatus: (_key: string, _text: string): void => {},
    notify: (text: string, level?: string): void => log(text, level ?? "info"),
  };
  const ctx: any = { cwd, ui, abort: (): void => { aborted = true; } };
  const registry = (): any => shim.api.registry;

  const emit = (name: string, event: any): any[] => {
    const results: any[] = [];
    for (const handler of shim.handlers.get(name) ?? []) {
      results.push(handler(event, ctx));
    }
    return results;
  };

  /**
   * Last resort when the in-place pass fails (readonly message objects, throwing getters):
   * mask a deep copy with the registry alone and let the caller install it. Throws when
   * even that is impossible, so the request is aborted instead of sent unmasked.
   */
  function copyMask(event: any): { system: unknown; messages: unknown } {
    const mask = registry();
    if (!mask || typeof mask.maskText !== "function") throw new Error("no registry available for the copy fallback");
    const system = Array.isArray(event?.system) ? JSON.parse(JSON.stringify(event.system)) : event?.system;
    const messages = JSON.parse(JSON.stringify(event?.messages ?? []));
    const fn = (text: string): string => mask.maskText(text);
    if (Array.isArray(system)) walkStrings(system, fn);
    walkStrings(messages, fn, ["role", "type", "tool_call_id", "toolCallId"]);
    return { system, messages };
  }

  piExtension(shim.api);

  // --- user prompt ---------------------------------------------------------
  await open.session.hook("prompt", (event: any): void => {
    const prompt = event?.prompt;
    if (!prompt || typeof prompt.text !== "string" || prompt.text === "") return;
    const masked = { text: prompt.text, source: "user" };
    for (const result of emit("input", masked)) {
      if (result && result.action === "transform" && typeof result.text === "string") prompt.text = result.text;
    }
  });

  // --- model-visible context (the belt right before the request) -----------
  await open.session.hook("context", (event: any): void => {
    const toolViews = Object.entries(event?.tools ?? {}).map(([name, tool]: [string, any]) => ({
      name,
      description: tool?.description,
      parameters: tool?.input,
    }));
    const payload: any = { system: event?.system, messages: event?.messages, tools: toolViews };
    aborted = false;
    const restore = hideBinaryParts(event?.messages);
    try {
      const results = emit("before_provider_request", { payload });
      for (const view of toolViews) {
        const original = (event?.tools ?? {})[view.name];
        if (original && typeof view.description === "string" && original.description !== view.description) {
          original.description = view.description;
        }
      }
      for (const result of results) {
        if (!result || typeof result !== "object" || result === payload) continue;
        if (Array.isArray(result.system)) event.system = result.system;
        if (Array.isArray(result.messages)) event.messages = result.messages;
      }
      if (aborted) throw new Error("secret-mask: masking failed, the request was aborted instead of sent");
      return;
    } catch (error) {
      if (aborted) throw error;
      log(`in-place masking failed (${error instanceof Error ? error.message : String(error)}), retrying on a copy`, "warning");
      const copy = copyMask(event);
      event.system = copy.system;
      event.messages = copy.messages;
      return;
    } finally {
      restore();
    }
  });

  // --- compaction ----------------------------------------------------------
  await open.session.hook("compaction", (event: any): void => {
    const preparation: any = { messagesToSummarize: event?.messages, customInstructions: undefined };
    try {
      emit("session_before_compact", { preparation, customInstructions: preparation.customInstructions });
    } catch {
      // Never abort compaction: the summary request goes through the context hook afterwards.
    }
  });

  // --- tool call in --------------------------------------------------------
  await open.tool.hook("execute.before", (event: any): void => {
    const input = event?.input;
    if (!input || typeof input !== "object") return;
    const view = inputView(input as Record<string, any>);
    const results = emit("tool_call", { toolName: toolNameOf(String(event.tool)), input: view });
    for (const key of ["command", "path", "content", "newString"]) {
      if (typeof view[key] === "string" && view[key] !== (input as any)[key]) (input as any)[key] = view[key];
    }
    for (const result of results) {
      if (result && result.block) throw new Error(String(result.reason ?? "Blocked by secret-mask"));
    }
  });

  // --- tool result out -----------------------------------------------------
  await open.tool.hook("execute.after", (event: any): void => {
    if (event?.status !== "completed" || !event.result) return;
    const result: any = event.result;
    const input = inputView(event.input && typeof event.input === "object" ? event.input : {});
    // The ported handler replaces `content` wholesale, so it must mutate the very object it
    // is handed: a fresh literal would swallow the replacement.
    const target: any = { toolName: toolNameOf(String(event.tool)), input, content: result.content, details: result.metadata };
    emit("tool_result", target);
    if (process.env.SM_DEBUG) {
      log(`tool_result ${target.toolName}: content changed ${target.content !== result.content}, details changed ${target.details !== result.metadata}`);
    }
    if (target.content !== result.content) result.content = target.content;
    if (target.details !== result.metadata) result.metadata = target.details;
    const mask = registry();
    if (mask && result.output && typeof result.output === "object") {
      try {
        walkStrings(result.output, (text: string) => mask.maskText(text));
      } catch {
        result.output = undefined;
      }
    }
  });

  // --- shell environment ---------------------------------------------------
  // Pi inlines `export NAME='value'; command` itself, so values already travel in the
  // command text (masked in the transcript). This hook covers the case where a token is
  // not registered yet but the command already references its variable name.
  await open.shell.hook("create.before", (event: any): void => {
    const mask = registry();
    if (!mask || typeof mask.knownTokens !== "function") return;
    const prefix = String(mask.__config?.bash?.envPrefix ?? "PI_SECRET_");
    for (const token of mask.knownTokens(event.command ?? "")) {
      const value = mask.valueFor(token);
      if (value === undefined) continue;
      event.env[envVarName(token, prefix)] = value;
    }
  });

  return { ctx, dispose: (): void => { /* registrations live for the plugin's lifetime */ } };
}

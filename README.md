# lexlexlex — OpenCode plugins

Personal plugins for OpenCode V2. Tested on `opencode v2.0.20` (macOS, Bun server runtime).

## Contents

### `secret-mask/`

Keeps secrets out of provider requests. A value that reaches the chat, a tool output or a file on the
redact list is replaced by a token shaped `__SECRET_<NAME>__`. The token expands to the real value only
inside a bash command; a file write that contains a token is refused.

This is a port of the pi extension `secret-mask`: `engine.ts` and `policy.ts` are copies, `pi-extension.ts`
is the original `index.ts` from pi, and `pi-shim.ts` maps OpenCode V2 hooks onto the API the extension
was written against:

| pi | OpenCode |
|---|---|
| `input` | `session.hook("prompt")` |
| `before_provider_request` | `session.hook("context")` |
| `tool_call` | `tool.hook("execute.before")` |
| `tool_result` | `tool.hook("execute.after")` |
| `session_before_compact` | `session.hook("compaction")` |

Recognition rules, file policy, the differences from pi and the sharp edges are documented in
[`secret-mask/README.md`](secret-mask/README.md).

No external dependencies. `typebox.ts` and `plugin.ts` are local stand-ins for the `typebox` package and
for `Plugin.define` from `@opencode/plugin`. The second one exists because the plugin loader in 2.0.20
cannot resolve `@opencode/plugin` from a local plugin directory (`Cannot find package`).

## Install

```bash
git clone https://github.com/lexlexlexdev/lexlexlex-opencode-plugins.git /tmp/oc-plugins
cp -R /tmp/oc-plugins/secret-mask ~/.config/opencode/plugins/
~/.opencode/bin/opencode reload
```

Or symlink, if you want to edit the checkout in place:

```bash
ln -s /tmp/oc-plugins/secret-mask ~/.config/opencode/plugins/secret-mask
```

## Verify

```bash
# did the plugin load?
~/.opencode/bin/opencode api GET /api/plugin | grep -o 'secret-mask[^}]*active'

# load errors
grep -i 'failed to load plugin' ~/.local/share/opencode/log/opencode.log | tail -3
```

## Known limitations

- `secret-mask` has not been exercised in a live session. It was verified against the real engine code and
  a real registry, but through stub objects. Real messages are Effect Schema classes, where readonly fields
  can throw: the port then falls back to masking a copy, or aborts the request (fail-closed).
- The value registry lives until the server restarts; nothing resets it at session start.
- There are no `/secret-*` commands: OpenCode commands take no arguments and cannot prompt for a value.

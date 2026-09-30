# secret-mask for OpenCode

A port of the pi extension `secret-mask` to OpenCode V2. The policy, the engine and every masking rule are
the same code; `pi-shim.ts` only maps OpenCode hooks onto the API the extension was written against.

It is active globally from `~/.config/opencode/plugins/secret-mask/`. Status is visible in
`GET /api/plugin` as an entry `secret-mask` with `state.status = active`.

## How to use it

A secret registers itself the first time it comes into view: in the chat, in a tool output, or in a file on
the redact list. From then on the value is masked in everything that goes to the model.

| What you type | What you get |
|---|---|
| `DB_PASSWORD=CORRECTHORSEBATTERYSTAPLE7` | a token named after the key: `__SECRET_DB_PASSWORD__` |
| `my key is sk-proj-…` (bare, no key) | a token named after the value shape, not the key |
| `GH_TOKEN: ghp_…` | also shape-based: the shape wins over the key name |
| `the password is correcthorsebatterystaple` | **nothing**: no shape and no key/value pair, so the engine reads it as prose |
| `code is 884213` | **nothing**: too short and shapeless |

A value is picked up when at least one of these holds: it looks like a credential (`sk-`, `ghp_`,
`AKIA…`, JWT, PEM, base64 of 32 characters or more, and so on), **or** it sits next to a sensitive key
(`PASSWORD`, `TOKEN`, `SECRET`, `KEY`, `AUTH`, `PRIVATE`, `SESSION`, `COOKIE`, `*_URL`, `*_URI`) as
`KEY=value` or `KEY: value`.

Practical advice: paste it as `NAME=value`. The token then carries a meaningful name that reads well in bash.

## What happens next

- **Transcript.** The replacement happens before the message is stored: history keeps the token, not the value.
- **bash.** A token inside a command is rewritten to `export NAME='…'; <command>`; the value travels through
  the child environment. The transcript still shows a token.
- **File writes.** `write`/`edit` containing a token are refused: the extension never substitutes real values
  into files. To write a value somewhere, use bash with the exported variable.
- **Tool output.** Values are masked back into tokens, `metadata` included.
- **Reading redact-listed files.** The model gets a redacted view: keys stay visible, values become tokens.
- **Compaction.** Summaries are masked with the same registry.

## File rules (`config.json`)

```
allow   .env.example, *.example, *.sample
allow   .env.local, .env.development
redact  .env, .env.staging, .env.production, .env.prod*, **/.env, **/.env.*
redact  *.pem, id_rsa, id_ed25519, **/.aws/credentials
```

`allow` passes a file through untouched; `redact` replaces its values with tokens. Related settings:
`maskValuesEverywhere: true`, `minSecretLength: 4`, `base64MinLength: 32`, environment prefix
`bash.envPrefix: PI_SECRET_`.

## What is missing compared to pi

| In pi | In OpenCode |
|---|---|
| `/secret-add NAME VALUE` | nothing: no early registration; a value registers on first sight |
| `/secret-list` | nothing: no way to inspect the registry |
| `/secret-reload` | nothing: a value is picked up on the next read of its file |
| `/secret-toggle on/off` | nothing: masking is always on |
| `request_secret` with an input box | the tool exists, but without interactive input it tells you to paste the value into the chat |
| Status bar and footer | nothing: notifications go to the server log as `console.error` tagged `[secret-mask]` |
| The `session_before_tree` hook | no equivalent in OpenCode |
| A final belt on the HTTP request | not wired (masking happens on `context`, tool output, input, compaction) |

## Sharp edges

- **The registry lives until the server restarts.** The port never calls pi's `session_start` hook, so values
  are not reset between sessions: a value from project A keeps masking the same string in project B. Nothing
  leaks (more is masked, not less), but a subscription to session events (`ctx.event.subscribe()`) with a
  reset would be the right fix.
- **A local `Plugin.define`.** The plugin loader in 2.0.20 cannot resolve `@opencode/plugin` from a local
  plugin directory (`Cannot find package`), so `plugin.ts` defines its own — a definition is a plain object
  either way.
- **Values in the command text.** `rewriteBashCommand` comes from pi and inlines `export NAME='value';` into
  the command. The transcript shows a token, but the value is present in the process environment and in shell
  history, exactly as in pi. The `shell.create.before` hook can pass values through `env`, but only fires when
  the command already references `$PI_SECRET_…` itself.
- **Not verified live.** Verification ran against the real engine and a real registry, but through stub objects.
  Real messages are Effect Schema classes where readonly fields may throw; the port then masks a copy, or
  aborts the request (fail-closed).

## How to check and how to turn it off

```bash
# is the plugin loaded?
~/.opencode/bin/opencode api GET /api/plugin | grep -o 'secret-mask[^}]*active'

# reload config and plugins
~/.opencode/bin/opencode reload

# load errors
grep -i 'failed to load plugin' ~/.local/share/opencode/log/opencode.log | tail -3

# debug tool results: the log then records whether content/metadata were rewritten
SM_DEBUG=1 ~/.opencode/bin/opencode reload
```

To turn it off: rename or remove the `plugins/secret-mask` directory and reload.

## Provenance

- Reference implementation: `~/.pi/agent/extensions/secret-mask/` (it has its own README covering behaviour
  and limitations).
- Copied unchanged: `engine.ts` (527 lines), `policy.ts` (920), `config.json`.
- `pi-extension.ts` is the original `index.ts` from pi; the changes are minimal: three import lines, a local
  `typebox.ts` instead of the `typebox` package, and two assignments so the adapter can reach the registry and
  the config.
- `pi-shim.ts` holds the hook mapping listed at the top of this file.

# MDFriday Publish

Turn your Obsidian notes and folders into shareable websites.

This plugin is the **publish** half of the former Friday plugin (sync lives in [obsidian-sync](https://github.com/mdfriday/obsidian-sync)). It reuses the Friday publish UI and Foundry local build, and publishes via the **Cloudflare V2** control plane (Guest → share URL; Google / Creem later).

## Features (M1)

- Select a note or folder, choose a theme, preview locally
- **Guest publish** — no account required; get a public `share.*` URL
- Persist guest token so re-publish updates the same site
- Optional Netlify / FTP (legacy paths kept)

## Develop

```bash
# Link local Foundry (Cloudflare guest APIs)
cd ../foundry && npm run build
cd ../obsidian-publish
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault’s `.obsidian/plugins/mdfriday-publish/`, or set `pluginDir` in `esbuild.config.mjs` and run `npm run dev`.

```bash
npm run lint
npm run check
```

## Staging defaults

| Setting | Default |
| --- | --- |
| API | `https://api.fsky.top` |
| Share | `https://share.fsky.top` |

Override under Settings → Publish → Cloudflare (advanced).

## License

Apache-2.0

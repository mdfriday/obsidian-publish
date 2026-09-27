# MDFriday Publish

**One click. Turn notes into websites.**

Publish a note or a folder from Obsidian as a website. No Git. No GitHub. No build pipelines. Just right click and publish.

## Help us improve MDFriday Publish

- Discord: https://discord.gg/t9F93FChT

## Publish a note exactly as you see it in Obsidian
![GIF: Publish a Note as-is](assets/as-is.gif)

## Publish a note with selected theme
![GIF: Publish a Note with theme](assets/note-theme.gif)

## Publish a folder as a Wiki
![GIF: Publish a Wiki](assets/wiki.gif)

## Why MDFriday Publish?

Obsidian is great for creating knowledge.
Sharing that knowledge is often much harder.
Many publishing solutions require:

* Git
* GitHub
* Static site generators
* Deployment workflows
* Theme configuration

MDFriday Publish removes that complexity.
Publish directly from Obsidian with a single click.

## Network use & privacy

- Publishing requires network access. The plugin talks to the MDFriday API (`api.mdfriday.com`) for guest/account sessions, projects, releases, custom domains and billing; uploads your built site to Cloudflare R2 using short-lived, per-release credentials; and loads the theme catalog and theme packs from `cdn.mdfriday.com`. The plugin itself sends no analytics or telemetry.
- Requests to the MDFriday API include an `X-MDFriday-Client: obsidian-publish/<version>` header (plugin name and version only, no personal data); the MDFriday service records publishing, domain and billing actions server-side to operate and improve the service.

## Learn More

- Website: https://mdfriday.com
- Documentation: https://help.mdfriday.com
- GitHub: https://github.com/mdfriday

## License

Apache 2.0

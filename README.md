# MDFriday Publish

**One click. Turn notes into websites.**

Publish a note or a folder from Obsidian as a website. No Git. No GitHub. No build pipelines. Just right click and publish.

## Publish a note exactly as you see it in Obsidian
![GIF: Publish a Note as-is](assets/as-is.gif)

## Publish a note with selected theme
![GIF: Publish a Note with theme](assets/note-theme.gif)

## Publish a folder as a Wiki
![GIF: Publish a Wiki](assets/wiki.gif)

## Join the MDFriday Community

Need help getting started? Want to share feedback or request new features?

Join our Discord community to:

- Get support and answers to your questions
- Discuss publishing workflows with other users
- Request new features and influence the roadmap
- Get early access to new releases
- Receive community-only discounts and offers

Discord: https://discord.gg/t9F93FChT

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

## Product Vision

> **MD + Theme = Sites**

MDFriday turns the Markdown you already own into websites, then helps you turn those websites into businesses. The core idea is simple:

**Markdown → Theme → Site → Business**

MDFriday is local-first, so your Markdown remains the source of truth and your built websites remain portable. For the complete product vision, architecture, capabilities, and roadmap, see the **[MDFriday Product Map](./product-map.md)**.

## Network use & privacy

- Publishing requires network access. The plugin talks to the MDFriday API (`api.mdfriday.com`) for guest/account sessions, projects, releases, custom domains and billing; uploads your built site to Cloudflare R2 using short-lived, per-release credentials; and loads the theme catalog and theme packs from `cdn.mdfriday.com`. The plugin itself sends no analytics or telemetry.
- Requests to the MDFriday API include an `X-MDFriday-Client: obsidian-publish/<version>` header (plugin name and version only, no personal data); the MDFriday service records publishing, domain and billing actions server-side to operate and improve the service.

## Learn More

- Website: https://mdfriday.com
- Documentation: https://help.mdfriday.com
- GitHub: https://github.com/mdfriday

## License

Apache 2.0

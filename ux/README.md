# MDFriday Publish — UX Prototype

Obsidian plugin high-fidelity UX prototype: **Publish lives in the right sidebar** (side leaf), styled like **apple.com**. Chinese UI. Single-page HTML, no build.

## How to open

1. Double-click `index.html` in a file manager to open in your browser.
2. Or from a terminal:

- macOS: `open /workspace/mdfriday-publish-ux/index.html`
- Linux: `xdg-open /workspace/mdfriday-publish-ux/index.html`
- Or open the file path directly in any browser.

Optional static server:

```bash
cd /workspace/mdfriday-publish-ux && python3 -m http.server 8765
```

Then visit http://127.0.0.1:8765

## Layout

- **Left**: muted Obsidian file tree
- **Center**: muted markdown editor
- **Right (~340px)**: light Apple-style MDFriday Publish panel

Tabs: **发布** · **历史**  
Primary actions: **预览** + **发布** sit in a **sticky bottom full-width** footer (hidden during Building / Result / Verify / Soft-gate).  
**Preview** = local build + local webserver (`http://127.0.0.1:4321/`); same Building/Result chrome as Publish, but blue-gray badge, **停止预览**, and **no history**.  
Plan: **pill in header** → Apple-style tier cards popover (not a third tab). Full subscription management lives in **Obsidian Settings → MDFriday**.

## Plans (encoded)

| Tier | Best for | Highlights | CTA |
|------|----------|------------|-----|
| **Guest** | First try | No account · unlimited sites/builds/exports · **5 MB** · CDN · Note/Wiki · clears next **UTC 00:00** · first Turnstile on mdfriday.com | Install plugin |
| **Free** | Ongoing free publishing | Everything in Guest + **50 MB** · claim Guest same URL · account manage · clears **1st of each month** | Sign up free (`https://mdfriday.com/account/`) |
| **Personal** ($5/mo) | Your domain & lasting sites | Everything in Free + **1 GB** · permanent retention · **1 custom domain + HTTPS** · **release history & rollback** | Upgrade to Personal |

Gates: custom domain + history/rollback = **Personal only**. Soft banners state storage/retention. Password stays Personal-aligned advanced.

## Product highlights (encoded in prototype)

| Rule | Behavior |
|------|----------|
| **Selection fork** | Note → 原样发布 (default) | 单页主题；Folder → Wiki only（原样 disabled） |
| **Project memory** | Reopening a published/revoked path restores mode / theme / password / domain |
| **History & rollback** | Personal only；Guest/Free history tab = locked empty + upgrade CTA |
| **Unpublish** | Success + live history → 撤销发布；status → 已撤销/未公开；URL disabled；settings kept |
| **Guest Turnstile** | Guest + first publish → Verify interstitial → mdfriday.com；Free/Personal skip |
| **Custom domain** | Advanced field；Guest/Free lock → Personal |
| **Sticky bottom actions** | [预览] [发布] / [验证并发布] — full-width footer on Idle |
| **Preview continuity** | Shared `building` + `result` chrome; Preview local-only (no Turnstile, no history) |
| **Live demo** | Theme rows link to `https://demo.mdfriday.com/themes/...` (toast in prototype) |

## Files

- `index.html` — self-contained interactive prototype (inline CSS/JS)
- `DESIGN.md` — full Chinese design spec
- `README.md` — this file

## What to try

Top bar (controls left-grouped; hint on the right):

- **Plan**: Guest / Free / Personal
- **State**: Idle / Verify / Publishing / Success / Soft-gate / **Previewing** / **Preview result**
- **Guest 验证**: 未验证 / 已验证 (Publish only; Preview ignores)
- Show context menu / Open publish panel / Reset memory

In the right panel:

1. Bottom **预览** / **发布** (sticky full-width)
2. Click **预览** → Building → Result「本地预览」→ **停止预览**; history unchanged
3. Click plan **pill** → tier cards (Best for, bullets, price, CTA)
4. Toggle **单篇笔记 | 文件夹** to see publish-mode fork
5. As Guest + 未验证, click **验证并发布** → Verify → **我已完成验证**
6. As Guest/Free open **历史** → locked empty; switch Personal for list + **回滚**
7. On publish Result try **撤销发布**; on preview Result try **停止预览**
8. Idle project strip: published URL and/or「本地预览进行中」/「上次预览 · 已停止」
9. Expand 高级选项 — password & domain under different plans

## No build

Edit the HTML file, save, and refresh the browser. No tooling required.

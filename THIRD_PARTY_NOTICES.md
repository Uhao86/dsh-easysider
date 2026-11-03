# Third-party notices

DSH EasySider is MIT licensed. It uses or references the following third-party
work. Nothing here implies endorsement by the upstream authors.

## DeepSeek Harness (DSH)

- Packages: `@deepseek-ai/dsh`, `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-sdk-app`,
  and related `@deepseek-ai/dsh-*` packages.
- License: MIT.
- Source: <https://github.com/deepseek-ai/deepseek-harness>
- Installed separately by the user; not vendored in this repository.

## deepseek-harness-intelligent-ui

- Purpose: generative / intelligent UI tool definitions (`ui_render`,
  `ui_compose`, `ui_patch`) mounted in the DSH `sdk` profile.
- License: MIT.
- Author: dreamfarer-space.
- Source: <https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui>
- Installed from npm as a separate dependency; not vendored here. The side
  panel implements its own renderer for the component tree.

## DeepSeek whale girl (鲸娘)

- Asset: `tools/whale-girl.webp`, used for the extension icon.
- Source project: <https://github.com/Sutera-Diffusus/dsh-whale-musume>
- License: MIT, Copyright (c) 2026 Sutera-Diffusus.
- Illustrations: [@SuteraWu](https://github.com/SuteraWu).
- Obtained via the demo assets of deepseek-harness-intelligent-ui.
- Full MIT text and attribution: [`tools/ICON-CREDITS.md`](tools/ICON-CREDITS.md).
- This is fan-made artwork, not an official DeepSeek asset.

## Playwright

- Package: `playwright-core` (development/test dependency).
- License: Apache-2.0.
- Source: <https://github.com/microsoft/playwright>
- Used only by the browser tests; not bundled into the extension.

## Chrome for Testing

- Used by the tests via a local Playwright browser cache. Not redistributed.

## Trademarks

DeepSeek, DSH and related names are trademarks of their respective owners.
DSH EasySider is an independent community project and is not affiliated with
or endorsed by DeepSeek.

# Third-Party Notices

Mind Map Tool（© 2026 ErDong Zou，MIT License，见根 LICENSE）
包含以下第三方组件与资产。各条目按其原始许可分发，权利归各自权利人所有；
本文件完整枚举实际分发的 JavaScript、Cargo 与字体资产及其许可（生成于 PRR-060，
由 `scripts/quality/generate-third-party-notices.mjs` 从 pnpm store、`cargo metadata --locked`
与 `assets/fonts/` 登记确定性生成；`pnpm license:scan` 校验每个条目均被覆盖）。

- JavaScript packages（direct + transitive）：391
- Cargo packages：487
- Fonts / license texts：4

## Fonts（随应用分发的字体）

| 资产 | 版本/形态 | 许可 | 来源 | 分发文件 |
| --- | --- | --- | --- | --- |
| Noto Sans SC Regular (WOFF2) | SubsetOTF converted via fontTools ttLib.woff2 (lossless) | OFL-1.1 | https://github.com/notofonts/noto-cjk (Sans/SubsetOTF/SC) | `assets/fonts/noto-sans-sc-regular.woff2` |
| Noto Sans SC Bold (WOFF2) | SubsetOTF converted via fontTools ttLib.woff2 (lossless) | OFL-1.1 | https://github.com/notofonts/noto-cjk (Sans/SubsetOTF/SC) | `assets/fonts/noto-sans-sc-bold.woff2` |
| LXGW WenKai Regular (WOFF2) | v1.520 converted via fontTools ttLib.woff2 (lossless) | OFL-1.1 | https://github.com/lxgw/LxgwWenKai | `assets/fonts/lxgw-wenkai-regular.woff2` |
| SIL Open Font License 1.1 text | 1.1 | OFL-1.1 (license text) | notofonts/noto-cjk repository | `assets/fonts/OFL-1.1.txt` |

OFL 1.1 全文见 `assets/fonts/OFL-1.1.txt`（随包分发保留；附录亦嵌入）。
WOFF2 为无损格式转换（名称表未改、无字形修改），Reserved Font Name 义务不变；
禁止单独出售字体本体。

## JavaScript packages

格式：`name@version` — License — Source — 本地许可文本路径（构建环境）。
标 ★ 的为 workspace 直接声明依赖。

- `@asamuzakjp/css-color@3.2.0` — License: MIT — Source: https://github.com/asamuzaK/cssColor — Text: node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/@asamuzakjp/css-color/LICENSE
- `@babel/code-frame@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+code-frame@7.29.7/node_modules/@babel/code-frame/LICENSE
- `@babel/compat-data@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+compat-data@7.29.7/node_modules/@babel/compat-data/LICENSE
- `@babel/core@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/core/LICENSE
- `@babel/generator@7.29.8` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/generator/LICENSE
- `@babel/helper-compilation-targets@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/helper-compilation-targets/LICENSE
- `@babel/helper-globals@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+helper-globals@7.29.7/node_modules/@babel/helper-globals/LICENSE
- `@babel/helper-module-imports@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+helper-module-imports@7.29.7/node_modules/@babel/helper-module-imports/LICENSE
- `@babel/helper-module-transforms@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/helper-module-transforms/LICENSE
- `@babel/helper-plugin-utils@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+helper-plugin-utils@7.29.7/node_modules/@babel/helper-plugin-utils/LICENSE
- `@babel/helper-string-parser@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+helper-string-parser@7.29.7/node_modules/@babel/helper-string-parser/LICENSE
- `@babel/helper-validator-identifier@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+code-frame@7.29.7/node_modules/@babel/helper-validator-identifier/LICENSE
- `@babel/helper-validator-option@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+helper-compilation-targets@7.29.7/node_modules/@babel/helper-validator-option/LICENSE
- `@babel/helpers@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/helpers/LICENSE
- `@babel/parser@7.29.8` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/parser/LICENSE
- `@babel/plugin-transform-react-jsx-self@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+plugin-transform-react-jsx-self@7.29.7_@babel+core@7.29.7/node_modules/@babel/plugin-transform-react-jsx-self/LICENSE
- `@babel/plugin-transform-react-jsx-source@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+plugin-transform-react-jsx-source@7.29.7_@babel+core@7.29.7/node_modules/@babel/plugin-transform-react-jsx-source/LICENSE
- `@babel/runtime@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+runtime@7.29.7/node_modules/@babel/runtime/LICENSE
- `@babel/template@7.29.7` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/template/LICENSE
- `@babel/traverse@7.29.8` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/traverse/LICENSE
- `@babel/types@7.29.8` — License: MIT — Source: https://github.com/babel/babel — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@babel/types/LICENSE
- `@csstools/color-helpers@5.1.0` — License: MIT-0 — Source: https://github.com/csstools/postcss-plugins — Text: node_modules/.pnpm/@csstools+color-helpers@5.1.0/node_modules/@csstools/color-helpers/LICENSE.md
- `@csstools/css-calc@2.1.4` — License: MIT — Source: https://github.com/csstools/postcss-plugins — Text: node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/@csstools/css-calc/LICENSE.md
- `@csstools/css-color-parser@3.1.0` — License: MIT — Source: https://github.com/csstools/postcss-plugins — Text: node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/@csstools/css-color-parser/LICENSE.md
- `@csstools/css-parser-algorithms@3.0.5` — License: MIT — Source: https://github.com/csstools/postcss-plugins — Text: node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/@csstools/css-parser-algorithms/LICENSE.md
- `@csstools/css-tokenizer@3.0.4` — License: MIT — Source: https://github.com/csstools/postcss-plugins — Text: node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/@csstools/css-tokenizer/LICENSE.md
- `@esbuild/darwin-arm64@0.21.5` — License: MIT — Source: https://github.com/evanw/esbuild — Text: (包内未随附独立文本文件)
- `@esbuild/darwin-arm64@0.25.12` — License: MIT — Source: https://github.com/evanw/esbuild — Text: (包内未随附独立文本文件)
- `@esbuild/darwin-arm64@0.28.2` — License: MIT — Source: https://github.com/evanw/esbuild — Text: (包内未随附独立文本文件)
- `@eslint-community/eslint-utils@4.10.1` — License: MIT — Source: https://github.com/eslint-community/eslint-utils — Text: node_modules/.pnpm/@eslint-community+eslint-utils@4.10.1_eslint@9.39.5/node_modules/@eslint-community/eslint-utils/LICENSE
- `@eslint-community/regexpp@4.12.2` — License: MIT — Source: https://github.com/eslint-community/regexpp — Text: node_modules/.pnpm/@eslint-community+regexpp@4.12.2/node_modules/@eslint-community/regexpp/LICENSE
- `@eslint/config-array@0.21.2` — License: Apache-2.0 — Source: https://github.com/eslint/rewrite — Text: node_modules/.pnpm/@eslint+config-array@0.21.2/node_modules/@eslint/config-array/LICENSE
- `@eslint/config-helpers@0.4.2` — License: Apache-2.0 — Source: https://github.com/eslint/rewrite — Text: node_modules/.pnpm/@eslint+config-helpers@0.4.2/node_modules/@eslint/config-helpers/LICENSE
- `@eslint/core@0.17.0` — License: Apache-2.0 — Source: https://github.com/eslint/rewrite — Text: node_modules/.pnpm/@eslint+config-helpers@0.4.2/node_modules/@eslint/core/LICENSE
- `@eslint/eslintrc@3.3.6` — License: MIT — Source: eslint/eslintrc — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/@eslint/eslintrc/LICENSE
★ - `@eslint/js@9.39.5` — License: MIT — Source: https://github.com/eslint/eslint — Text: node_modules/.pnpm/@eslint+js@9.39.5/node_modules/@eslint/js/LICENSE
- `@eslint/object-schema@2.1.7` — License: Apache-2.0 — Source: https://github.com/eslint/rewrite — Text: node_modules/.pnpm/@eslint+config-array@0.21.2/node_modules/@eslint/object-schema/LICENSE
- `@eslint/plugin-kit@0.4.1` — License: Apache-2.0 — Source: https://github.com/eslint/rewrite — Text: node_modules/.pnpm/@eslint+plugin-kit@0.4.1/node_modules/@eslint/plugin-kit/LICENSE
- `@hono/node-server@2.1.1` — License: MIT — Source: https://github.com/honojs/node-server — Text: node_modules/.pnpm/@hono+node-server@2.1.1_hono@4.13.8/node_modules/@hono/node-server/LICENSE
- `@humanfs/core@0.19.2` — License: Apache-2.0 — Source: https://github.com/humanwhocodes/humanfs — Text: node_modules/.pnpm/@humanfs+core@0.19.2/node_modules/@humanfs/core/LICENSE
- `@humanfs/node@0.16.8` — License: Apache-2.0 — Source: https://github.com/humanwhocodes/humanfs — Text: node_modules/.pnpm/@humanfs+node@0.16.8/node_modules/@humanfs/node/LICENSE
- `@humanfs/types@0.15.0` — License: Apache-2.0 — Source: https://github.com/humanwhocodes/humanfs — Text: (包内未随附独立文本文件)
- `@humanwhocodes/module-importer@1.0.1` — License: Apache-2.0 — Source: https://github.com/humanwhocodes/module-importer — Text: node_modules/.pnpm/@humanwhocodes+module-importer@1.0.1/node_modules/@humanwhocodes/module-importer/LICENSE
- `@humanwhocodes/retry@0.4.3` — License: Apache-2.0 — Source: https://github.com/humanwhocodes/retry — Text: node_modules/.pnpm/@humanfs+node@0.16.8/node_modules/@humanwhocodes/retry/LICENSE
- `@jridgewell/gen-mapping@0.3.13` — License: MIT — Source: https://github.com/jridgewell/sourcemaps — Text: node_modules/.pnpm/@babel+generator@7.29.8/node_modules/@jridgewell/gen-mapping/LICENSE
- `@jridgewell/remapping@2.3.5` — License: MIT — Source: https://github.com/jridgewell/sourcemaps — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/@jridgewell/remapping/LICENSE
- `@jridgewell/resolve-uri@3.1.2` — License: MIT — Source: https://github.com/jridgewell/resolve-uri — Text: node_modules/.pnpm/@jridgewell+resolve-uri@3.1.2/node_modules/@jridgewell/resolve-uri/LICENSE
- `@jridgewell/source-map@0.3.11` — License: MIT — Source: https://github.com/jridgewell/sourcemaps — Text: node_modules/.pnpm/@jridgewell+source-map@0.3.11/node_modules/@jridgewell/source-map/LICENSE
- `@jridgewell/sourcemap-codec@1.5.5` — License: MIT — Source: https://github.com/jridgewell/sourcemaps — Text: node_modules/.pnpm/@jridgewell+gen-mapping@0.3.13/node_modules/@jridgewell/sourcemap-codec/LICENSE
- `@jridgewell/trace-mapping@0.3.31` — License: MIT — Source: https://github.com/jridgewell/sourcemaps — Text: node_modules/.pnpm/@babel+generator@7.29.8/node_modules/@jridgewell/trace-mapping/LICENSE
- `@modelcontextprotocol/sdk@1.30.0` — License: MIT — Source: https://github.com/modelcontextprotocol/typescript-sdk — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/@modelcontextprotocol/sdk/LICENSE
★ - `@pdf-lib/fontkit@1.1.1` — License: MIT — Source: https://github.com/Hopding/fontkit — Text: (包内未随附独立文本文件)
- `@pdf-lib/standard-fonts@1.0.0` — License: MIT — Source: https://github.com/Hopding/standard-fonts — Text: node_modules/.pnpm/@pdf-lib+standard-fonts@1.0.0/node_modules/@pdf-lib/standard-fonts/LICENSE.md
- `@pdf-lib/upng@1.0.1` — License: MIT — Source: https://github.com/Hopding/upng — Text: node_modules/.pnpm/@pdf-lib+upng@1.0.1/node_modules/@pdf-lib/upng/LICENSE
★ - `@resvg/resvg-wasm@2.6.2` — License: MPL-2.0 — Source: git@github.com:yisibl/resvg-js — Text: (包内未随附独立文本文件)
- `@rolldown/pluginutils@1.0.0-beta.27` — License: MIT — Source: https://github.com/rolldown/rolldown — Text: node_modules/.pnpm/@rolldown+pluginutils@1.0.0-beta.27/node_modules/@rolldown/pluginutils/LICENSE
- `@rollup/rollup-darwin-arm64@4.63.0` — License: MIT — Source: https://github.com/rollup/rollup — Text: (包内未随附独立文本文件)
- `@swc/helpers@0.5.23` — License: Apache-2.0 — Source: https://github.com/swc-project/swc — Text: node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers/LICENSE
★ - `@tauri-apps/api@2.11.1` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/LICENSE_APACHE-2.0
- `@tauri-apps/cli-darwin-arm64@2.11.4` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: (包内未随附独立文本文件)
★ - `@tauri-apps/cli@2.11.4` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: node_modules/.pnpm/@tauri-apps+cli@2.11.4/node_modules/@tauri-apps/cli/LICENSE_APACHE-2.0
★ - `@testing-library/dom@10.4.1` — License: MIT — Source: https://github.com/testing-library/dom-testing-library — Text: node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/LICENSE
★ - `@testing-library/react@16.3.2` — License: MIT — Source: https://github.com/testing-library/react-testing-library — Text: node_modules/.pnpm/@testing-library+react@16.3.2_@testing-library+dom@10.4.1_@types+react-dom@19.2.5_@types+reac_vx6xrca6ouinon4cq6e6wplemy/node_modules/@testing-library/react/LICENSE
- `@types/aria-query@5.0.4` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/@types/aria-query/LICENSE
- `@types/babel__core@7.20.5` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+babel__core@7.20.5/node_modules/@types/babel__core/LICENSE
- `@types/babel__generator@7.27.0` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+babel__core@7.20.5/node_modules/@types/babel__generator/LICENSE
- `@types/babel__template@7.4.4` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+babel__core@7.20.5/node_modules/@types/babel__template/LICENSE
- `@types/babel__traverse@7.28.0` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+babel__core@7.20.5/node_modules/@types/babel__traverse/LICENSE
- `@types/d3-color@3.1.3` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+d3-color@3.1.3/node_modules/@types/d3-color/LICENSE
- `@types/d3-drag@3.0.7` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+d3-drag@3.0.7/node_modules/@types/d3-drag/LICENSE
- `@types/d3-interpolate@3.0.4` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+d3-interpolate@3.0.4/node_modules/@types/d3-interpolate/LICENSE
- `@types/d3-selection@3.0.11` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+d3-drag@3.0.7/node_modules/@types/d3-selection/LICENSE
- `@types/d3-transition@3.0.9` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+d3-transition@3.0.9/node_modules/@types/d3-transition/LICENSE
- `@types/d3-zoom@3.0.8` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+d3-zoom@3.0.8/node_modules/@types/d3-zoom/LICENSE
- `@types/estree@1.0.9` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+estree@1.0.9/node_modules/@types/estree/LICENSE
- `@types/json-schema@7.0.15` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@eslint+core@0.17.0/node_modules/@types/json-schema/LICENSE
★ - `@types/node@24.13.3` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@types+node@24.13.3/node_modules/@types/node/LICENSE
★ - `@types/react-dom@19.2.5` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@testing-library+react@16.3.2_@testing-library+dom@10.4.1_@types+react-dom@19.2.5_@types+reac_vx6xrca6ouinon4cq6e6wplemy/node_modules/@types/react-dom/LICENSE
★ - `@types/react@19.2.18` — License: MIT — Source: https://github.com/DefinitelyTyped/DefinitelyTyped — Text: node_modules/.pnpm/@testing-library+react@16.3.2_@testing-library+dom@10.4.1_@types+react-dom@19.2.5_@types+reac_vx6xrca6ouinon4cq6e6wplemy/node_modules/@types/react/LICENSE
- `@typescript-eslint/eslint-plugin@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/@typescript-eslint/eslint-plugin/LICENSE
- `@typescript-eslint/parser@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/@typescript-eslint/parser/LICENSE
- `@typescript-eslint/project-service@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+project-service@8.68.0_typescript@5.9.3/node_modules/@typescript-eslint/project-service/LICENSE
- `@typescript-eslint/scope-manager@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/@typescript-eslint/scope-manager/LICENSE
- `@typescript-eslint/tsconfig-utils@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+project-service@8.68.0_typescript@5.9.3/node_modules/@typescript-eslint/tsconfig-utils/LICENSE
- `@typescript-eslint/type-utils@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/@typescript-eslint/type-utils/LICENSE
- `@typescript-eslint/types@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+parser@8.68.0_eslint@9.39.5_typescript@5.9.3/node_modules/@typescript-eslint/types/LICENSE
- `@typescript-eslint/typescript-estree@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+parser@8.68.0_eslint@9.39.5_typescript@5.9.3/node_modules/@typescript-eslint/typescript-estree/LICENSE
- `@typescript-eslint/utils@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/@typescript-eslint/utils/LICENSE
- `@typescript-eslint/visitor-keys@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/@typescript-eslint/visitor-keys/LICENSE
★ - `@vitejs/plugin-react@4.7.0` — License: MIT — Source: https://github.com/vitejs/vite-plugin-react — Text: node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.3_@types+node@24.13.3_terser@5.51.2_/node_modules/@vitejs/plugin-react/LICENSE
- `@vitest/expect@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+expect@2.1.9/node_modules/@vitest/expect/LICENSE
- `@vitest/mocker@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+mocker@2.1.9_vite@5.4.21_@types+node@24.13.3_terser@5.51.2_/node_modules/@vitest/mocker/LICENSE
- `@vitest/pretty-format@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+pretty-format@2.1.9/node_modules/@vitest/pretty-format/LICENSE
- `@vitest/runner@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+runner@2.1.9/node_modules/@vitest/runner/LICENSE
- `@vitest/snapshot@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+snapshot@2.1.9/node_modules/@vitest/snapshot/LICENSE
- `@vitest/spy@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+expect@2.1.9/node_modules/@vitest/spy/LICENSE
- `@vitest/utils@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/@vitest+expect@2.1.9/node_modules/@vitest/utils/LICENSE
★ - `@xyflow/react@12.11.5` — License: MIT — Source: https://github.com/xyflow/xyflow — Text: node_modules/.pnpm/@xyflow+react@12.11.5_@types+react-dom@19.2.5_@types+react@19.2.18__@types+react@19.2.18_reac_xn5bnmkngsnhtzfbdvhw7ezyyy/node_modules/@xyflow/react/LICENSE
- `@xyflow/system@0.0.81` — License: MIT — Source: https://github.com/xyflow/xyflow — Text: node_modules/.pnpm/@xyflow+react@12.11.5_@types+react-dom@19.2.5_@types+react@19.2.18__@types+react@19.2.18_reac_xn5bnmkngsnhtzfbdvhw7ezyyy/node_modules/@xyflow/system/LICENSE
- `accepts@2.0.0` — License: MIT — Source: jshttp/accepts — Text: node_modules/.pnpm/accepts@2.0.0/node_modules/accepts/LICENSE
- `acorn-jsx@5.3.2` — License: MIT — Source: https://github.com/acornjs/acorn-jsx — Text: node_modules/.pnpm/acorn-jsx@5.3.2_acorn@8.18.0/node_modules/acorn-jsx/LICENSE
- `acorn@8.18.0` — License: MIT — Source: https://github.com/acornjs/acorn — Text: node_modules/.pnpm/acorn-jsx@5.3.2_acorn@8.18.0/node_modules/acorn/LICENSE
- `agent-base@7.1.4` — License: MIT — Source: https://github.com/TooTallNate/proxy-agents — Text: node_modules/.pnpm/agent-base@7.1.4/node_modules/agent-base/LICENSE
- `ajv-formats@3.0.1` — License: MIT — Source: https://github.com/ajv-validator/ajv-formats — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/ajv-formats/LICENSE
- `ajv@6.15.0` — License: MIT — Source: https://github.com/ajv-validator/ajv — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/ajv/LICENSE
- `ajv@8.20.0` — License: MIT — Source: ajv-validator/ajv — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/ajv/LICENSE
- `ansi-regex@5.0.1` — License: MIT — Source: chalk/ansi-regex — Text: node_modules/.pnpm/ansi-regex@5.0.1/node_modules/ansi-regex/LICENSE
- `ansi-styles@4.3.0` — License: MIT — Source: chalk/ansi-styles — Text: node_modules/.pnpm/ansi-styles@4.3.0/node_modules/ansi-styles/LICENSE
- `ansi-styles@5.2.0` — License: MIT — Source: chalk/ansi-styles — Text: node_modules/.pnpm/ansi-styles@5.2.0/node_modules/ansi-styles/LICENSE
- `argparse@2.0.1` — License: Python-2.0 — Source: nodeca/argparse — Text: node_modules/.pnpm/argparse@2.0.1/node_modules/argparse/LICENSE
- `aria-query@5.3.0` — License: Apache-2.0 — Source: https://github.com/A11yance/aria-query — Text: node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/aria-query/LICENSE
- `assertion-error@2.0.1` — License: MIT — Source: git@github.com:chaijs/assertion-error — Text: node_modules/.pnpm/assertion-error@2.0.1/node_modules/assertion-error/LICENSE
★ - `axe-core@4.13.0` — License: MPL-2.0 — Source: https://github.com/dequelabs/axe-core — Text: node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/LICENSE
- `balanced-match@1.0.2` — License: MIT — Source: https://github.com/juliangruber/balanced-match — Text: node_modules/.pnpm/balanced-match@1.0.2/node_modules/balanced-match/LICENSE.md
- `balanced-match@4.0.4` — License: MIT — Source: https://github.com/juliangruber/balanced-match — Text: node_modules/.pnpm/balanced-match@4.0.4/node_modules/balanced-match/LICENSE.md
- `base64-js@1.5.1` — License: MIT — Source: https://github.com/beatgammit/base64-js — Text: node_modules/.pnpm/base64-js@1.5.1/node_modules/base64-js/LICENSE
- `baseline-browser-mapping@2.11.19` — License: Apache-2.0 — Source: https://github.com/web-platform-dx/baseline-browser-mapping — Text: node_modules/.pnpm/baseline-browser-mapping@2.11.19/node_modules/baseline-browser-mapping/LICENSE.txt
- `body-parser@2.3.0` — License: MIT — Source: expressjs/body-parser — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/body-parser/LICENSE
- `brace-expansion@1.1.18` — License: MIT — Source: https://github.com/juliangruber/brace-expansion — Text: node_modules/.pnpm/brace-expansion@1.1.18/node_modules/brace-expansion/LICENSE
- `brace-expansion@5.0.9` — License: MIT — Source: https://github.com/juliangruber/brace-expansion — Text: node_modules/.pnpm/brace-expansion@5.0.9/node_modules/brace-expansion/LICENSE
- `brotli@1.3.3` — License: MIT — Source: https://github.com/devongovett/brotli.js — Text: (包内未随附独立文本文件)
- `browserslist@4.28.8` — License: MIT — Source: browserslist/browserslist — Text: node_modules/.pnpm/@babel+helper-compilation-targets@7.29.7/node_modules/browserslist/LICENSE
- `buffer-from@1.1.2` — License: MIT — Source: LinusU/buffer-from — Text: node_modules/.pnpm/buffer-from@1.1.2/node_modules/buffer-from/LICENSE
- `bytes@3.1.2` — License: MIT — Source: visionmedia/bytes.js — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/bytes/LICENSE
- `cac@6.7.14` — License: MIT — Source: egoist/cac — Text: node_modules/.pnpm/cac@6.7.14/node_modules/cac/LICENSE
- `call-bind-apply-helpers@1.0.2` — License: MIT — Source: https://github.com/ljharb/call-bind-apply-helpers — Text: node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/LICENSE
- `call-bound@1.0.4` — License: MIT — Source: https://github.com/ljharb/call-bound — Text: node_modules/.pnpm/call-bound@1.0.4/node_modules/call-bound/LICENSE
- `callsites@3.1.0` — License: MIT — Source: sindresorhus/callsites — Text: node_modules/.pnpm/callsites@3.1.0/node_modules/callsites/LICENSE
- `caniuse-lite@1.0.30001810` — License: CC-BY-4.0 — Source: browserslist/caniuse-lite — Text: node_modules/.pnpm/browserslist@4.28.8/node_modules/caniuse-lite/LICENSE
- `chai@5.3.3` — License: MIT — Source: https://github.com/chaijs/chai — Text: node_modules/.pnpm/@vitest+expect@2.1.9/node_modules/chai/LICENSE
- `chalk@4.1.2` — License: MIT — Source: chalk/chalk — Text: node_modules/.pnpm/chalk@4.1.2/node_modules/chalk/LICENSE
- `check-error@2.1.3` — License: MIT — Source: https://github.com/chaijs/check-error — Text: node_modules/.pnpm/chai@5.3.3/node_modules/check-error/LICENSE
- `classcat@5.0.5` — License: MIT — Source: jorgebucaran/classcat — Text: node_modules/.pnpm/@xyflow+react@12.11.5_@types+react-dom@19.2.5_@types+react@19.2.18__@types+react@19.2.18_reac_xn5bnmkngsnhtzfbdvhw7ezyyy/node_modules/classcat/LICENSE.md
- `clone@2.1.2` — License: MIT — Source: https://github.com/pvorb/node-clone — Text: node_modules/.pnpm/clone@2.1.2/node_modules/clone/LICENSE
- `color-convert@2.0.1` — License: MIT — Source: Qix-/color-convert — Text: node_modules/.pnpm/ansi-styles@4.3.0/node_modules/color-convert/LICENSE
- `color-name@1.1.4` — License: MIT — Source: git@github.com:colorjs/color-name — Text: node_modules/.pnpm/color-convert@2.0.1/node_modules/color-name/LICENSE
- `commander@2.20.3` — License: MIT — Source: https://github.com/tj/commander.js — Text: node_modules/.pnpm/commander@2.20.3/node_modules/commander/LICENSE
- `concat-map@0.0.1` — License: MIT — Source: https://github.com/substack/node-concat-map — Text: node_modules/.pnpm/brace-expansion@1.1.18/node_modules/concat-map/LICENSE
- `content-disposition@1.1.0` — License: MIT — Source: jshttp/content-disposition — Text: node_modules/.pnpm/content-disposition@1.1.0/node_modules/content-disposition/LICENSE
- `content-type@1.0.5` — License: MIT — Source: jshttp/content-type — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/content-type/LICENSE
- `content-type@2.1.0` — License: MIT — Source: jshttp/content-type — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/content-type/LICENSE
- `convert-source-map@2.0.0` — License: MIT — Source: https://github.com/thlorenz/convert-source-map — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/convert-source-map/LICENSE
- `cookie-signature@1.2.2` — License: MIT — Source: https://github.com/visionmedia/node-cookie-signature — Text: node_modules/.pnpm/cookie-signature@1.2.2/node_modules/cookie-signature/LICENSE
- `cookie@0.7.2` — License: MIT — Source: jshttp/cookie — Text: node_modules/.pnpm/cookie@0.7.2/node_modules/cookie/LICENSE
- `cors@2.8.6` — License: MIT — Source: expressjs/cors — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/cors/LICENSE
- `cross-spawn@7.0.6` — License: MIT — Source: git@github.com:moxystudio/node-cross-spawn — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/cross-spawn/LICENSE
- `cssstyle@4.6.0` — License: MIT — Source: jsdom/cssstyle — Text: node_modules/.pnpm/cssstyle@4.6.0/node_modules/cssstyle/LICENSE
- `csstype@3.2.3` — License: MIT — Source: https://github.com/frenic/csstype — Text: node_modules/.pnpm/@types+react@19.2.18/node_modules/csstype/LICENSE
- `d3-color@3.1.0` — License: ISC — Source: https://github.com/d3/d3-color — Text: node_modules/.pnpm/d3-color@3.1.0/node_modules/d3-color/LICENSE
- `d3-dispatch@3.0.1` — License: ISC — Source: https://github.com/d3/d3-dispatch — Text: node_modules/.pnpm/d3-dispatch@3.0.1/node_modules/d3-dispatch/LICENSE
- `d3-drag@3.0.0` — License: ISC — Source: https://github.com/d3/d3-drag — Text: node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/d3-drag/LICENSE
- `d3-ease@3.0.1` — License: BSD-3-Clause — Source: https://github.com/d3/d3-ease — Text: node_modules/.pnpm/d3-ease@3.0.1/node_modules/d3-ease/LICENSE
- `d3-interpolate@3.0.1` — License: ISC — Source: https://github.com/d3/d3-interpolate — Text: node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/d3-interpolate/LICENSE
- `d3-selection@3.0.0` — License: ISC — Source: https://github.com/d3/d3-selection — Text: node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/d3-selection/LICENSE
- `d3-timer@3.0.1` — License: ISC — Source: https://github.com/d3/d3-timer — Text: node_modules/.pnpm/d3-timer@3.0.1/node_modules/d3-timer/LICENSE
- `d3-transition@3.0.1` — License: ISC — Source: https://github.com/d3/d3-transition — Text: node_modules/.pnpm/d3-transition@3.0.1_d3-selection@3.0.0/node_modules/d3-transition/LICENSE
- `d3-zoom@3.0.0` — License: ISC — Source: https://github.com/d3/d3-zoom — Text: node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/d3-zoom/LICENSE
- `data-urls@5.0.0` — License: MIT — Source: jsdom/data-urls — Text: node_modules/.pnpm/data-urls@5.0.0/node_modules/data-urls/LICENSE.txt
- `debug@4.4.3` — License: MIT — Source: https://github.com/debug-js/debug — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/debug/LICENSE
- `decimal.js@10.6.0` — License: MIT — Source: https://github.com/MikeMcl/decimal.js — Text: node_modules/.pnpm/decimal.js@10.6.0/node_modules/decimal.js/LICENCE.md
- `deep-eql@5.0.2` — License: MIT — Source: git@github.com:chaijs/deep-eql — Text: node_modules/.pnpm/chai@5.3.3/node_modules/deep-eql/LICENSE
- `deep-is@0.1.4` — License: MIT — Source: http://github.com/thlorenz/deep-is — Text: node_modules/.pnpm/deep-is@0.1.4/node_modules/deep-is/LICENSE
- `depd@2.0.0` — License: MIT — Source: dougwilson/nodejs-depd — Text: node_modules/.pnpm/depd@2.0.0/node_modules/depd/LICENSE
- `dequal@2.0.3` — License: MIT — Source: lukeed/dequal — Text: node_modules/.pnpm/aria-query@5.3.0/node_modules/dequal/LICENSE
- `dfa@1.2.0` — License: MIT — Source: https://github.com/devongovett/dfa — Text: (包内未随附独立文本文件)
- `dom-accessibility-api@0.5.16` — License: MIT — Source: https://github.com/eps1lon/dom-accessibility-api — Text: node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/dom-accessibility-api/LICENSE.md
- `dunder-proto@1.0.1` — License: MIT — Source: https://github.com/es-shims/dunder-proto — Text: node_modules/.pnpm/dunder-proto@1.0.1/node_modules/dunder-proto/LICENSE
- `ee-first@1.1.1` — License: MIT — Source: jonathanong/ee-first — Text: node_modules/.pnpm/ee-first@1.1.1/node_modules/ee-first/LICENSE
- `electron-to-chromium@1.5.415` — License: ISC — Source: https://github.com/Kilian/electron-to-chromium — Text: node_modules/.pnpm/browserslist@4.28.8/node_modules/electron-to-chromium/LICENSE
- `encodeurl@2.0.0` — License: MIT — Source: pillarjs/encodeurl — Text: node_modules/.pnpm/encodeurl@2.0.0/node_modules/encodeurl/LICENSE
- `entities@6.0.1` — License: BSD-2-Clause — Source: https://github.com/fb55/entities — Text: node_modules/.pnpm/entities@6.0.1/node_modules/entities/LICENSE
- `es-define-property@1.0.1` — License: MIT — Source: https://github.com/ljharb/es-define-property — Text: node_modules/.pnpm/es-define-property@1.0.1/node_modules/es-define-property/LICENSE
- `es-errors@1.3.0` — License: MIT — Source: https://github.com/ljharb/es-errors — Text: node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/es-errors/LICENSE
- `es-module-lexer@1.7.0` — License: MIT — Source: https://github.com/guybedford/es-module-lexer — Text: node_modules/.pnpm/es-module-lexer@1.7.0/node_modules/es-module-lexer/LICENSE
- `es-object-atoms@1.1.2` — License: MIT — Source: https://github.com/ljharb/es-object-atoms — Text: node_modules/.pnpm/es-object-atoms@1.1.2/node_modules/es-object-atoms/LICENSE
- `esbuild@0.21.5` — License: MIT — Source: https://github.com/evanw/esbuild — Text: node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/LICENSE.md
- `esbuild@0.25.12` — License: MIT — Source: https://github.com/evanw/esbuild — Text: node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/LICENSE.md
- `esbuild@0.28.2` — License: MIT — Source: https://github.com/evanw/esbuild — Text: node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/LICENSE.md
- `escalade@3.2.0` — License: MIT — Source: lukeed/escalade — Text: node_modules/.pnpm/escalade@3.2.0/node_modules/escalade/LICENSE
- `escape-html@1.0.3` — License: MIT — Source: component/escape-html — Text: node_modules/.pnpm/escape-html@1.0.3/node_modules/escape-html/LICENSE
- `escape-string-regexp@4.0.0` — License: MIT — Source: sindresorhus/escape-string-regexp — Text: node_modules/.pnpm/escape-string-regexp@4.0.0/node_modules/escape-string-regexp/LICENSE
- `eslint-scope@8.4.0` — License: BSD-2-Clause — Source: https://github.com/eslint/js — Text: node_modules/.pnpm/eslint-scope@8.4.0/node_modules/eslint-scope/LICENSE
- `eslint-visitor-keys@3.4.3` — License: Apache-2.0 — Source: eslint/eslint-visitor-keys — Text: node_modules/.pnpm/@eslint-community+eslint-utils@4.10.1_eslint@9.39.5/node_modules/eslint-visitor-keys/LICENSE
- `eslint-visitor-keys@4.2.1` — License: Apache-2.0 — Source: https://github.com/eslint/js — Text: node_modules/.pnpm/eslint-visitor-keys@4.2.1/node_modules/eslint-visitor-keys/LICENSE
- `eslint-visitor-keys@5.0.1` — License: Apache-2.0 — Source: https://github.com/eslint/js — Text: node_modules/.pnpm/@typescript-eslint+visitor-keys@8.68.0/node_modules/eslint-visitor-keys/LICENSE
★ - `eslint@9.39.5` — License: MIT — Source: eslint/eslint — Text: node_modules/.pnpm/@eslint-community+eslint-utils@4.10.1_eslint@9.39.5/node_modules/eslint/LICENSE
- `espree@10.4.0` — License: BSD-2-Clause — Source: https://github.com/eslint/js — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/espree/LICENSE
- `esquery@1.7.0` — License: BSD-3-Clause — Source: https://github.com/estools/esquery — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/esquery/LICENSE.txt
- `esrecurse@4.3.0` — License: BSD-2-Clause — Source: https://github.com/estools/esrecurse — Text: (包内未随附独立文本文件)
- `estraverse@5.3.0` — License: BSD-2-Clause — Source: http://github.com/estools/estraverse — Text: node_modules/.pnpm/eslint-scope@8.4.0/node_modules/estraverse/LICENSE.BSD
- `estree-walker@3.0.3` — License: MIT — Source: https://github.com/Rich-Harris/estree-walker — Text: node_modules/.pnpm/@vitest+mocker@2.1.9_vite@5.4.21_@types+node@24.13.3_terser@5.51.2_/node_modules/estree-walker/LICENSE
- `esutils@2.0.3` — License: BSD-2-Clause — Source: http://github.com/estools/esutils — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/esutils/LICENSE.BSD
- `etag@1.8.1` — License: MIT — Source: jshttp/etag — Text: node_modules/.pnpm/etag@1.8.1/node_modules/etag/LICENSE
- `eventsource-parser@3.1.1` — License: MIT — Source: https://github.com/rexxars/eventsource-parser — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/eventsource-parser/LICENSE
- `eventsource@3.0.7` — License: MIT — Source: https://git@github.com/EventSource/eventsource — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/eventsource/LICENSE
- `expect-type@1.4.0` — License: Apache-2.0 — Source: https://github.com/mmkal/expect-type — Text: node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/LICENSE
- `express-rate-limit@8.7.0` — License: MIT — Source: https://github.com/express-rate-limit/express-rate-limit — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/express-rate-limit/LICENSE
- `express@5.2.1` — License: MIT — Source: expressjs/express — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/express/LICENSE
- `fast-deep-equal@3.1.3` — License: MIT — Source: https://github.com/epoberezkin/fast-deep-equal — Text: node_modules/.pnpm/ajv@6.15.0/node_modules/fast-deep-equal/LICENSE
- `fast-json-stable-stringify@2.1.0` — License: MIT — Source: https://github.com/epoberezkin/fast-json-stable-stringify — Text: node_modules/.pnpm/ajv@6.15.0/node_modules/fast-json-stable-stringify/LICENSE
- `fast-levenshtein@2.0.6` — License: MIT — Source: https://github.com/hiddentao/fast-levenshtein — Text: node_modules/.pnpm/fast-levenshtein@2.0.6/node_modules/fast-levenshtein/LICENSE.md
- `fast-uri@3.1.8` — License: BSD-3-Clause — Source: https://github.com/fastify/fast-uri — Text: node_modules/.pnpm/ajv@8.20.0/node_modules/fast-uri/LICENSE
- `fdir@6.5.0` — License: MIT — Source: https://github.com/thecodrr/fdir — Text: node_modules/.pnpm/fdir@6.5.0_picomatch@4.0.7/node_modules/fdir/LICENSE
- `file-entry-cache@8.0.0` — License: MIT — Source: jaredwray/file-entry-cache — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/file-entry-cache/LICENSE
- `finalhandler@2.1.1` — License: MIT — Source: pillarjs/finalhandler — Text: node_modules/.pnpm/express@5.2.1/node_modules/finalhandler/LICENSE
- `find-up@5.0.0` — License: MIT — Source: sindresorhus/find-up — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/find-up/LICENSE
- `flat-cache@4.0.1` — License: MIT — Source: jaredwray/flat-cache — Text: node_modules/.pnpm/file-entry-cache@8.0.0/node_modules/flat-cache/LICENSE
- `flatted@3.4.4` — License: ISC — Source: https://github.com/WebReflection/flatted — Text: node_modules/.pnpm/flat-cache@4.0.1/node_modules/flatted/LICENSE
★ - `fontkit@2.0.4` — License: MIT — Source: https://github.com/foliojs/fontkit — Text: (包内未随附独立文本文件)
- `forwarded@0.2.0` — License: MIT — Source: jshttp/forwarded — Text: node_modules/.pnpm/forwarded@0.2.0/node_modules/forwarded/LICENSE
- `fresh@2.0.0` — License: MIT — Source: jshttp/fresh — Text: node_modules/.pnpm/express@5.2.1/node_modules/fresh/LICENSE
- `fsevents@2.3.2` — License: MIT — Source: https://github.com/fsevents/fsevents — Text: node_modules/.pnpm/fsevents@2.3.2/node_modules/fsevents/LICENSE
- `fsevents@2.3.3` — License: MIT — Source: https://github.com/fsevents/fsevents — Text: node_modules/.pnpm/fsevents@2.3.3/node_modules/fsevents/LICENSE
- `function-bind@1.1.2` — License: MIT — Source: https://github.com/Raynos/function-bind — Text: node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/function-bind/LICENSE
- `gensync@1.0.0-beta.2` — License: MIT — Source: https://github.com/loganfsmyth/gensync — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/gensync/LICENSE
- `get-intrinsic@1.3.0` — License: MIT — Source: https://github.com/ljharb/get-intrinsic — Text: node_modules/.pnpm/call-bound@1.0.4/node_modules/get-intrinsic/LICENSE
- `get-proto@1.0.1` — License: MIT — Source: https://github.com/ljharb/get-proto — Text: node_modules/.pnpm/get-intrinsic@1.3.0/node_modules/get-proto/LICENSE
- `glob-parent@6.0.2` — License: ISC — Source: gulpjs/glob-parent — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/glob-parent/LICENSE
- `globals@14.0.0` — License: MIT — Source: sindresorhus/globals — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/globals/LICENSE
- `gopd@1.2.0` — License: MIT — Source: https://github.com/ljharb/gopd — Text: node_modules/.pnpm/dunder-proto@1.0.1/node_modules/gopd/LICENSE
- `has-flag@4.0.0` — License: MIT — Source: sindresorhus/has-flag — Text: node_modules/.pnpm/has-flag@4.0.0/node_modules/has-flag/LICENSE
- `has-symbols@1.1.0` — License: MIT — Source: https://github.com/inspect-js/has-symbols — Text: node_modules/.pnpm/get-intrinsic@1.3.0/node_modules/has-symbols/LICENSE
- `hasown@2.0.4` — License: MIT — Source: https://github.com/inspect-js/hasOwn — Text: node_modules/.pnpm/get-intrinsic@1.3.0/node_modules/hasown/LICENSE
- `hono@4.13.8` — License: MIT — Source: https://github.com/honojs/hono — Text: node_modules/.pnpm/@hono+node-server@2.1.1_hono@4.13.8/node_modules/hono/LICENSE
- `html-encoding-sniffer@4.0.0` — License: MIT — Source: jsdom/html-encoding-sniffer — Text: node_modules/.pnpm/html-encoding-sniffer@4.0.0/node_modules/html-encoding-sniffer/LICENSE.txt
- `http-errors@2.0.1` — License: MIT — Source: jshttp/http-errors — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/http-errors/LICENSE
- `http-proxy-agent@7.0.2` — License: MIT — Source: https://github.com/TooTallNate/proxy-agents — Text: node_modules/.pnpm/http-proxy-agent@7.0.2/node_modules/http-proxy-agent/LICENSE
- `https-proxy-agent@7.0.6` — License: MIT — Source: https://github.com/TooTallNate/proxy-agents — Text: node_modules/.pnpm/https-proxy-agent@7.0.6/node_modules/https-proxy-agent/LICENSE
- `iconv-lite@0.6.3` — License: MIT — Source: https://github.com/ashtuchkin/iconv-lite — Text: node_modules/.pnpm/iconv-lite@0.6.3/node_modules/iconv-lite/LICENSE
- `iconv-lite@0.7.3` — License: MIT — Source: https://github.com/pillarjs/iconv-lite — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/iconv-lite/LICENSE
- `ignore@5.3.2` — License: MIT — Source: git@github.com:kaelzhang/node-ignore — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/ignore/LICENSE-MIT
- `ignore@7.0.6` — License: MIT — Source: git@github.com:kaelzhang/node-ignore — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/ignore/LICENSE-MIT
- `import-fresh@3.3.1` — License: MIT — Source: sindresorhus/import-fresh — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/import-fresh/LICENSE
- `imurmurhash@0.1.4` — License: MIT — Source: https://github.com/jensyt/imurmurhash-js — Text: (包内未随附独立文本文件)
- `inherits@2.0.4` — License: ISC — Source: https://github.com/isaacs/inherits — Text: node_modules/.pnpm/http-errors@2.0.1/node_modules/inherits/LICENSE
- `ip-address@10.7.2` — License: MIT — Source: https://github.com/beaugunderson/ip-address — Text: node_modules/.pnpm/express-rate-limit@8.7.0_express@5.2.1/node_modules/ip-address/LICENSE
- `ipaddr.js@1.9.1` — License: MIT — Source: https://github.com/whitequark/ipaddr.js — Text: node_modules/.pnpm/ipaddr.js@1.9.1/node_modules/ipaddr.js/LICENSE
- `is-extglob@2.1.1` — License: MIT — Source: jonschlinkert/is-extglob — Text: node_modules/.pnpm/is-extglob@2.1.1/node_modules/is-extglob/LICENSE
- `is-glob@4.0.3` — License: MIT — Source: micromatch/is-glob — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/is-glob/LICENSE
- `is-potential-custom-element-name@1.0.1` — License: MIT — Source: https://github.com/mathiasbynens/is-potential-custom-element-name — Text: node_modules/.pnpm/is-potential-custom-element-name@1.0.1/node_modules/is-potential-custom-element-name/LICENSE-MIT.txt
- `is-promise@4.0.0` — License: MIT — Source: https://github.com/then/is-promise — Text: node_modules/.pnpm/is-promise@4.0.0/node_modules/is-promise/LICENSE
- `isexe@2.0.0` — License: ISC — Source: https://github.com/isaacs/isexe — Text: node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/LICENSE
- `jose@6.2.12` — License: MIT — Source: panva/jose — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/jose/LICENSE.md
- `js-tokens@4.0.0` — License: MIT — Source: lydell/js-tokens — Text: node_modules/.pnpm/@babel+code-frame@7.29.7/node_modules/js-tokens/LICENSE
- `js-yaml@4.3.1` — License: MIT — Source: nodeca/js-yaml — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/js-yaml/LICENSE
★ - `jsdom@26.1.0` — License: MIT — Source: https://github.com/jsdom/jsdom — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/jsdom/LICENSE.txt
- `jsesc@3.1.0` — License: MIT — Source: https://github.com/mathiasbynens/jsesc — Text: node_modules/.pnpm/@babel+generator@7.29.8/node_modules/jsesc/LICENSE-MIT.txt
- `json-buffer@3.0.1` — License: MIT — Source: https://github.com/dominictarr/json-buffer — Text: node_modules/.pnpm/json-buffer@3.0.1/node_modules/json-buffer/LICENSE
- `json-schema-traverse@0.4.1` — License: MIT — Source: https://github.com/epoberezkin/json-schema-traverse — Text: node_modules/.pnpm/ajv@6.15.0/node_modules/json-schema-traverse/LICENSE
- `json-schema-traverse@1.0.0` — License: MIT — Source: https://github.com/epoberezkin/json-schema-traverse — Text: node_modules/.pnpm/ajv@8.20.0/node_modules/json-schema-traverse/LICENSE
- `json-schema-typed@8.0.2` — License: BSD-2-Clause — Source: https://github.com/RemyRylan/json-schema-typed — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/json-schema-typed/LICENSE.md
- `json-stable-stringify-without-jsonify@1.0.1` — License: MIT — Source: https://github.com/samn/json-stable-stringify — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/json-stable-stringify-without-jsonify/LICENSE
- `json5@2.2.3` — License: MIT — Source: https://github.com/json5/json5 — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/json5/LICENSE.md
- `keyv@4.5.4` — License: MIT — Source: https://github.com/jaredwray/keyv — Text: (包内未随附独立文本文件)
- `levn@0.4.1` — License: MIT — Source: https://github.com/gkz/levn — Text: node_modules/.pnpm/@eslint+plugin-kit@0.4.1/node_modules/levn/LICENSE
- `locate-path@6.0.0` — License: MIT — Source: sindresorhus/locate-path — Text: node_modules/.pnpm/find-up@5.0.0/node_modules/locate-path/LICENSE
- `lodash.merge@4.6.2` — License: MIT — Source: lodash/lodash — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/lodash.merge/LICENSE
- `loupe@3.2.1` — License: MIT — Source: https://github.com/chaijs/loupe — Text: node_modules/.pnpm/@vitest+utils@2.1.9/node_modules/loupe/LICENSE
- `lru-cache@10.4.3` — License: ISC — Source: https://github.com/isaacs/node-lru-cache — Text: node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/lru-cache/LICENSE
- `lru-cache@5.1.1` — License: ISC — Source: https://github.com/isaacs/node-lru-cache — Text: node_modules/.pnpm/@babel+helper-compilation-targets@7.29.7/node_modules/lru-cache/LICENSE
- `lz-string@1.5.0` — License: MIT — Source: https://github.com/pieroxy/lz-string — Text: node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/lz-string/LICENSE
- `magic-string@0.30.21` — License: MIT — Source: https://github.com/Rich-Harris/magic-string — Text: node_modules/.pnpm/@vitest+mocker@2.1.9_vite@5.4.21_@types+node@24.13.3_terser@5.51.2_/node_modules/magic-string/LICENSE
- `math-intrinsics@1.1.0` — License: MIT — Source: https://github.com/es-shims/math-intrinsics — Text: node_modules/.pnpm/get-intrinsic@1.3.0/node_modules/math-intrinsics/LICENSE
- `media-typer@1.1.1` — License: MIT — Source: jshttp/media-typer — Text: node_modules/.pnpm/media-typer@1.1.1/node_modules/media-typer/LICENSE
- `merge-descriptors@2.0.0` — License: MIT — Source: sindresorhus/merge-descriptors — Text: node_modules/.pnpm/express@5.2.1/node_modules/merge-descriptors/LICENSE
- `mime-db@1.54.0` — License: MIT — Source: jshttp/mime-db — Text: node_modules/.pnpm/mime-db@1.54.0/node_modules/mime-db/LICENSE
- `mime-types@3.0.2` — License: MIT — Source: jshttp/mime-types — Text: node_modules/.pnpm/accepts@2.0.0/node_modules/mime-types/LICENSE
- `minimatch@10.2.6` — License: BlueOak-1.0.0 — Source: git@github.com:isaacs/minimatch — Text: node_modules/.pnpm/@typescript-eslint+typescript-estree@8.68.0_typescript@5.9.3/node_modules/minimatch/LICENSE.md
- `minimatch@3.1.5` — License: ISC — Source: https://github.com/isaacs/minimatch — Text: node_modules/.pnpm/@eslint+config-array@0.21.2/node_modules/minimatch/LICENSE
- `ms@2.1.3` — License: MIT — Source: vercel/ms — Text: node_modules/.pnpm/debug@4.4.3/node_modules/ms/LICENSE.md
- `nanoid@3.3.18` — License: MIT — Source: ai/nanoid — Text: node_modules/.pnpm/nanoid@3.3.18/node_modules/nanoid/LICENSE
- `natural-compare@1.4.0` — License: MIT — Source: https://github.com/litejs/natural-compare-lite — Text: (包内未随附独立文本文件)
- `negotiator@1.1.0` — License: MIT — Source: jshttp/negotiator — Text: node_modules/.pnpm/accepts@2.0.0/node_modules/negotiator/LICENSE
- `node-releases@2.0.53` — License: MIT — Source: https://github.com/chicoxyzzy/node-releases — Text: node_modules/.pnpm/browserslist@4.28.8/node_modules/node-releases/LICENSE
- `nwsapi@2.2.24` — License: MIT — Source: https://github.com/dperini/nwsapi — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/nwsapi/LICENSE
- `object-assign@4.1.1` — License: MIT — Source: sindresorhus/object-assign — Text: node_modules/.pnpm/cors@2.8.6/node_modules/object-assign/LICENSE
- `object-inspect@1.13.4` — License: MIT — Source: https://github.com/inspect-js/object-inspect — Text: node_modules/.pnpm/object-inspect@1.13.4/node_modules/object-inspect/LICENSE
- `on-finished@2.4.1` — License: MIT — Source: jshttp/on-finished — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/on-finished/LICENSE
- `once@1.4.0` — License: ISC — Source: https://github.com/isaacs/once — Text: node_modules/.pnpm/express@5.2.1/node_modules/once/LICENSE
- `optionator@0.9.4` — License: MIT — Source: https://github.com/gkz/optionator — Text: node_modules/.pnpm/eslint@9.39.5/node_modules/optionator/LICENSE
- `p-limit@3.1.0` — License: MIT — Source: sindresorhus/p-limit — Text: node_modules/.pnpm/p-limit@3.1.0/node_modules/p-limit/LICENSE
- `p-locate@5.0.0` — License: MIT — Source: sindresorhus/p-locate — Text: node_modules/.pnpm/locate-path@6.0.0/node_modules/p-locate/LICENSE
- `pako@0.2.9` — License: MIT — Source: nodeca/pako — Text: node_modules/.pnpm/pako@0.2.9/node_modules/pako/LICENSE
- `pako@1.0.11` — License: (MIT AND Zlib) — Source: nodeca/pako — Text: node_modules/.pnpm/@pdf-lib+fontkit@1.1.1/node_modules/pako/LICENSE
- `parent-module@1.0.1` — License: MIT — Source: sindresorhus/parent-module — Text: node_modules/.pnpm/import-fresh@3.3.1/node_modules/parent-module/LICENSE
- `parse5@7.3.0` — License: MIT — Source: https://github.com/inikulin/parse5 — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/parse5/LICENSE
- `parseurl@1.3.3` — License: MIT — Source: pillarjs/parseurl — Text: node_modules/.pnpm/express@5.2.1/node_modules/parseurl/LICENSE
- `path-exists@4.0.0` — License: MIT — Source: sindresorhus/path-exists — Text: node_modules/.pnpm/find-up@5.0.0/node_modules/path-exists/LICENSE
- `path-key@3.1.1` — License: MIT — Source: sindresorhus/path-key — Text: node_modules/.pnpm/cross-spawn@7.0.6/node_modules/path-key/LICENSE
- `path-to-regexp@8.4.2` — License: MIT — Source: https://github.com/pillarjs/path-to-regexp — Text: node_modules/.pnpm/path-to-regexp@8.4.2/node_modules/path-to-regexp/LICENSE
- `pathe@1.1.2` — License: MIT — Source: unjs/pathe — Text: node_modules/.pnpm/@vitest+runner@2.1.9/node_modules/pathe/LICENSE
- `pathval@2.0.1` — License: MIT — Source: https://github.com/chaijs/pathval — Text: node_modules/.pnpm/chai@5.3.3/node_modules/pathval/LICENSE
★ - `pdf-lib@1.17.1` — License: MIT — Source: https://github.com/Hopding/pdf-lib — Text: node_modules/.pnpm/pdf-lib@1.17.1/node_modules/pdf-lib/LICENSE.md
- `picocolors@1.1.1` — License: ISC — Source: alexeyraspopov/picocolors — Text: node_modules/.pnpm/@babel+code-frame@7.29.7/node_modules/picocolors/LICENSE
- `picomatch@4.0.7` — License: MIT — Source: micromatch/picomatch — Text: node_modules/.pnpm/fdir@6.5.0_picomatch@4.0.7/node_modules/picomatch/LICENSE
- `pkce-challenge@5.0.1` — License: MIT — Source: https://github.com/crouchcd/pkce-challenge — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/pkce-challenge/LICENSE
- `playwright-core@1.62.1` — License: Apache-2.0 — Source: https://github.com/microsoft/playwright — Text: node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/LICENSE
★ - `playwright@1.62.1` — License: Apache-2.0 — Source: https://github.com/microsoft/playwright — Text: node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/LICENSE
- `postcss@8.5.26` — License: MIT — Source: postcss/postcss — Text: node_modules/.pnpm/postcss@8.5.26/node_modules/postcss/LICENSE
- `prelude-ls@1.2.1` — License: MIT — Source: https://github.com/gkz/prelude-ls — Text: node_modules/.pnpm/levn@0.4.1/node_modules/prelude-ls/LICENSE
★ - `prettier@3.9.6` — License: MIT — Source: prettier/prettier — Text: node_modules/.pnpm/prettier@3.9.6/node_modules/prettier/LICENSE
- `pretty-format@27.5.1` — License: MIT — Source: https://github.com/facebook/jest — Text: node_modules/.pnpm/@testing-library+dom@10.4.1/node_modules/pretty-format/LICENSE
- `proxy-addr@2.0.8` — License: MIT — Source: jshttp/proxy-addr — Text: node_modules/.pnpm/express@5.2.1/node_modules/proxy-addr/LICENSE
- `punycode@2.3.1` — License: MIT — Source: https://github.com/mathiasbynens/punycode.js — Text: node_modules/.pnpm/punycode@2.3.1/node_modules/punycode/LICENSE-MIT.txt
- `qs@6.16.0` — License: BSD-3-Clause — Source: https://github.com/ljharb/qs — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/qs/LICENSE.md
- `range-parser@1.3.0` — License: MIT — Source: jshttp/range-parser — Text: node_modules/.pnpm/express@5.2.1/node_modules/range-parser/LICENSE
- `raw-body@3.0.2` — License: MIT — Source: stream-utils/raw-body — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/raw-body/LICENSE
★ - `react-dom@19.2.8` — License: MIT — Source: https://github.com/react/react — Text: node_modules/.pnpm/@testing-library+react@16.3.2_@testing-library+dom@10.4.1_@types+react-dom@19.2.5_@types+reac_vx6xrca6ouinon4cq6e6wplemy/node_modules/react-dom/LICENSE
- `react-is@17.0.2` — License: MIT — Source: https://github.com/facebook/react — Text: node_modules/.pnpm/pretty-format@27.5.1/node_modules/react-is/LICENSE
- `react-refresh@0.17.0` — License: MIT — Source: https://github.com/facebook/react — Text: node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.3_@types+node@24.13.3_terser@5.51.2_/node_modules/react-refresh/LICENSE
★ - `react@19.2.8` — License: MIT — Source: https://github.com/react/react — Text: node_modules/.pnpm/@testing-library+react@16.3.2_@testing-library+dom@10.4.1_@types+react-dom@19.2.5_@types+reac_vx6xrca6ouinon4cq6e6wplemy/node_modules/react/LICENSE
- `require-from-string@2.0.2` — License: MIT — Source: floatdrop/require-from-string — Text: node_modules/.pnpm/ajv@8.20.0/node_modules/require-from-string/LICENSE
- `resolve-from@4.0.0` — License: MIT — Source: sindresorhus/resolve-from — Text: node_modules/.pnpm/import-fresh@3.3.1/node_modules/resolve-from/LICENSE
- `restructure@3.0.2` — License: MIT — Source: https://github.com/devongovett/restructure — Text: node_modules/.pnpm/fontkit@2.0.4/node_modules/restructure/LICENSE
- `rollup@4.63.0` — License: MIT — Source: https://github.com/rollup/rollup — Text: node_modules/.pnpm/rollup@4.63.0/node_modules/rollup/LICENSE.md
- `router@2.2.0` — License: MIT — Source: pillarjs/router — Text: node_modules/.pnpm/express@5.2.1/node_modules/router/LICENSE
- `rrweb-cssom@0.8.0` — License: MIT — Source: rrweb-io/CSSOM — Text: node_modules/.pnpm/cssstyle@4.6.0/node_modules/rrweb-cssom/LICENSE.txt
- `safer-buffer@2.1.2` — License: MIT — Source: https://github.com/ChALkeR/safer-buffer — Text: node_modules/.pnpm/iconv-lite@0.6.3/node_modules/safer-buffer/LICENSE
- `saxes@6.0.0` — License: ISC — Source: https://github.com/lddubeau/saxes — Text: (包内未随附独立文本文件)
- `scheduler@0.27.0` — License: MIT — Source: https://github.com/facebook/react — Text: node_modules/.pnpm/react-dom@19.2.8_react@19.2.8/node_modules/scheduler/LICENSE
- `semver@6.3.1` — License: ISC — Source: https://github.com/npm/node-semver — Text: node_modules/.pnpm/@babel+core@7.29.7/node_modules/semver/LICENSE
- `semver@7.8.5` — License: ISC — Source: https://github.com/npm/node-semver — Text: node_modules/.pnpm/@typescript-eslint+typescript-estree@8.68.0_typescript@5.9.3/node_modules/semver/LICENSE
- `send@1.2.1` — License: MIT — Source: pillarjs/send — Text: node_modules/.pnpm/express@5.2.1/node_modules/send/LICENSE
- `serve-static@2.2.1` — License: MIT — Source: expressjs/serve-static — Text: node_modules/.pnpm/express@5.2.1/node_modules/serve-static/LICENSE
- `setprototypeof@1.2.0` — License: ISC — Source: https://github.com/wesleytodd/setprototypeof — Text: node_modules/.pnpm/http-errors@2.0.1/node_modules/setprototypeof/LICENSE
- `shebang-command@2.0.0` — License: MIT — Source: kevva/shebang-command — Text: node_modules/.pnpm/cross-spawn@7.0.6/node_modules/shebang-command/LICENSE
- `shebang-regex@3.0.0` — License: MIT — Source: sindresorhus/shebang-regex — Text: node_modules/.pnpm/shebang-command@2.0.0/node_modules/shebang-regex/LICENSE
- `side-channel-list@1.0.1` — License: MIT — Source: https://github.com/ljharb/side-channel-list — Text: node_modules/.pnpm/side-channel-list@1.0.1/node_modules/side-channel-list/LICENSE
- `side-channel-map@1.0.1` — License: MIT — Source: https://github.com/ljharb/side-channel-map — Text: node_modules/.pnpm/side-channel-map@1.0.1/node_modules/side-channel-map/LICENSE
- `side-channel-weakmap@1.0.2` — License: MIT — Source: https://github.com/ljharb/side-channel-weakmap — Text: node_modules/.pnpm/side-channel-weakmap@1.0.2/node_modules/side-channel-weakmap/LICENSE
- `side-channel@1.1.1` — License: MIT — Source: https://github.com/ljharb/side-channel — Text: node_modules/.pnpm/qs@6.16.0/node_modules/side-channel/LICENSE
- `siginfo@2.0.0` — License: ISC — Source: https://github.com/emilbayes/siginfo — Text: node_modules/.pnpm/siginfo@2.0.0/node_modules/siginfo/LICENSE
- `source-map-js@1.2.1` — License: BSD-3-Clause — Source: 7rulnik/source-map-js — Text: node_modules/.pnpm/postcss@8.5.26/node_modules/source-map-js/LICENSE
- `source-map-support@0.5.21` — License: MIT — Source: https://github.com/evanw/node-source-map-support — Text: node_modules/.pnpm/source-map-support@0.5.21/node_modules/source-map-support/LICENSE.md
- `source-map@0.6.1` — License: BSD-3-Clause — Source: http://github.com/mozilla/source-map — Text: node_modules/.pnpm/source-map-support@0.5.21/node_modules/source-map/LICENSE
- `stackback@0.0.2` — License: MIT — Source: https://github.com/shtylman/node-stackback — Text: (包内未随附独立文本文件)
- `statuses@2.0.2` — License: MIT — Source: jshttp/statuses — Text: node_modules/.pnpm/express@5.2.1/node_modules/statuses/LICENSE
- `std-env@3.10.0` — License: MIT — Source: unjs/std-env — Text: node_modules/.pnpm/std-env@3.10.0/node_modules/std-env/LICENCE
- `strip-json-comments@3.1.1` — License: MIT — Source: sindresorhus/strip-json-comments — Text: node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/strip-json-comments/LICENSE
- `supports-color@7.2.0` — License: MIT — Source: chalk/supports-color — Text: node_modules/.pnpm/chalk@4.1.2/node_modules/supports-color/LICENSE
- `symbol-tree@3.2.4` — License: MIT — Source: https://github.com/jsdom/js-symbol-tree — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/symbol-tree/LICENSE
★ - `terser@5.51.2` — License: BSD-2-Clause — Source: https://github.com/terser/terser — Text: node_modules/.pnpm/terser@5.51.2/node_modules/terser/LICENSE
- `tiny-inflate@1.0.3` — License: MIT — Source: https://github.com/devongovett/tiny-inflate — Text: node_modules/.pnpm/fontkit@2.0.4/node_modules/tiny-inflate/LICENSE
- `tinybench@2.9.0` — License: MIT — Source: tinylibs/tinybench — Text: node_modules/.pnpm/tinybench@2.9.0/node_modules/tinybench/LICENSE
- `tinyexec@0.3.2` — License: MIT — Source: https://github.com/tinylibs/tinyexec — Text: node_modules/.pnpm/tinyexec@0.3.2/node_modules/tinyexec/LICENSE
- `tinyglobby@0.2.17` — License: MIT — Source: https://github.com/SuperchupuDev/tinyglobby — Text: node_modules/.pnpm/@typescript-eslint+typescript-estree@8.68.0_typescript@5.9.3/node_modules/tinyglobby/LICENSE
- `tinypool@1.1.1` — License: MIT — Source: https://github.com/tinylibs/tinypool — Text: node_modules/.pnpm/tinypool@1.1.1/node_modules/tinypool/LICENSE
- `tinyrainbow@1.2.0` — License: MIT — Source: https://github.com/tinylibs/tinyrainbow — Text: node_modules/.pnpm/@vitest+expect@2.1.9/node_modules/tinyrainbow/LICENCE
- `tinyspy@3.0.2` — License: MIT — Source: https://github.com/tinylibs/tinyspy — Text: node_modules/.pnpm/@vitest+spy@2.1.9/node_modules/tinyspy/LICENCE
- `tldts-core@6.1.86` — License: MIT — Source: https://github.com/remusao/tldts — Text: node_modules/.pnpm/tldts-core@6.1.86/node_modules/tldts-core/LICENSE
- `tldts@6.1.86` — License: MIT — Source: https://github.com/remusao/tldts — Text: node_modules/.pnpm/tldts@6.1.86/node_modules/tldts/LICENSE
- `toidentifier@1.0.1` — License: MIT — Source: component/toidentifier — Text: node_modules/.pnpm/http-errors@2.0.1/node_modules/toidentifier/LICENSE
- `tough-cookie@5.1.2` — License: BSD-3-Clause — Source: https://github.com/salesforce/tough-cookie — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/tough-cookie/LICENSE
- `tr46@5.1.1` — License: MIT — Source: https://github.com/jsdom/tr46 — Text: node_modules/.pnpm/tr46@5.1.1/node_modules/tr46/LICENSE.md
- `ts-api-utils@2.5.0` — License: MIT — Source: https://github.com/JoshuaKGoldberg/ts-api-utils — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/ts-api-utils/LICENSE.md
- `tslib@1.14.1` — License: 0BSD — Source: https://github.com/Microsoft/tslib — Text: node_modules/.pnpm/pdf-lib@1.17.1/node_modules/tslib/LICENSE.txt
- `tslib@2.8.1` — License: 0BSD — Source: https://github.com/Microsoft/tslib — Text: node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/tslib/LICENSE.txt
- `tsx@4.23.13` — License: MIT — Source: privatenumber/tsx — Text: node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/LICENSE
- `type-check@0.4.0` — License: MIT — Source: https://github.com/gkz/type-check — Text: node_modules/.pnpm/levn@0.4.1/node_modules/type-check/LICENSE
- `type-is@2.1.0` — License: MIT — Source: jshttp/type-is — Text: node_modules/.pnpm/body-parser@2.3.0/node_modules/type-is/LICENSE
★ - `typescript-eslint@8.68.0` — License: MIT — Source: https://github.com/typescript-eslint/typescript-eslint — Text: node_modules/.pnpm/typescript-eslint@8.68.0_eslint@9.39.5_typescript@5.9.3/node_modules/typescript-eslint/LICENSE
★ - `typescript@5.9.3` — License: Apache-2.0 — Source: https://github.com/microsoft/TypeScript — Text: node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.68.0_@typescript-eslint+parser@8.68.0_eslint@9.39.5_typesc_xrzdpqnaxc7i73xaavdcoxmsay/node_modules/typescript/LICENSE.txt
- `undici-types@7.18.2` — License: MIT — Source: https://github.com/nodejs/undici — Text: node_modules/.pnpm/@types+node@24.13.3/node_modules/undici-types/LICENSE
- `unicode-properties@1.4.1` — License: MIT — Source: https://github.com/devongovett/unicode-properties — Text: node_modules/.pnpm/fontkit@2.0.4/node_modules/unicode-properties/LICENSE
- `unicode-trie@2.0.0` — License: MIT — Source: https://github.com/devongovett/unicode-trie — Text: node_modules/.pnpm/fontkit@2.0.4/node_modules/unicode-trie/LICENSE
- `unpipe@1.0.0` — License: MIT — Source: stream-utils/unpipe — Text: node_modules/.pnpm/raw-body@3.0.2/node_modules/unpipe/LICENSE
- `update-browserslist-db@1.3.1` — License: MIT — Source: browserslist/update-db — Text: node_modules/.pnpm/browserslist@4.28.8/node_modules/update-browserslist-db/LICENSE
- `uri-js@4.4.1` — License: BSD-2-Clause — Source: http://github.com/garycourt/uri-js — Text: node_modules/.pnpm/ajv@6.15.0/node_modules/uri-js/LICENSE
- `use-sync-external-store@1.6.0` — License: MIT — Source: https://github.com/facebook/react — Text: node_modules/.pnpm/use-sync-external-store@1.6.0_react@19.2.8/node_modules/use-sync-external-store/LICENSE
- `vary@1.1.2` — License: MIT — Source: jshttp/vary — Text: node_modules/.pnpm/cors@2.8.6/node_modules/vary/LICENSE
- `vite-node@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/vite-node@2.1.9_@types+node@24.13.3_terser@5.51.2/node_modules/vite-node/LICENSE
★ - `vite@5.4.21` — License: MIT — Source: https://github.com/vitejs/vite — Text: node_modules/.pnpm/@vitest+mocker@2.1.9_vite@5.4.21_@types+node@24.13.3_terser@5.51.2_/node_modules/vite/LICENSE.md
★ - `vite@6.4.3` — License: MIT — Source: https://github.com/vitejs/vite — Text: node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.3_@types+node@24.13.3_terser@5.51.2_/node_modules/vite/LICENSE.md
★ - `vitest@2.1.9` — License: MIT — Source: https://github.com/vitest-dev/vitest — Text: node_modules/.pnpm/vitest@2.1.9_@types+node@24.13.3_jsdom@26.1.0_terser@5.51.2/node_modules/vitest/LICENSE.md
- `w3c-xmlserializer@5.0.0` — License: MIT — Source: jsdom/w3c-xmlserializer — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/w3c-xmlserializer/LICENSE.md
- `webidl-conversions@7.0.0` — License: BSD-2-Clause — Source: jsdom/webidl-conversions — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/webidl-conversions/LICENSE.md
- `whatwg-encoding@3.1.1` — License: MIT — Source: jsdom/whatwg-encoding — Text: node_modules/.pnpm/html-encoding-sniffer@4.0.0/node_modules/whatwg-encoding/LICENSE.txt
- `whatwg-mimetype@4.0.0` — License: MIT — Source: jsdom/whatwg-mimetype — Text: node_modules/.pnpm/data-urls@5.0.0/node_modules/whatwg-mimetype/LICENSE.txt
- `whatwg-url@14.2.0` — License: MIT — Source: jsdom/whatwg-url — Text: node_modules/.pnpm/data-urls@5.0.0/node_modules/whatwg-url/LICENSE.txt
- `which@2.0.2` — License: ISC — Source: https://github.com/isaacs/node-which — Text: node_modules/.pnpm/cross-spawn@7.0.6/node_modules/which/LICENSE
- `why-is-node-running@2.3.0` — License: MIT — Source: https://github.com/mafintosh/why-is-node-running — Text: node_modules/.pnpm/vitest@2.1.9_@types+node@24.13.3_jsdom@26.1.0_terser@5.51.2/node_modules/why-is-node-running/LICENSE
- `word-wrap@1.2.5` — License: MIT — Source: jonschlinkert/word-wrap — Text: node_modules/.pnpm/optionator@0.9.4/node_modules/word-wrap/LICENSE
- `wrappy@1.0.2` — License: ISC — Source: https://github.com/npm/wrappy — Text: node_modules/.pnpm/once@1.4.0/node_modules/wrappy/LICENSE
- `ws@8.21.3` — License: MIT — Source: https://github.com/websockets/ws — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/ws/LICENSE
- `xml-name-validator@5.0.0` — License: Apache-2.0 — Source: jsdom/xml-name-validator — Text: node_modules/.pnpm/jsdom@26.1.0/node_modules/xml-name-validator/LICENSE.txt
- `xmlchars@2.2.0` — License: MIT — Source: https://github.com/lddubeau/xmlchars — Text: node_modules/.pnpm/saxes@6.0.0/node_modules/xmlchars/LICENSE
- `yallist@3.1.1` — License: ISC — Source: https://github.com/isaacs/yallist — Text: node_modules/.pnpm/lru-cache@5.1.1/node_modules/yallist/LICENSE
- `yocto-queue@0.1.0` — License: MIT — Source: sindresorhus/yocto-queue — Text: node_modules/.pnpm/p-limit@3.1.0/node_modules/yocto-queue/LICENSE
- `zod-to-json-schema@3.25.2` — License: ISC — Source: https://github.com/StefanTerdell/zod-to-json-schema — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/zod-to-json-schema/LICENSE
- `zod@3.25.76` — License: MIT — Source: https://github.com/colinhacks/zod — Text: node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/node_modules/zod/LICENSE
- `zustand@4.5.7` — License: MIT — Source: https://github.com/pmndrs/zustand — Text: node_modules/.pnpm/@xyflow+react@12.11.5_@types+react-dom@19.2.5_@types+react@19.2.18__@types+react@19.2.18_reac_xn5bnmkngsnhtzfbdvhw7ezyyy/node_modules/zustand/LICENSE

## Cargo packages

- `adler2@2.0.1` — License: 0BSD OR MIT OR Apache-2.0 — Source: https://github.com/oyvindln/adler2 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/adler2-2.0.1/LICENSE-MIT
- `aho-corasick@1.1.5` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/aho-corasick — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aho-corasick-1.1.5/COPYING
- `alloc-no-stdlib@2.0.4` — License: BSD-3-Clause — Source: https://github.com/dropbox/rust-alloc-no-stdlib — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/alloc-no-stdlib-2.0.4/LICENSE
- `alloc-stdlib@0.2.4` — License: BSD-3-Clause — Source: https://github.com/dropbox/rust-alloc-no-stdlib — Text: (包内未随附独立文本文件)
- `android_system_properties@0.1.6` — License: MIT OR Apache-2.0 — Source: https://github.com/nical/android_system_properties — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/android_system_properties-0.1.6/LICENSE-MIT
- `anyhow@1.0.104` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/anyhow — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/anyhow-1.0.104/LICENSE-MIT
- `async-broadcast@0.7.2` — License: MIT OR Apache-2.0 — Source: https://github.com/smol-rs/async-broadcast — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-broadcast-0.7.2/LICENSE-MIT
- `async-channel@2.5.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-channel — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-channel-2.5.0/LICENSE-MIT
- `async-executor@1.14.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-executor — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-executor-1.14.0/LICENSE-MIT
- `async-io@2.6.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-io — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-io-2.6.0/LICENSE-MIT
- `async-lock@3.4.2` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-lock — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-lock-3.4.2/LICENSE-MIT
- `async-process@2.5.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-process — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-process-2.5.0/LICENSE-MIT
- `async-recursion@1.1.1` — License: MIT OR Apache-2.0 — Source: https://github.com/dcchut/async-recursion — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-recursion-1.1.1/LICENSE-MIT
- `async-signal@0.2.14` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-signal — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-signal-0.2.14/LICENSE-MIT
- `async-task@4.7.1` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/async-task — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-task-4.7.1/LICENSE-MIT
- `async-trait@0.1.92` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/async-trait — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/async-trait-0.1.92/LICENSE-MIT
- `atk-sys@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/atk-sys-0.18.2/LICENSE
- `atk@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/atk-0.18.2/LICENSE
- `atomic-waker@1.1.2` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/atomic-waker — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/atomic-waker-1.1.2/LICENSE-MIT
- `autocfg@1.5.1` — License: Apache-2.0 OR MIT — Source: https://github.com/cuviper/autocfg — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/autocfg-1.5.1/LICENSE-MIT
- `base64@0.21.7` — License: MIT OR Apache-2.0 — Source: https://github.com/marshallpierce/rust-base64 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base64-0.21.7/LICENSE-MIT
- `base64@0.22.1` — License: MIT OR Apache-2.0 — Source: https://github.com/marshallpierce/rust-base64 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/base64-0.22.1/LICENSE-MIT
- `bit-set@0.8.0` — License: Apache-2.0 OR MIT — Source: https://github.com/contain-rs/bit-set — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bit-set-0.8.0/LICENSE-MIT
- `bit-vec@0.8.0` — License: Apache-2.0 OR MIT — Source: https://github.com/contain-rs/bit-vec — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bit-vec-0.8.0/LICENSE-MIT
- `bitflags@1.3.2` — License: MIT/Apache-2.0 — Source: https://github.com/bitflags/bitflags — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bitflags-1.3.2/LICENSE-MIT
- `bitflags@2.13.1` — License: MIT OR Apache-2.0 — Source: https://github.com/bitflags/bitflags — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bitflags-2.13.1/LICENSE-MIT
- `block-buffer@0.10.4` — License: MIT OR Apache-2.0 — Source: https://github.com/RustCrypto/utils — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/block-buffer-0.10.4/LICENSE-MIT
- `block2@0.6.2` — License: MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `blocking@1.7.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/blocking — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/blocking-1.7.0/LICENSE-MIT
- `brotli-decompressor@5.0.3` — License: BSD-3-Clause/MIT — Source: https://github.com/dropbox/rust-brotli-decompressor — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/brotli-decompressor-5.0.3/LICENSE
- `brotli@8.0.4` — License: BSD-3-Clause AND MIT — Source: https://github.com/dropbox/rust-brotli — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/brotli-8.0.4/LICENSE.BSD-3-Clause
- `bs58@0.5.1` — License: MIT/Apache-2.0 — Source: https://github.com/Nullus157/bs58-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bs58-0.5.1/LICENSE-MIT
- `bumpalo@3.20.3` — License: MIT OR Apache-2.0 — Source: https://github.com/fitzgen/bumpalo — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bumpalo-3.20.3/LICENSE-MIT
- `bytemuck@1.25.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/Lokathor/bytemuck — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bytemuck-1.25.2/LICENSE-MIT
- `byteorder@1.5.0` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/byteorder — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/byteorder-1.5.0/COPYING
- `bytes@1.12.1` — License: MIT — Source: https://github.com/tokio-rs/bytes — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/bytes-1.12.1/LICENSE
- `cairo-rs@0.18.5` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cairo-rs-0.18.5/LICENSE
- `cairo-sys-rs@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cairo-sys-rs-0.18.2/LICENSE
- `camino@1.2.5` — License: MIT OR Apache-2.0 — Source: https://github.com/camino-rs/camino — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/camino-1.2.5/LICENSE-MIT
- `cargo_metadata@0.19.2` — License: MIT — Source: https://github.com/oli-obk/cargo_metadata — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo_metadata-0.19.2/LICENSE-MIT
- `cargo_toml@0.22.3` — License: Apache-2.0 OR MIT — Source: https://gitlab.com/lib.rs/cargo_toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo_toml-0.22.3/LICENSE
- `cargo-platform@0.1.9` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/cargo — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cargo-platform-0.1.9/LICENSE-MIT
- `cc@1.4.4` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/cc-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cc-1.4.4/LICENSE-MIT
- `cesu8@1.1.0` — License: Apache-2.0/MIT — Source: https://github.com/emk/cesu8-rs — Text: (包内未随附独立文本文件)
- `cfb@0.7.3` — License: MIT — Source: https://github.com/mdsteele/rust-cfb — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cfb-0.7.3/LICENSE
- `cfg-expr@0.15.8` — License: MIT OR Apache-2.0 — Source: https://github.com/EmbarkStudios/cfg-expr — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cfg-expr-0.15.8/LICENSE-MIT
- `cfg-if@1.0.4` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/cfg-if — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cfg-if-1.0.4/LICENSE-MIT
- `chrono@0.4.45` — License: MIT OR Apache-2.0 — Source: https://github.com/chronotope/chrono — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/chrono-0.4.45/LICENSE.txt
- `combine@4.6.8` — License: MIT — Source: https://github.com/Marwes/combine — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/combine-4.6.8/LICENSE
- `concurrent-queue@2.5.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/concurrent-queue — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/concurrent-queue-2.5.0/LICENSE-MIT
- `cookie@0.18.2` — License: MIT OR Apache-2.0 — Source: https://github.com/SergioBenitez/cookie-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cookie-0.18.2/LICENSE-MIT
- `core-foundation-sys@0.8.7` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/core-foundation-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-foundation-sys-0.8.7/LICENSE-MIT
- `core-foundation@0.10.1` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/core-foundation-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-foundation-0.10.1/LICENSE-MIT
- `core-graphics-types@0.2.0` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/core-foundation-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-graphics-types-0.2.0/LICENSE-MIT
- `core-graphics@0.25.0` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/core-foundation-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/core-graphics-0.25.0/LICENSE-MIT
- `cpufeatures@0.2.17` — License: MIT OR Apache-2.0 — Source: https://github.com/RustCrypto/utils — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cpufeatures-0.2.17/LICENSE-MIT
- `crc32fast@1.5.1` — License: MIT OR Apache-2.0 — Source: https://github.com/srijs/rust-crc32fast — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crc32fast-1.5.1/LICENSE-MIT
- `crossbeam-channel@0.5.16` — License: MIT OR Apache-2.0 — Source: https://github.com/crossbeam-rs/crossbeam — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbeam-channel-0.5.16/LICENSE-MIT
- `crossbeam-utils@0.8.22` — License: MIT OR Apache-2.0 — Source: https://github.com/crossbeam-rs/crossbeam — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crossbeam-utils-0.8.22/LICENSE-MIT
- `crypto-common@0.1.7` — License: MIT OR Apache-2.0 — Source: https://github.com/RustCrypto/traits — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/crypto-common-0.1.7/LICENSE-MIT
- `cssparser-macros@0.6.1` — License: MPL-2.0 — Source: https://github.com/servo/rust-cssparser — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cssparser-macros-0.6.1/LICENSE
- `cssparser@0.36.0` — License: MPL-2.0 — Source: https://github.com/servo/rust-cssparser — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/cssparser-0.36.0/LICENSE
- `ctor-proc-macro@0.0.7` — License: Apache-2.0 OR MIT — Source: https://github.com/mmastrac/rust-ctor — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ctor-proc-macro-0.0.7/LICENSE-MIT
- `ctor@0.8.0` — License: Apache-2.0 OR MIT — Source: https://github.com/mmastrac/rust-ctor — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ctor-0.8.0/LICENSE-MIT
- `darling_core@0.23.0` — License: MIT — Source: https://github.com/TedDriggs/darling — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling_core-0.23.0/LICENSE
- `darling_macro@0.23.0` — License: MIT — Source: https://github.com/TedDriggs/darling — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling_macro-0.23.0/LICENSE
- `darling@0.23.0` — License: MIT — Source: https://github.com/TedDriggs/darling — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/darling-0.23.0/LICENSE
- `dbus@0.9.12` — License: Apache-2.0/MIT — Source: https://github.com/diwic/dbus-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dbus-0.9.12/LICENSE-MIT
- `defmt-macros@1.1.1` — License: MIT OR Apache-2.0 — Source: https://github.com/knurling-rs/defmt — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/defmt-macros-1.1.1/LICENSE-MIT
- `defmt-parser@1.0.0` — License: MIT OR Apache-2.0 — Source: https://github.com/knurling-rs/defmt — Text: (包内未随附独立文本文件)
- `defmt@1.1.1` — License: MIT OR Apache-2.0 — Source: https://github.com/knurling-rs/defmt — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/defmt-1.1.1/LICENSE-MIT
- `deranged@0.5.8` — License: MIT OR Apache-2.0 — Source: https://github.com/jhpratt/deranged — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/deranged-0.5.8/LICENSE-MIT
- `derive_more-impl@2.1.1` — License: MIT — Source: https://github.com/JelteF/derive_more — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/derive_more-impl-2.1.1/LICENSE
- `derive_more@2.1.1` — License: MIT — Source: https://github.com/JelteF/derive_more — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/derive_more-2.1.1/LICENSE
- `digest@0.10.7` — License: MIT OR Apache-2.0 — Source: https://github.com/RustCrypto/traits — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/digest-0.10.7/LICENSE-MIT
- `dirs-sys@0.5.0` — License: MIT OR Apache-2.0 — Source: https://github.com/dirs-dev/dirs-sys-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dirs-sys-0.5.0/LICENSE-MIT
- `dirs@6.0.0` — License: MIT OR Apache-2.0 — Source: https://github.com/soc/dirs-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dirs-6.0.0/LICENSE-MIT
- `dispatch2@0.3.1` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `displaydoc@0.2.7` — License: MIT OR Apache-2.0 — Source: https://github.com/yaahc/displaydoc — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/displaydoc-0.2.7/LICENSE-MIT
- `dlopen2_derive@0.4.3` — License: MIT — Source: https://github.com/OpenByteDev/dlopen2 — Text: (包内未随附独立文本文件)
- `dlopen2@0.8.2` — License: MIT — Source: https://github.com/OpenByteDev/dlopen2 — Text: (包内未随附独立文本文件)
- `dom_query@0.27.0` — License: MIT — Source: https://github.com/niklak/dom_query — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dom_query-0.27.0/LICENSE
- `dpi@0.1.2` — License: Apache-2.0 AND MIT — Source: https://github.com/rust-windowing/winit — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dpi-0.1.2/LICENSE
- `dtoa-short@0.3.5` — License: MPL-2.0 — Source: https://github.com/upsuper/dtoa-short — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dtoa-short-0.3.5/LICENSE
- `dtoa@1.0.11` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/dtoa — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dtoa-1.0.11/LICENSE-MIT
- `dtor-proc-macro@0.0.6` — License: Apache-2.0 OR MIT — Source: https://github.com/mmastrac/rust-ctor — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dtor-proc-macro-0.0.6/LICENSE-MIT
- `dtor@0.3.0` — License: Apache-2.0 OR MIT — Source: https://github.com/mmastrac/rust-ctor — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dtor-0.3.0/LICENSE-MIT
- `dunce@1.0.5` — License: CC0-1.0 OR MIT-0 OR Apache-2.0 — Source: https://gitlab.com/kornelski/dunce — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dunce-1.0.5/LICENSE
- `dyn-clone@1.0.20` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/dyn-clone — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dyn-clone-1.0.20/LICENSE-MIT
- `embed_plist@1.2.2` — License: MIT OR Apache-2.0 — Source: https://github.com/nvzqz/embed-plist-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/embed_plist-1.2.2/LICENSE-MIT
- `embed-resource@3.0.11` — License: MIT — Source: https://github.com/nabijaczleweli/rust-embed-resource — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/embed-resource-3.0.11/LICENSE
- `endi@1.1.1` — License: MIT — Source: https://github.com/zeenix/endi — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/endi-1.1.1/LICENSE-MIT
- `enumflags2_derive@0.7.12` — License: MIT OR Apache-2.0 — Source: https://github.com/meithecatte/enumflags2 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/enumflags2_derive-0.7.12/LICENSE-MIT
- `enumflags2@0.7.12` — License: MIT OR Apache-2.0 — Source: https://github.com/meithecatte/enumflags2 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/enumflags2-0.7.12/LICENSE-MIT
- `equivalent@1.0.2` — License: Apache-2.0 OR MIT — Source: https://github.com/indexmap-rs/equivalent — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/equivalent-1.0.2/LICENSE-MIT
- `erased-serde@0.4.10` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/erased-serde — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/erased-serde-0.4.10/LICENSE-MIT
- `errno@0.3.14` — License: MIT OR Apache-2.0 — Source: https://github.com/lambda-fairy/rust-errno — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/errno-0.3.14/LICENSE-MIT
- `event-listener-strategy@0.5.4` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/event-listener-strategy — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/event-listener-strategy-0.5.4/LICENSE-MIT
- `event-listener@5.4.2` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/event-listener — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/event-listener-5.4.2/LICENSE-MIT
- `fastrand@2.5.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/fastrand — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fastrand-2.5.0/LICENSE-MIT
- `fdeflate@0.3.7` — License: MIT OR Apache-2.0 — Source: https://github.com/image-rs/fdeflate — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fdeflate-0.3.7/LICENSE-MIT
- `field-offset@0.3.6` — License: MIT OR Apache-2.0 — Source: https://github.com/Diggsey/rust-field-offset — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/field-offset-0.3.6/LICENSE-MIT
- `find-msvc-tools@0.1.11` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/cc-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/find-msvc-tools-0.1.11/LICENSE-MIT
- `flate2@1.1.9` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/flate2-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/flate2-1.1.9/LICENSE-MIT
- `fnv@1.0.7` — License: Apache-2.0 / MIT — Source: https://github.com/servo/rust-fnv — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fnv-1.0.7/LICENSE-MIT
- `foldhash@0.2.0` — License: Zlib — Source: https://github.com/orlp/foldhash — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/foldhash-0.2.0/LICENSE
- `foreign-types-macros@0.2.4` — License: MIT/Apache-2.0 — Source: https://github.com/sfackler/foreign-types — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/foreign-types-macros-0.2.4/LICENSE-MIT
- `foreign-types-shared@0.3.1` — License: MIT/Apache-2.0 — Source: https://github.com/sfackler/foreign-types — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/foreign-types-shared-0.3.1/LICENSE-MIT
- `foreign-types@0.5.0` — License: MIT/Apache-2.0 — Source: https://github.com/sfackler/foreign-types — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/foreign-types-0.5.0/LICENSE-MIT
- `form_urlencoded@1.2.2` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/rust-url — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/form_urlencoded-1.2.2/LICENSE-MIT
- `futures-channel@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-channel-0.3.34/LICENSE-MIT
- `futures-core@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-core-0.3.34/LICENSE-MIT
- `futures-executor@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-executor-0.3.34/LICENSE-MIT
- `futures-io@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-io-0.3.34/LICENSE-MIT
- `futures-lite@2.6.1` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/futures-lite — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-lite-2.6.1/LICENSE-MIT
- `futures-macro@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-macro-0.3.34/LICENSE-MIT
- `futures-sink@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-sink-0.3.34/LICENSE-MIT
- `futures-task@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-task-0.3.34/LICENSE-MIT
- `futures-util@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/futures-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-util-0.3.34/LICENSE-MIT
- `gdk-pixbuf-sys@0.18.0` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdk-pixbuf-sys-0.18.0/LICENSE
- `gdk-pixbuf@0.18.5` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdk-pixbuf-0.18.5/LICENSE
- `gdk-sys@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdk-sys-0.18.2/LICENSE
- `gdk@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdk-0.18.2/LICENSE
- `gdkwayland-sys@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdkwayland-sys-0.18.2/LICENSE
- `gdkx11-sys@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdkx11-sys-0.18.2/LICENSE
- `gdkx11@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gdkx11-0.18.2/LICENSE
- `generic-array@0.14.7` — License: MIT — Source: https://github.com/fizyk20/generic-array.git — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/generic-array-0.14.7/LICENSE
- `gethostname@1.1.0` — License: Apache-2.0 — Source: https://codeberg.org/swsnr/gethostname.rs.git — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gethostname-1.1.0/LICENSE
- `getrandom@0.2.17` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-random/getrandom — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrandom-0.2.17/LICENSE-MIT
- `getrandom@0.3.4` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-random/getrandom — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrandom-0.3.4/LICENSE-MIT
- `getrandom@0.4.3` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-random/getrandom — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/getrandom-0.4.3/LICENSE-MIT
- `gio-sys@0.18.1` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gio-sys-0.18.1/LICENSE
- `gio@0.18.4` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gio-0.18.4/LICENSE
- `glib-macros@0.18.5` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/glib-macros-0.18.5/LICENSE
- `glib-sys@0.18.1` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/glib-sys-0.18.1/LICENSE
- `glib@0.18.5` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/glib-0.18.5/LICENSE
- `glob@0.3.4` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/glob — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/glob-0.3.4/LICENSE-MIT
- `global-hotkey@0.8.0` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/global-hotkey — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/global-hotkey-0.8.0/LICENSE-MIT
- `gobject-sys@0.18.0` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gobject-sys-0.18.0/LICENSE
- `gtk-sys@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gtk-sys-0.18.2/LICENSE
- `gtk@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gtk-0.18.2/LICENSE
- `gtk3-macros@0.18.2` — License: MIT — Source: https://github.com/gtk-rs/gtk3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/gtk3-macros-0.18.2/LICENSE
- `hashbrown@0.12.3` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/hashbrown — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.12.3/LICENSE-MIT
- `hashbrown@0.17.1` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/hashbrown — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hashbrown-0.17.1/LICENSE-MIT
- `heck@0.4.1` — License: MIT OR Apache-2.0 — Source: https://github.com/withoutboats/heck — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/heck-0.4.1/LICENSE-MIT
- `heck@0.5.0` — License: MIT OR Apache-2.0 — Source: https://github.com/withoutboats/heck — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/heck-0.5.0/LICENSE-MIT
- `hermit-abi@0.5.2` — License: MIT OR Apache-2.0 — Source: https://github.com/hermit-os/hermit-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hermit-abi-0.5.2/LICENSE-MIT
- `hex@0.4.3` — License: MIT OR Apache-2.0 — Source: https://github.com/KokaKiwi/rust-hex — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hex-0.4.3/LICENSE-MIT
- `html5ever@0.38.0` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/html5ever — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/html5ever-0.38.0/LICENSE-MIT
- `http-body-util@0.1.5` — License: MIT — Source: https://github.com/hyperium/http-body — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/http-body-util-0.1.5/LICENSE
- `http-body@1.1.0` — License: MIT — Source: https://github.com/hyperium/http-body — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/http-body-1.1.0/LICENSE
- `http@1.5.0` — License: MIT OR Apache-2.0 — Source: https://github.com/hyperium/http — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/http-1.5.0/LICENSE-MIT
- `httparse@1.10.1` — License: MIT OR Apache-2.0 — Source: https://github.com/seanmonstar/httparse — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/httparse-1.10.1/LICENSE-MIT
- `hyper-util@0.1.20` — License: MIT — Source: https://github.com/hyperium/hyper-util — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hyper-util-0.1.20/LICENSE
- `hyper@1.11.0` — License: MIT — Source: https://github.com/hyperium/hyper — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/hyper-1.11.0/LICENSE
- `iana-time-zone-haiku@0.1.2` — License: MIT OR Apache-2.0 — Source: https://github.com/strawlab/iana-time-zone — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/iana-time-zone-haiku-0.1.2/LICENSE-MIT
- `iana-time-zone@0.1.65` — License: MIT OR Apache-2.0 — Source: https://github.com/strawlab/iana-time-zone — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/iana-time-zone-0.1.65/LICENSE-MIT
- `ico@0.5.0` — License: MIT — Source: https://github.com/mdsteele/rust-ico — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ico-0.5.0/LICENSE
- `icu_collections@2.3.0` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_collections-2.3.0/LICENSE
- `icu_locale_core@2.3.0` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_locale_core-2.3.0/LICENSE
- `icu_normalizer_data@2.3.0` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_normalizer_data-2.3.0/LICENSE
- `icu_normalizer@2.3.0` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_normalizer-2.3.0/LICENSE
- `icu_properties_data@2.3.0` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_properties_data-2.3.0/LICENSE
- `icu_properties@2.3.0` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_properties-2.3.0/LICENSE
- `icu_provider@2.3.1` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_provider-2.3.1/LICENSE
- `ident_case@1.0.1` — License: MIT/Apache-2.0 — Source: https://github.com/TedDriggs/ident_case — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ident_case-1.0.1/LICENSE
- `idna_adapter@1.2.2` — License: Apache-2.0 OR MIT — Source: https://github.com/hsivonen/idna_adapter — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/idna_adapter-1.2.2/LICENSE-MIT
- `idna@1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/rust-url/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/idna-1.1.0/LICENSE-MIT
- `indexmap@1.9.3` — License: Apache-2.0 OR MIT — Source: https://github.com/bluss/indexmap — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexmap-1.9.3/LICENSE-MIT
- `indexmap@2.14.0` — License: Apache-2.0 OR MIT — Source: https://github.com/indexmap-rs/indexmap — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/indexmap-2.14.0/LICENSE-MIT
- `infer@0.19.0` — License: MIT — Source: https://github.com/bojand/infer — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/infer-0.19.0/LICENSE
- `ipnet@2.12.1` — License: MIT OR Apache-2.0 — Source: https://github.com/krisprice/ipnet — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ipnet-2.12.1/LICENSE-MIT
- `itoa@1.0.18` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/itoa — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/itoa-1.0.18/LICENSE-MIT
- `javascriptcore-rs-sys@1.1.1` — License: MIT — Source: https://github.com/tauri-apps/javascriptcore-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/javascriptcore-rs-sys-1.1.1/LICENSE
- `javascriptcore-rs@1.1.2` — License: MIT — Source: https://github.com/tauri-apps/javascriptcore-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/javascriptcore-rs-1.1.2/LICENSE
- `jiff-core@0.1.0` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/jiff — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jiff-core-0.1.0/COPYING
- `jiff-static@0.2.35` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/jiff — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jiff-static-0.2.35/COPYING
- `jiff-tzdb-platform@0.1.3` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/jiff — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jiff-tzdb-platform-0.1.3/COPYING
- `jiff-tzdb@0.1.8` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/jiff — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jiff-tzdb-0.1.8/COPYING
- `jiff@0.2.35` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/jiff — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jiff-0.2.35/COPYING
- `jni-sys-macros@0.4.1` — License: MIT OR Apache-2.0 — Source: https://github.com/jni-rs/jni-sys — Text: (包内未随附独立文本文件)
- `jni-sys@0.3.1` — License: MIT OR Apache-2.0 — Source: https://github.com/jni-rs/jni-sys — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jni-sys-0.3.1/LICENSE-MIT
- `jni-sys@0.4.1` — License: MIT OR Apache-2.0 — Source: https://github.com/jni-rs/jni-sys — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jni-sys-0.4.1/LICENSE-MIT
- `jni@0.21.1` — License: MIT/Apache-2.0 — Source: https://github.com/jni-rs/jni-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jni-0.21.1/LICENSE-MIT
- `js-sys@0.3.104` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/js-sys — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/js-sys-0.3.104/LICENSE-MIT
- `json-patch@3.0.1` — License: MIT/Apache-2.0 — Source: https://github.com/idubrov/json-patch — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/json-patch-3.0.1/LICENSE-MIT
- `jsonptr@0.6.3` — License: MIT OR Apache-2.0 — Source: https://github.com/chanced/jsonptr — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jsonptr-0.6.3/LICENSE-MIT
- `keyboard-types@0.7.0` — License: MIT OR Apache-2.0 — Source: https://github.com/pyfisch/keyboard-types — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/keyboard-types-0.7.0/LICENSE-MIT
- `libappindicator-sys@0.9.0` — License: Apache-2.0 OR MIT — Source: (见上游发布渠道) — Text: (包内未随附独立文本文件)
- `libappindicator@0.9.0` — License: Apache-2.0 OR MIT — Source: (见上游发布渠道) — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libappindicator-0.9.0/LICENSE-MIT
- `libc@0.2.189` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/libc — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libc-0.2.189/LICENSE-MIT
- `libdbus-sys@0.2.7` — License: Apache-2.0/MIT — Source: https://github.com/diwic/dbus-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libdbus-sys-0.2.7/LICENSE-MIT
- `libloading@0.7.4` — License: ISC — Source: https://github.com/nagisa/rust_libloading/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libloading-0.7.4/LICENSE
- `libredox@0.1.20` — License: MIT — Source: https://gitlab.redox-os.org/redox-os/libredox.git — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/libredox-0.1.20/LICENSE
- `linux-raw-sys@0.12.1` — License: Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT — Source: https://github.com/sunfishcode/linux-raw-sys — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/linux-raw-sys-0.12.1/LICENSE-MIT
- `litemap@0.8.3` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/litemap-0.8.3/LICENSE
- `lock_api@0.4.14` — License: MIT OR Apache-2.0 — Source: https://github.com/Amanieu/parking_lot — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/lock_api-0.4.14/LICENSE-MIT
- `log@0.4.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/log — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/log-0.4.34/LICENSE-MIT
- `markup5ever@0.38.0` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/html5ever — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/markup5ever-0.38.0/LICENSE-MIT
- `memchr@2.8.3` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/memchr — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/memchr-2.8.3/COPYING
- `memoffset@0.9.1` — License: MIT — Source: https://github.com/Gilnaa/memoffset — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/memoffset-0.9.1/LICENSE
- `mime@0.3.17` — License: MIT OR Apache-2.0 — Source: https://github.com/hyperium/mime — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/mime-0.3.17/LICENSE-MIT
- `miniz_oxide@0.8.9` — License: MIT OR Zlib OR Apache-2.0 — Source: https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/miniz_oxide-0.8.9/LICENSE
- `mio@1.2.2` — License: MIT — Source: https://github.com/tokio-rs/mio — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/mio-1.2.2/LICENSE
- `muda@0.19.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/muda — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/muda-0.19.3/LICENSE-MIT
- `ndk-sys@0.6.0+11769913` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-mobile/ndk — Text: (包内未随附独立文本文件)
- `ndk@0.9.0` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-mobile/ndk — Text: (包内未随附独立文本文件)
- `new_debug_unreachable@1.0.6` — License: MIT — Source: https://github.com/mbrubeck/rust-debug-unreachable — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/new_debug_unreachable-1.0.6/LICENSE-MIT
- `num_enum_derive@0.7.6` — License: BSD-3-Clause OR MIT OR Apache-2.0 — Source: https://github.com/illicitonion/num_enum — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num_enum_derive-0.7.6/LICENSE-MIT
- `num_enum@0.7.6` — License: BSD-3-Clause OR MIT OR Apache-2.0 — Source: https://github.com/illicitonion/num_enum — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num_enum-0.7.6/LICENSE-MIT
- `num-conv@0.2.2` — License: MIT OR Apache-2.0 — Source: https://github.com/jhpratt/num-conv — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-conv-0.2.2/LICENSE-MIT
- `num-traits@0.2.19` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-num/num-traits — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/num-traits-0.2.19/LICENSE-MIT
- `objc2-app-kit@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-cloud-kit@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-data@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-foundation@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-graphics@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-image@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-location@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-text@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-core-video@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-encode@4.1.0` — License: MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-exception-helper@0.1.1` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-foundation@0.3.2` — License: MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-io-surface@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-quartz-core@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-ui-kit@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-user-notifications@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2-web-kit@0.3.2` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `objc2@0.6.4` — License: MIT — Source: https://github.com/madsmtm/objc2 — Text: (包内未随附独立文本文件)
- `once_cell@1.21.4` — License: MIT OR Apache-2.0 — Source: https://github.com/matklad/once_cell — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/once_cell-1.21.4/LICENSE-MIT
- `option-ext@0.2.0` — License: MPL-2.0 — Source: https://github.com/soc/option-ext.git — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/option-ext-0.2.0/LICENSE.txt
- `ordered-stream@0.2.0` — License: MIT OR Apache-2.0 — Source: https://github.com/danieldg/ordered-stream — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ordered-stream-0.2.0/LICENSE-MIT
- `pango-sys@0.18.0` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pango-sys-0.18.0/LICENSE
- `pango@0.18.3` — License: MIT — Source: https://github.com/gtk-rs/gtk-rs-core — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pango-0.18.3/LICENSE
- `parking_lot_core@0.9.12` — License: MIT OR Apache-2.0 — Source: https://github.com/Amanieu/parking_lot — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_lot_core-0.9.12/LICENSE-MIT
- `parking_lot@0.12.5` — License: MIT OR Apache-2.0 — Source: https://github.com/Amanieu/parking_lot — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking_lot-0.12.5/LICENSE-MIT
- `parking@2.2.1` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/parking — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/parking-2.2.1/LICENSE-MIT
- `percent-encoding@2.3.2` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/rust-url/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/percent-encoding-2.3.2/LICENSE-MIT
- `phf_codegen@0.13.1` — License: MIT — Source: https://github.com/rust-phf/rust-phf — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_codegen-0.13.1/LICENSE
- `phf_generator@0.13.1` — License: MIT — Source: https://github.com/rust-phf/rust-phf — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_generator-0.13.1/LICENSE
- `phf_macros@0.13.1` — License: MIT — Source: https://github.com/rust-phf/rust-phf — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_macros-0.13.1/LICENSE
- `phf_shared@0.13.1` — License: MIT — Source: https://github.com/rust-phf/rust-phf — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf_shared-0.13.1/LICENSE
- `phf@0.13.1` — License: MIT — Source: https://github.com/rust-phf/rust-phf — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/phf-0.13.1/LICENSE
- `pin-project-lite@0.2.17` — License: Apache-2.0 OR MIT — Source: https://github.com/taiki-e/pin-project-lite — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pin-project-lite-0.2.17/LICENSE-MIT
- `piper@0.2.5` — License: MIT OR Apache-2.0 — Source: https://github.com/smol-rs/piper — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/piper-0.2.5/LICENSE-MIT
- `pkg-config@0.3.34` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/pkg-config-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/pkg-config-0.3.34/LICENSE-MIT
- `plist@1.10.0` — License: MIT — Source: https://github.com/ebarnard/rust-plist/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/plist-1.10.0/LICENCE
- `png@0.17.16` — License: MIT OR Apache-2.0 — Source: https://github.com/image-rs/image-png — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.17.16/LICENSE-MIT
- `png@0.18.1` — License: MIT OR Apache-2.0 — Source: https://github.com/image-rs/image-png — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/png-0.18.1/LICENSE-MIT
- `polling@3.11.0` — License: Apache-2.0 OR MIT — Source: https://github.com/smol-rs/polling — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/polling-3.11.0/LICENSE-MIT
- `portable-atomic-util@0.2.7` — License: Apache-2.0 OR MIT — Source: https://github.com/taiki-e/portable-atomic-util — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/portable-atomic-util-0.2.7/LICENSE-MIT
- `portable-atomic@1.15.0` — License: Apache-2.0 OR MIT — Source: https://github.com/taiki-e/portable-atomic — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/portable-atomic-1.15.0/LICENSE-MIT
- `potential_utf@0.1.6` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/potential_utf-0.1.6/LICENSE
- `powerfmt@0.2.0` — License: MIT OR Apache-2.0 — Source: https://github.com/jhpratt/powerfmt — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/powerfmt-0.2.0/LICENSE-MIT
- `precomputed-hash@0.1.1` — License: MIT — Source: https://github.com/emilio/precomputed-hash — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/precomputed-hash-0.1.1/LICENSE
- `proc-macro-crate@1.3.1` — License: MIT OR Apache-2.0 — Source: https://github.com/bkchr/proc-macro-crate — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro-crate-1.3.1/LICENSE-MIT
- `proc-macro-crate@2.0.2` — License: MIT OR Apache-2.0 — Source: https://github.com/bkchr/proc-macro-crate — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro-crate-2.0.2/LICENSE-MIT
- `proc-macro-crate@3.5.0` — License: MIT OR Apache-2.0 — Source: https://github.com/bkchr/proc-macro-crate — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro-crate-3.5.0/LICENSE-MIT
- `proc-macro-error-attr@1.0.4` — License: MIT OR Apache-2.0 — Source: https://gitlab.com/CreepySkeleton/proc-macro-error — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro-error-attr-1.0.4/LICENSE-MIT
- `proc-macro-error@1.0.4` — License: MIT OR Apache-2.0 — Source: https://gitlab.com/CreepySkeleton/proc-macro-error — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro-error-1.0.4/LICENSE-MIT
- `proc-macro2@1.0.107` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/proc-macro2 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/proc-macro2-1.0.107/LICENSE-MIT
- `quick-xml@0.41.0` — License: MIT — Source: https://github.com/tafia/quick-xml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/quick-xml-0.41.0/LICENSE-MIT.md
- `quote@1.0.47` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/quote — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/quote-1.0.47/LICENSE-MIT
- `r-efi@5.3.0` — License: MIT OR Apache-2.0 OR LGPL-2.1-or-later — Source: https://github.com/r-efi/r-efi — Text: (包内未随附独立文本文件)
- `r-efi@6.0.0` — License: MIT OR Apache-2.0 OR LGPL-2.1-or-later — Source: https://github.com/r-efi/r-efi — Text: (包内未随附独立文本文件)
- `raw-window-handle@0.6.2` — License: MIT OR Apache-2.0 OR Zlib — Source: https://github.com/rust-windowing/raw-window-handle — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/raw-window-handle-0.6.2/LICENSE-APACHE.md
- `redox_syscall@0.5.18` — License: MIT — Source: https://gitlab.redox-os.org/redox-os/syscall — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/redox_syscall-0.5.18/LICENSE
- `redox_users@0.5.2` — License: MIT — Source: https://gitlab.redox-os.org/redox-os/users — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/redox_users-0.5.2/LICENSE
- `ref-cast-impl@1.0.27` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/ref-cast — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ref-cast-impl-1.0.27/LICENSE-MIT
- `ref-cast@1.0.27` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/ref-cast — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ref-cast-1.0.27/LICENSE-MIT
- `regex-automata@0.4.18` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/regex — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-automata-0.4.18/LICENSE-MIT
- `regex-syntax@0.8.11` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/regex — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-syntax-0.8.11/LICENSE-MIT
- `regex@1.13.1` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/regex — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-1.13.1/LICENSE-MIT
- `reqwest@0.13.4` — License: MIT OR Apache-2.0 — Source: https://github.com/seanmonstar/reqwest — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/reqwest-0.13.4/LICENSE-MIT
- `rfd@0.16.0` — License: MIT — Source: https://github.com/PolyMeilex/rfd — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rfd-0.16.0/LICENSE
- `rustc_version@0.4.1` — License: MIT OR Apache-2.0 — Source: https://github.com/djc/rustc-version-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustc_version-0.4.1/LICENSE-MIT
- `rustc-hash@2.1.3` — License: Apache-2.0 OR MIT — Source: https://github.com/rust-lang/rustc-hash — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustc-hash-2.1.3/LICENSE-MIT
- `rustix@1.1.4` — License: Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT — Source: https://github.com/bytecodealliance/rustix — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustix-1.1.4/LICENSE-MIT
- `rustversion@1.0.23` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/rustversion — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rustversion-1.0.23/LICENSE-MIT
- `same-file@1.0.6` — License: Unlicense/MIT — Source: https://github.com/BurntSushi/same-file — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/same-file-1.0.6/COPYING
- `schemars_derive@0.8.22` — License: MIT — Source: https://github.com/GREsau/schemars — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemars_derive-0.8.22/LICENSE
- `schemars@0.8.22` — License: MIT — Source: https://github.com/GREsau/schemars — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemars-0.8.22/LICENSE
- `schemars@0.9.0` — License: MIT — Source: https://github.com/GREsau/schemars — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemars-0.9.0/LICENSE
- `schemars@1.2.2` — License: MIT — Source: https://github.com/GREsau/schemars — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/schemars-1.2.2/LICENSE
- `scopeguard@1.2.0` — License: MIT OR Apache-2.0 — Source: https://github.com/bluss/scopeguard — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/scopeguard-1.2.0/LICENSE-MIT
- `selectors@0.36.1` — License: MPL-2.0 — Source: https://github.com/servo/stylo — Text: (包内未随附独立文本文件)
- `semver@1.0.28` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/semver — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/semver-1.0.28/LICENSE-MIT
- `serde_core@1.0.229` — License: MIT OR Apache-2.0 — Source: https://github.com/serde-rs/serde — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_core-1.0.229/LICENSE-MIT
- `serde_derive_internals@0.29.1` — License: MIT OR Apache-2.0 — Source: https://github.com/serde-rs/serde — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_derive_internals-0.29.1/LICENSE-MIT
- `serde_derive@1.0.229` — License: MIT OR Apache-2.0 — Source: https://github.com/serde-rs/serde — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_derive-1.0.229/LICENSE-MIT
- `serde_json@1.0.151` — License: MIT OR Apache-2.0 — Source: https://github.com/serde-rs/json — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_json-1.0.151/LICENSE-MIT
- `serde_repr@0.1.21` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/serde-repr — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_repr-0.1.21/LICENSE-MIT
- `serde_spanned@0.6.9` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_spanned-0.6.9/LICENSE-MIT
- `serde_spanned@1.1.1` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_spanned-1.1.1/LICENSE-MIT
- `serde_with_macros@3.22.0` — License: MIT OR Apache-2.0 — Source: https://github.com/jonasbb/serde_with/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_with_macros-3.22.0/LICENSE-MIT
- `serde_with@3.22.0` — License: MIT OR Apache-2.0 — Source: https://github.com/jonasbb/serde_with/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde_with-3.22.0/LICENSE-MIT
- `serde-untagged@0.1.9` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/serde-untagged — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-untagged-0.1.9/LICENSE-MIT
- `serde@1.0.229` — License: MIT OR Apache-2.0 — Source: https://github.com/serde-rs/serde — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serde-1.0.229/LICENSE-MIT
- `serialize-to-javascript-impl@0.1.2` — License: MIT OR Apache-2.0 — Source: https://github.com/chippers/serialize-to-javascript — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serialize-to-javascript-impl-0.1.2/LICENSE-MIT
- `serialize-to-javascript@0.1.2` — License: MIT OR Apache-2.0 — Source: https://github.com/chippers/serialize-to-javascript — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/serialize-to-javascript-0.1.2/LICENSE-MIT
- `servo_arc@0.4.3` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/stylo — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/servo_arc-0.4.3/LICENSE-MIT
- `sha2@0.10.9` — License: MIT OR Apache-2.0 — Source: https://github.com/RustCrypto/hashes — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sha2-0.10.9/LICENSE-MIT
- `shlex@2.0.1` — License: MIT OR Apache-2.0 — Source: https://github.com/comex/rust-shlex — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/shlex-2.0.1/LICENSE-MIT
- `signal-hook-registry@1.4.8` — License: MIT OR Apache-2.0 — Source: https://github.com/vorner/signal-hook — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/signal-hook-registry-1.4.8/LICENSE-MIT
- `simd-adler32@0.3.10` — License: MIT — Source: https://github.com/mcountryman/simd-adler32 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/simd-adler32-0.3.10/LICENSE.md
- `siphasher@1.0.3` — License: MIT/Apache-2.0 — Source: https://github.com/jedisct1/rust-siphash — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/siphasher-1.0.3/COPYING
- `slab@0.4.12` — License: MIT — Source: https://github.com/tokio-rs/slab — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/slab-0.4.12/LICENSE
- `smallvec@1.15.2` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/rust-smallvec — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/smallvec-1.15.2/LICENSE-MIT
- `socket2@0.6.5` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-lang/socket2 — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/socket2-0.6.5/LICENSE-MIT
- `softbuffer@0.4.8` — License: MIT OR Apache-2.0 — Source: https://github.com/rust-windowing/softbuffer — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/softbuffer-0.4.8/LICENSE-MIT
- `soup3-sys@0.5.0` — License: MIT — Source: https://gitlab.gnome.org/World/Rust/soup3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/soup3-sys-0.5.0/LICENSE
- `soup3@0.5.0` — License: MIT — Source: https://gitlab.gnome.org/World/Rust/soup3-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/soup3-0.5.0/LICENSE
- `stable_deref_trait@1.2.1` — License: MIT OR Apache-2.0 — Source: https://github.com/storyyeller/stable_deref_trait — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/stable_deref_trait-1.2.1/LICENSE-MIT
- `string_cache_codegen@0.6.1` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/string-cache — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/string_cache_codegen-0.6.1/LICENSE-MIT
- `string_cache@0.9.0` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/string-cache — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/string_cache-0.9.0/LICENSE-MIT
- `strsim@0.11.1` — License: MIT — Source: https://github.com/rapidfuzz/strsim-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/strsim-0.11.1/LICENSE
- `swift-rs@1.0.8` — License: MIT OR Apache-2.0 — Source: https://github.com/Brendonovich/swift-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/swift-rs-1.0.8/LICENSE-MIT
- `syn@1.0.109` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/syn — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/syn-1.0.109/LICENSE-MIT
- `syn@2.0.119` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/syn — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/syn-2.0.119/LICENSE-MIT
- `syn@3.0.4` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/syn — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/syn-3.0.4/LICENSE-MIT
- `sync_wrapper@1.0.2` — License: Apache-2.0 — Source: https://github.com/Actyx/sync_wrapper — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sync_wrapper-1.0.2/LICENSE
- `synstructure@0.13.2` — License: MIT — Source: https://github.com/mystor/synstructure — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/synstructure-0.13.2/LICENSE
- `system-deps@6.2.2` — License: MIT OR Apache-2.0 — Source: https://github.com/gdesmott/system-deps — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/system-deps-6.2.2/LICENSE-MIT
- `tao-macros@0.1.4` — License: MIT OR Apache-2.0 — Source: https://github.com/tauri-apps/tao — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tao-macros-0.1.4/LICENSE-MIT
- `tao@0.35.3` — License: Apache-2.0 — Source: https://github.com/tauri-apps/tao — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tao-0.35.3/LICENSE
- `target-lexicon@0.12.16` — License: Apache-2.0 WITH LLVM-exception — Source: https://github.com/bytecodealliance/target-lexicon — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/target-lexicon-0.12.16/LICENSE
- `tauri-build@2.6.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-build-2.6.3/LICENSE_APACHE-2.0
- `tauri-codegen@2.6.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-codegen-2.6.3/LICENSE_APACHE-2.0
- `tauri-macros@2.6.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-macros-2.6.3/LICENSE_APACHE-2.0
- `tauri-plugin-dialog@2.7.2` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/plugins-workspace — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-dialog-2.7.2/LICENSE.spdx
- `tauri-plugin-fs@2.5.1` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/plugins-workspace — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-fs-2.5.1/LICENSE.spdx
- `tauri-plugin-global-shortcut@2.3.2` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/plugins-workspace — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-global-shortcut-2.3.2/LICENSE.spdx
- `tauri-plugin-single-instance@2.4.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/plugins-workspace — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-single-instance-2.4.3/LICENSE.spdx
- `tauri-plugin@2.6.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: (包内未随附独立文本文件)
- `tauri-runtime-wry@2.11.4` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-runtime-wry-2.11.4/LICENSE_APACHE-2.0
- `tauri-runtime@2.11.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-runtime-2.11.3/LICENSE_APACHE-2.0
- `tauri-utils@2.9.3` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-utils-2.9.3/LICENSE_APACHE-2.0
- `tauri-winres@0.3.6` — License: MIT — Source: https://github.com/tauri-apps/winres — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-winres-0.3.6/LICENSE
- `tauri@2.11.5` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/LICENSE_APACHE-2.0
- `tempfile@3.27.0` — License: MIT OR Apache-2.0 — Source: https://github.com/Stebalien/tempfile — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tempfile-3.27.0/LICENSE-MIT
- `tendril@0.5.1` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/html5ever — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tendril-0.5.1/LICENSE-MIT
- `thiserror-impl@1.0.69` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/thiserror — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-impl-1.0.69/LICENSE-MIT
- `thiserror-impl@2.0.20` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/thiserror — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-impl-2.0.20/LICENSE-MIT
- `thiserror@1.0.69` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/thiserror — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-1.0.69/LICENSE-MIT
- `thiserror@2.0.20` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/thiserror — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/thiserror-2.0.20/LICENSE-MIT
- `time-core@0.1.9` — License: MIT OR Apache-2.0 — Source: https://github.com/time-rs/time — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-core-0.1.9/LICENSE-MIT
- `time-macros@0.2.32` — License: MIT OR Apache-2.0 — Source: https://github.com/time-rs/time — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-macros-0.2.32/LICENSE-MIT
- `time@0.3.55` — License: MIT OR Apache-2.0 — Source: https://github.com/time-rs/time — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/time-0.3.55/LICENSE-MIT
- `tinystr@0.8.4` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tinystr-0.8.4/LICENSE
- `tinyvec_macros@0.1.1` — License: MIT OR Apache-2.0 OR Zlib — Source: https://github.com/Soveu/tinyvec_macros — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tinyvec_macros-0.1.1/LICENSE-APACHE.md
- `tinyvec@1.12.0` — License: Zlib OR Apache-2.0 OR MIT — Source: https://github.com/Lokathor/tinyvec — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tinyvec-1.12.0/LICENSE-APACHE.md
- `tokio-util@0.7.19` — License: MIT — Source: https://github.com/tokio-rs/tokio — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-util-0.7.19/LICENSE
- `tokio@1.53.1` — License: MIT — Source: https://github.com/tokio-rs/tokio — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.53.1/LICENSE
- `toml_datetime@0.6.3` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_datetime-0.6.3/LICENSE-MIT
- `toml_datetime@0.7.5+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_datetime-0.7.5+spec-1.1.0/LICENSE-MIT
- `toml_datetime@1.1.1+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_datetime-1.1.1+spec-1.1.0/LICENSE-MIT
- `toml_edit@0.19.15` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_edit-0.19.15/LICENSE-MIT
- `toml_edit@0.20.2` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_edit-0.20.2/LICENSE-MIT
- `toml_edit@0.25.13+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_edit-0.25.13+spec-1.1.0/LICENSE-MIT
- `toml_parser@1.1.3+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_parser-1.1.3+spec-1.1.0/LICENSE-MIT
- `toml_writer@1.1.2+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml_writer-1.1.2+spec-1.1.0/LICENSE-MIT
- `toml@0.8.2` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml-0.8.2/LICENSE-MIT
- `toml@0.9.12+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml-0.9.12+spec-1.1.0/LICENSE-MIT
- `toml@1.1.4+spec-1.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/toml-rs/toml — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/toml-1.1.4+spec-1.1.0/LICENSE-MIT
- `tower-http@0.6.11` — License: MIT — Source: https://github.com/tower-rs/tower-http — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-http-0.6.11/LICENSE
- `tower-layer@0.3.3` — License: MIT — Source: https://github.com/tower-rs/tower — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-layer-0.3.3/LICENSE
- `tower-service@0.3.3` — License: MIT — Source: https://github.com/tower-rs/tower — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-service-0.3.3/LICENSE
- `tower@0.5.3` — License: MIT — Source: https://github.com/tower-rs/tower — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tower-0.5.3/LICENSE
- `tracing-attributes@0.1.31` — License: MIT — Source: https://github.com/tokio-rs/tracing — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tracing-attributes-0.1.31/LICENSE
- `tracing-core@0.1.36` — License: MIT — Source: https://github.com/tokio-rs/tracing — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tracing-core-0.1.36/LICENSE
- `tracing@0.1.44` — License: MIT — Source: https://github.com/tokio-rs/tracing — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tracing-0.1.44/LICENSE
- `tray-icon@0.24.2` — License: MIT OR Apache-2.0 — Source: https://github.com/tauri-apps/tray-icon — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tray-icon-0.24.2/LICENSE-MIT
- `try-lock@0.2.5` — License: MIT — Source: https://github.com/seanmonstar/try-lock — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/try-lock-0.2.5/LICENSE
- `typeid@1.0.3` — License: MIT OR Apache-2.0 — Source: https://github.com/dtolnay/typeid — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typeid-1.0.3/LICENSE-MIT
- `typenum@1.20.1` — License: MIT OR Apache-2.0 — Source: https://github.com/paholg/typenum — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/typenum-1.20.1/LICENSE
- `uds_windows@1.2.1` — License: MIT — Source: https://github.com/haraldh/rust_uds_windows — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uds_windows-1.2.1/LICENSE
- `unic-char-property@0.9.0` — License: MIT/Apache-2.0 — Source: https://github.com/open-i18n/rust-unic/ — Text: (包内未随附独立文本文件)
- `unic-char-range@0.9.0` — License: MIT/Apache-2.0 — Source: https://github.com/open-i18n/rust-unic/ — Text: (包内未随附独立文本文件)
- `unic-common@0.9.0` — License: MIT/Apache-2.0 — Source: https://github.com/open-i18n/rust-unic/ — Text: (包内未随附独立文本文件)
- `unic-ucd-ident@0.9.0` — License: MIT/Apache-2.0 — Source: https://github.com/open-i18n/rust-unic/ — Text: (包内未随附独立文本文件)
- `unic-ucd-version@0.9.0` — License: MIT/Apache-2.0 — Source: https://github.com/open-i18n/rust-unic/ — Text: (包内未随附独立文本文件)
- `unicode-ident@1.0.24` — License: (MIT OR Apache-2.0) AND Unicode-3.0 — Source: https://github.com/dtolnay/unicode-ident — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-ident-1.0.24/LICENSE-MIT
- `unicode-segmentation@1.13.3` — License: MIT OR Apache-2.0 — Source: https://github.com/unicode-rs/unicode-segmentation — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/unicode-segmentation-1.13.3/LICENSE-MIT
- `url@2.5.8` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/rust-url — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/url-2.5.8/LICENSE-MIT
- `urlpattern@0.3.0` — License: MIT — Source: https://github.com/denoland/rust-urlpattern — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/urlpattern-0.3.0/LICENSE
- `utf8_iter@1.0.4` — License: Apache-2.0 OR MIT — Source: https://github.com/hsivonen/utf8_iter — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/utf8_iter-1.0.4/LICENSE-MIT
- `uuid@1.25.0` — License: Apache-2.0 OR MIT — Source: https://github.com/uuid-rs/uuid — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/uuid-1.25.0/LICENSE-MIT
- `version_check@0.9.5` — License: MIT/Apache-2.0 — Source: https://github.com/SergioBenitez/version_check — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/version_check-0.9.5/LICENSE-MIT
- `version-compare@0.2.1` — License: MIT — Source: https://gitlab.com/timvisee/version-compare — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/version-compare-0.2.1/LICENSE
- `vswhom-sys@0.1.3` — License: MIT — Source: https://github.com/nabijaczleweli/vswhom-sys.rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/vswhom-sys-0.1.3/LICENSE
- `vswhom@0.1.0` — License: MIT — Source: https://github.com/nabijaczleweli/vswhom.rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/vswhom-0.1.0/LICENSE
- `walkdir@2.5.0` — License: Unlicense/MIT — Source: https://github.com/BurntSushi/walkdir — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/walkdir-2.5.0/COPYING
- `want@0.3.1` — License: MIT — Source: https://github.com/seanmonstar/want — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/want-0.3.1/LICENSE
- `wasi@0.11.1+wasi-snapshot-preview1` — License: Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT — Source: https://github.com/bytecodealliance/wasi — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasi-0.11.1+wasi-snapshot-preview1/LICENSE-MIT
- `wasip2@1.0.4+wasi-0.2.12` — License: Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT — Source: https://github.com/bytecodealliance/wasi-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasip2-1.0.4+wasi-0.2.12/LICENSE-MIT
- `wasm-bindgen-futures@0.4.77` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/futures — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-futures-0.4.77/LICENSE-MIT
- `wasm-bindgen-macro-support@0.2.127` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/macro-support — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-macro-support-0.2.127/LICENSE-MIT
- `wasm-bindgen-macro@0.2.127` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/macro — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-macro-0.2.127/LICENSE-MIT
- `wasm-bindgen-shared@0.2.127` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/shared — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-shared-0.2.127/LICENSE-MIT
- `wasm-bindgen@0.2.127` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-0.2.127/LICENSE-MIT
- `wasm-streams@0.5.0` — License: MIT OR Apache-2.0 — Source: https://github.com/MattiasBuelens/wasm-streams/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wasm-streams-0.5.0/LICENSE-MIT
- `web_atoms@0.2.6` — License: MIT OR Apache-2.0 — Source: https://github.com/servo/html5ever — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web_atoms-0.2.6/LICENSE-MIT
- `web-sys@0.3.104` — License: MIT OR Apache-2.0 — Source: https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/web-sys — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/web-sys-0.3.104/LICENSE-MIT
- `webkit2gtk-sys@2.0.2` — License: MIT — Source: https://github.com/tauri-apps/webkit2gtk-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webkit2gtk-sys-2.0.2/LICENSE
- `webkit2gtk@2.0.2` — License: MIT — Source: https://github.com/tauri-apps/webkit2gtk-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webkit2gtk-2.0.2/LICENSE
- `webview2-com-macros@0.8.1` — License: MIT — Source: https://github.com/wravery/webview2-rs — Text: (包内未随附独立文本文件)
- `webview2-com-sys@0.38.2` — License: MIT — Source: https://github.com/wravery/webview2-rs — Text: (包内未随附独立文本文件)
- `webview2-com@0.38.2` — License: MIT — Source: https://github.com/wravery/webview2-rs — Text: (包内未随附独立文本文件)
- `winapi-i686-pc-windows-gnu@0.4.0` — License: MIT/Apache-2.0 — Source: https://github.com/retep998/winapi-rs — Text: (包内未随附独立文本文件)
- `winapi-util@0.1.11` — License: Unlicense OR MIT — Source: https://github.com/BurntSushi/winapi-util — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winapi-util-0.1.11/COPYING
- `winapi-x86_64-pc-windows-gnu@0.4.0` — License: MIT/Apache-2.0 — Source: https://github.com/retep998/winapi-rs — Text: (包内未随附独立文本文件)
- `winapi@0.3.9` — License: MIT/Apache-2.0 — Source: https://github.com/retep998/winapi-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winapi-0.3.9/LICENSE-MIT
- `window-vibrancy@0.6.0` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/tauri-plugin-vibrancy — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/window-vibrancy-0.6.0/LICENSE-MIT
- `windows_aarch64_gnullvm@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_aarch64_gnullvm-0.42.2/LICENSE-MIT
- `windows_aarch64_gnullvm@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_aarch64_gnullvm-0.52.6/LICENSE-MIT
- `windows_aarch64_gnullvm@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_aarch64_gnullvm-0.53.1/LICENSE-MIT
- `windows_aarch64_msvc@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_aarch64_msvc-0.42.2/LICENSE-MIT
- `windows_aarch64_msvc@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_aarch64_msvc-0.52.6/LICENSE-MIT
- `windows_aarch64_msvc@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_aarch64_msvc-0.53.1/LICENSE-MIT
- `windows_i686_gnu@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_gnu-0.42.2/LICENSE-MIT
- `windows_i686_gnu@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_gnu-0.52.6/LICENSE-MIT
- `windows_i686_gnu@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_gnu-0.53.1/LICENSE-MIT
- `windows_i686_gnullvm@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_gnullvm-0.52.6/LICENSE-MIT
- `windows_i686_gnullvm@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_gnullvm-0.53.1/LICENSE-MIT
- `windows_i686_msvc@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_msvc-0.42.2/LICENSE-MIT
- `windows_i686_msvc@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_msvc-0.52.6/LICENSE-MIT
- `windows_i686_msvc@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_i686_msvc-0.53.1/LICENSE-MIT
- `windows_x86_64_gnu@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_gnu-0.42.2/LICENSE-MIT
- `windows_x86_64_gnu@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_gnu-0.52.6/LICENSE-MIT
- `windows_x86_64_gnu@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_gnu-0.53.1/LICENSE-MIT
- `windows_x86_64_gnullvm@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_gnullvm-0.42.2/LICENSE-MIT
- `windows_x86_64_gnullvm@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_gnullvm-0.52.6/LICENSE-MIT
- `windows_x86_64_gnullvm@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_gnullvm-0.53.1/LICENSE-MIT
- `windows_x86_64_msvc@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_msvc-0.42.2/LICENSE-MIT
- `windows_x86_64_msvc@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_msvc-0.52.6/LICENSE-MIT
- `windows_x86_64_msvc@0.53.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows_x86_64_msvc-0.53.1/LICENSE-MIT
- `windows-collections@0.2.0` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-collections-0.2.0/LICENSE-MIT
- `windows-core@0.61.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-core-0.61.2/LICENSE-MIT
- `windows-core@0.62.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-core-0.62.2/LICENSE-MIT
- `windows-future@0.2.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-future-0.2.1/LICENSE-MIT
- `windows-implement@0.60.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-implement-0.60.2/LICENSE-MIT
- `windows-interface@0.59.3` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-interface-0.59.3/LICENSE-MIT
- `windows-link@0.1.3` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-link-0.1.3/LICENSE-MIT
- `windows-link@0.2.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-link-0.2.1/LICENSE-MIT
- `windows-numerics@0.2.0` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-numerics-0.2.0/LICENSE-MIT
- `windows-result@0.3.4` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-result-0.3.4/LICENSE-MIT
- `windows-result@0.4.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-result-0.4.1/LICENSE-MIT
- `windows-strings@0.4.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-strings-0.4.2/LICENSE-MIT
- `windows-strings@0.5.1` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-strings-0.5.1/LICENSE-MIT
- `windows-sys@0.45.0` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-sys-0.45.0/LICENSE-MIT
- `windows-sys@0.59.0` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-sys-0.59.0/LICENSE-MIT
- `windows-sys@0.60.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-sys-0.60.2/LICENSE-MIT
- `windows-sys@0.61.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-sys-0.61.2/LICENSE-MIT
- `windows-targets@0.42.2` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-targets-0.42.2/LICENSE-MIT
- `windows-targets@0.52.6` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-targets-0.52.6/LICENSE-MIT
- `windows-targets@0.53.5` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-targets-0.53.5/LICENSE-MIT
- `windows-threading@0.1.0` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-threading-0.1.0/LICENSE-MIT
- `windows-version@0.1.7` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-version-0.1.7/LICENSE-MIT
- `windows@0.61.3` — License: MIT OR Apache-2.0 — Source: https://github.com/microsoft/windows-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/windows-0.61.3/LICENSE-MIT
- `winnow@0.5.40` — License: MIT — Source: https://github.com/winnow-rs/winnow — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winnow-0.5.40/LICENSE-MIT
- `winnow@0.7.15` — License: MIT — Source: https://github.com/winnow-rs/winnow — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winnow-0.7.15/LICENSE-MIT
- `winnow@1.0.4` — License: MIT — Source: https://github.com/winnow-rs/winnow — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winnow-1.0.4/LICENSE-MIT
- `winreg@0.55.0` — License: MIT — Source: https://github.com/gentoo90/winreg-rs — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/winreg-0.55.0/LICENSE
- `wit-bindgen@0.57.1` — License: Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT — Source: https://github.com/bytecodealliance/wit-bindgen — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wit-bindgen-0.57.1/LICENSE-MIT
- `writeable@0.6.4` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/writeable-0.6.4/LICENSE
- `wry@0.55.1` — License: Apache-2.0 OR MIT — Source: https://github.com/tauri-apps/wry — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.55.1/LICENSE-MIT
- `x11-dl@2.21.0` — License: MIT — Source: https://github.com/AltF02/x11-rs.git — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/x11-dl-2.21.0/LICENSE-MIT
- `x11@2.21.0` — License: MIT — Source: https://github.com/AltF02/x11-rs.git — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/x11-2.21.0/LICENSE-MIT
- `x11rb-protocol@0.13.2` — License: MIT OR Apache-2.0 — Source: https://github.com/psychon/x11rb — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/x11rb-protocol-0.13.2/LICENSE-MIT
- `x11rb@0.13.2` — License: MIT OR Apache-2.0 — Source: https://github.com/psychon/x11rb — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/x11rb-0.13.2/LICENSE-MIT
- `xkeysym@0.2.1` — License: MIT OR Apache-2.0 OR Zlib — Source: https://github.com/notgull/xkeysym — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/xkeysym-0.2.1/LICENSE-MIT
- `yoke-derive@0.8.2` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/yoke-derive-0.8.2/LICENSE
- `yoke@0.8.3` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/yoke-0.8.3/LICENSE
- `zbus_macros@5.19.0` — License: MIT — Source: https://github.com/z-galaxy/zbus/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zbus_macros-5.19.0/LICENSE
- `zbus_names@4.3.4` — License: MIT — Source: https://github.com/z-galaxy/zbus/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zbus_names-4.3.4/LICENSE
- `zbus@5.19.0` — License: MIT — Source: https://github.com/z-galaxy/zbus/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zbus-5.19.0/LICENSE
- `zcheapstr@1.1.0` — License: MIT — Source: https://github.com/z-galaxy/zcheapstr/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zcheapstr-1.1.0/LICENSE
- `zerofrom-derive@0.1.7` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerofrom-derive-0.1.7/LICENSE
- `zerofrom@0.1.8` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerofrom-0.1.8/LICENSE
- `zerotrie@0.2.5` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerotrie-0.2.5/LICENSE
- `zerovec-derive@0.11.6` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerovec-derive-0.11.6/LICENSE
- `zerovec@0.11.8` — License: Unicode-3.0 — Source: https://github.com/unicode-org/icu4x — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zerovec-0.11.8/LICENSE
- `zmij@1.0.23` — License: MIT — Source: https://github.com/dtolnay/zmij — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zmij-1.0.23/LICENSE-MIT
- `zvariant_derive@5.15.0` — License: MIT — Source: https://github.com/z-galaxy/zbus/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zvariant_derive-5.15.0/LICENSE
- `zvariant_utils@4.2.0` — License: MIT — Source: https://github.com/z-galaxy/zbus/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zvariant_utils-4.2.0/LICENSE
- `zvariant@5.15.0` — License: MIT — Source: https://github.com/z-galaxy/zbus/ — Text: ../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/zvariant-5.15.0/LICENSE

## License texts（出现的每个不同许可的代表性全文）

### 0BSD

代表性全文来源：`node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/tslib/LICENSE.txt`

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### Apache-2.0

代表性全文来源：`node_modules/.pnpm/@eslint+config-array@0.21.2/node_modules/@eslint/config-array/LICENSE`

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### BSD-2-Clause

代表性全文来源：`node_modules/.pnpm/@eslint+eslintrc@3.3.6/node_modules/espree/LICENSE`

```text
BSD 2-Clause License

Copyright (c) Open JS Foundation
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause

代表性全文来源：`node_modules/.pnpm/ajv@8.20.0/node_modules/fast-uri/LICENSE`

```text
Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae
Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/garycourt/uri-js/graphs/contributors
```

### BlueOak-1.0.0

代表性全文来源：`node_modules/.pnpm/@typescript-eslint+typescript-estree@8.68.0_typescript@5.9.3/node_modules/minimatch/LICENSE.md`

```text
# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules. The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice. If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

**_As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim._**
```

### CC-BY-4.0

代表性全文来源：`node_modules/.pnpm/browserslist@4.28.8/node_modules/caniuse-lite/LICENSE`

```text
Attribution 4.0 International

=======================================================================

Creative Commons Corporation ("Creative Commons") is not a law firm and
does not provide legal services or legal advice. Distribution of
Creative Commons public licenses does not create a lawyer-client or
other relationship. Creative Commons makes its licenses and related
information available on an "as-is" basis. Creative Commons gives no
warranties regarding its licenses, any material licensed under their
terms and conditions, or any related information. Creative Commons
disclaims all liability for damages resulting from their use to the
fullest extent possible.

Using Creative Commons Public Licenses

Creative Commons public licenses provide a standard set of terms and
conditions that creators and other rights holders may use to share
original works of authorship and other material subject to copyright
and certain other rights specified in the public license below. The
following considerations are for informational purposes only, are not
exhaustive, and do not form part of our licenses.

     Considerations for licensors: Our public licenses are
     intended for use by those authorized to give the public
     permission to use material in ways otherwise restricted by
     copyright and certain other rights. Our licenses are
     irrevocable. Licensors should read and understand the terms
     and conditions of the license they choose before applying it.
     Licensors should also secure all rights necessary before
     applying our licenses so that the public can reuse the
     material as expected. Licensors should clearly mark any
     material not subject to the license. This includes other CC-
     licensed material, or material used under an exception or
     limitation to copyright. More considerations for licensors:
	wiki.creativecommons.org/Considerations_for_licensors

     Considerations for the public: By using one of our public
     licenses, a licensor grants the public permission to use the
     licensed material under specified terms and conditions. If
     the licensor's permission is not necessary for any reason--for
     example, because of any applicable exception or limitation to
     copyright--then that use is not regulated by the license. Our
     licenses grant only permissions under copyright and certain
     other rights that a licensor has authority to grant. Use of
     the licensed material may still be restricted for other
     reasons, including because others have copyright or other
     rights in the material. A licensor may make special requests,
     such as asking that all changes be marked or described.
     Although not required by our licenses, you are encouraged to
     respect those requests where reasonable. More_considerations
     for the public: 
	wiki.creativecommons.org/Considerations_for_licensees

=======================================================================

Creative Commons Attribution 4.0 International Public License

By exercising the Licensed Rights (defined below), You accept and agree
to be bound by the terms and conditions of this Creative Commons
Attribution 4.0 International Public License ("Public License"). To the
extent this Public License may be interpreted as a contract, You are
granted the Licensed Rights in consideration of Your acceptance of
these terms and conditions, and the Licensor grants You such rights in
consideration of benefits the Licensor receives from making the
Licensed Material available under these terms and conditions.


Section 1 -- Definitions.

  a. Adapted Material means material subject to Copyright and Similar
     Rights that is derived from or based upon the Licensed Material
     and in which the Licensed Material is translated, altered,
     arranged, transformed, or otherwise modified in a manner requiring
     permission under the Copyright and Similar Rights held by the
     Licensor. For purposes of this Public License, where the Licensed
     Material is a musical work, performance, or sound recording,
     Adapted Material is always produced where the Licensed Material is
     synched in timed relation with a moving image.

  b. Adapter's License means the license You apply to Your Copyright
     and Similar Rights in Your contributions to Adapted Material in
     accordance with the terms and conditions of this Public License.

  c. Copyright and Similar Rights means copyright and/or similar rights
     closely related to copyright including, without limitation,
     performance, broadcast, sound recording, and Sui Generis Database
     Rights, without regard to how the rights are labeled or
     categorized. For purposes of this Public License, the rights
     specified in Section 2(b)(1)-(2) are not Copyright and Similar
     Rights.

  d. Effective Technological Measures means those measures that, in the
     absence of proper authority, may not be circumvented under laws
     fulfilling obligations under Article 11 of the WIPO Copyright
     Treaty adopted on December 20, 1996, and/or similar international
     agreements.

  e. Exceptions and Limitations means fair use, fair dealing, and/or
     any other exception or limitation to Copyright and Similar Rights
     that applies to Your use of the Licensed Material.

  f. Licensed Material means the artistic or literary work, database,
     or other material to which the Licensor applied this Public
     License.

  g. Licensed Rights means the rights granted to You subject to the
     terms and conditions of this Public License, which are limited to
     all Copyright and Similar Rights that apply to Your use of the
     Licensed Material and that the Licensor has authority to license.

  h. Licensor means the individual(s) or entity(ies) granting rights
     under this Public License.

  i. Share means to provide material to the public by any means or
     process that requires permission under the Licensed Rights, such
     as reproduction, public display, public performance, distribution,
     dissemination, communication, or importation, and to make material
     available to the public including in ways that members of the
     public may access the material from a place and at a time
     individually chosen by them.

  j. Sui Generis Database Rights means rights other than copyright
     resulting from Directive 96/9/EC of the European Parliament and of
     the Council of 11 March 1996 on the legal protection of databases,
     as amended and/or succeeded, as well as other essentially
     equivalent rights anywhere in the world.

  k. You means the individual or entity exercising the Licensed Rights
     under this Public License. Your has a corresponding meaning.


Section 2 -- Scope.

  a. License grant.

       1. Subject to the terms and conditions of this Public License,
          the Licensor hereby grants You a worldwide, royalty-free,
          non-sublicensable, non-exclusive, irrevocable license to
          exercise the Licensed Rights in the Licensed Material to:

            a. reproduce and Share the Licensed Material, in whole or
               in part; and

            b. produce, reproduce, and Share Adapted Material.

       2. Exceptions and Limitations. For the avoidance of doubt, where
          Exceptions and Limitations apply to Your use, this Public
          License does not apply, and You do not need to comply with
          its terms and conditions.

       3. Term. The term of this Public License is specified in Section
          6(a).

       4. Media and formats; technical modifications allowed. The
          Licensor authorizes You to exercise the Licensed Rights in
          all media and formats whether now known or hereafter created,
          and to make technical modifications necessary to do so. The
          Licensor waives and/or agrees not to assert any right or
          authority to forbid You from making technical modifications
          necessary to exercise the Licensed Rights, including
          technical modifications necessary to circumvent Effective
          Technological Measures. For purposes of this Public License,
          simply making modifications authorized by this Section 2(a)
          (4) never produces Adapted Material.

       5. Downstream recipients.

            a. Offer from the Licensor -- Licensed Material. Every
               recipient of the Licensed Material automatically
               receives an offer from the Licensor to exercise the
               Licensed Rights under the terms and conditions of this
               Public License.

            b. No downstream restrictions. You may not offer or impose
               any additional or different terms or conditions on, or
               apply any Effective Technological Measures to, the
               Licensed Material if doing so restricts exercise of the
               Licensed Rights by any recipient of the Licensed
               Material.

       6. No endorsement. Nothing in this Public License constitutes or
          may be construed as permission to assert or imply that You
          are, or that Your use of the Licensed Material is, connected
          with, or sponsored, endorsed, or granted official status by,
          the Licensor or others designated to receive attribution as
          provided in Section 3(a)(1)(A)(i).

  b. Other rights.

       1. Moral rights, such as the right of integrity, are not
          licensed under this Public License, nor are publicity,
          privacy, and/or other similar personality rights; however, to
          the extent possible, the Licensor waives and/or agrees not to
          assert any such rights held by the Licensor to the limited
          extent necessary to allow You to exercise the Licensed
          Rights, but not otherwise.

       2. Patent and trademark rights are not licensed under this
          Public License.

       3. To the extent possible, the Licensor waives any right to
          collect royalties from You for the exercise of the Licensed
          Rights, whether directly or through a collecting society
          under any voluntary or waivable statutory or compulsory
          licensing scheme. In all other cases the Licensor expressly
          reserves any right to collect such royalties.


Section 3 -- License Conditions.

Your exercise of the Licensed Rights is expressly made subject to the
following conditions.

  a. Attribution.

       1. If You Share the Licensed Material (including in modified
          form), You must:

            a. retain the following if it is supplied by the Licensor
               with the Licensed Material:

                 i. identification of the creator(s) of the Licensed
                    Material and any others designated to receive
                    attribution, in any reasonable manner requested by
                    the Licensor (including by pseudonym if
                    designated);

                ii. a copyright notice;

               iii. a notice that refers to this Public License;

                iv. a notice that refers to the disclaimer of
                    warranties;

                 v. a URI or hyperlink to the Licensed Material to the
                    extent reasonably practicable;

            b. indicate if You modified the Licensed Material and
               retain an indication of any previous modifications; and

            c. indicate the Licensed Material is licensed under this
               Public License, and include the text of, or the URI or
               hyperlink to, this Public License.

       2. You may satisfy the conditions in Section 3(a)(1) in any
          reasonable manner based on the medium, means, and context in
          which You Share the Licensed Material. For example, it may be
          reasonable to satisfy the conditions by providing a URI or
          hyperlink to a resource that includes the required
          information.

       3. If requested by the Licensor, You must remove any of the
          information required by Section 3(a)(1)(A) to the extent
          reasonably practicable.

       4. If You Share Adapted Material You produce, the Adapter's
          License You apply must not prevent recipients of the Adapted
          Material from complying with this Public License.


Section 4 -- Sui Generis Database Rights.

Where the Licensed Rights include Sui Generis Database Rights that
apply to Your use of the Licensed Material:

  a. for the avoidance of doubt, Section 2(a)(1) grants You the right
     to extract, reuse, reproduce, and Share all or a substantial
     portion of the contents of the database;

  b. if You include all or a substantial portion of the database
     contents in a database in which You have Sui Generis Database
     Rights, then the database in which You have Sui Generis Database
     Rights (but not its individual contents) is Adapted Material; and

  c. You must comply with the conditions in Section 3(a) if You Share
     all or a substantial portion of the contents of the database.

For the avoidance of doubt, this Section 4 supplements and does not
replace Your obligations under this Public License where the Licensed
Rights include other Copyright and Similar Rights.


Section 5 -- Disclaimer of Warranties and Limitation of Liability.

  a. UNLESS OTHERWISE SEPARATELY UNDERTAKEN BY THE LICENSOR, TO THE
     EXTENT POSSIBLE, THE LICENSOR OFFERS THE LICENSED MATERIAL AS-IS
     AND AS-AVAILABLE, AND MAKES NO REPRESENTATIONS OR WARRANTIES OF
     ANY KIND CONCERNING THE LICENSED MATERIAL, WHETHER EXPRESS,
     IMPLIED, STATUTORY, OR OTHER. THIS INCLUDES, WITHOUT LIMITATION,
     WARRANTIES OF TITLE, MERCHANTABILITY, FITNESS FOR A PARTICULAR
     PURPOSE, NON-INFRINGEMENT, ABSENCE OF LATENT OR OTHER DEFECTS,
     ACCURACY, OR THE PRESENCE OR ABSENCE OF ERRORS, WHETHER OR NOT
     KNOWN OR DISCOVERABLE. WHERE DISCLAIMERS OF WARRANTIES ARE NOT
     ALLOWED IN FULL OR IN PART, THIS DISCLAIMER MAY NOT APPLY TO YOU.

  b. TO THE EXTENT POSSIBLE, IN NO EVENT WILL THE LICENSOR BE LIABLE
     TO YOU ON ANY LEGAL THEORY (INCLUDING, WITHOUT LIMITATION,
     NEGLIGENCE) OR OTHERWISE FOR ANY DIRECT, SPECIAL, INDIRECT,
     INCIDENTAL, CONSEQUENTIAL, PUNITIVE, EXEMPLARY, OR OTHER LOSSES,
     COSTS, EXPENSES, OR DAMAGES ARISING OUT OF THIS PUBLIC LICENSE OR
     USE OF THE LICENSED MATERIAL, EVEN IF THE LICENSOR HAS BEEN
     ADVISED OF THE POSSIBILITY OF SUCH LOSSES, COSTS, EXPENSES, OR
     DAMAGES. WHERE A LIMITATION OF LIABILITY IS NOT ALLOWED IN FULL OR
     IN PART, THIS LIMITATION MAY NOT APPLY TO YOU.

  c. The disclaimer of warranties and limitation of liability provided
     above shall be interpreted in a manner that, to the extent
     possible, most closely approximates an absolute disclaimer and
     waiver of all liability.


Section 6 -- Term and Termination.

  a. This Public License applies for the term of the Copyright and
     Similar Rights licensed here. However, if You fail to comply with
     this Public License, then Your rights under this Public License
     terminate automatically.

  b. Where Your right to use the Licensed Material has terminated under
     Section 6(a), it reinstates:

       1. automatically as of the date the violation is cured, provided
          it is cured within 30 days of Your discovery of the
          violation; or

       2. upon express reinstatement by the Licensor.

     For the avoidance of doubt, this Section 6(b) does not affect any
     right the Licensor may have to seek remedies for Your violations
     of this Public License.

  c. For the avoidance of doubt, the Licensor may also offer the
     Licensed Material under separate terms or conditions or stop
     distributing the Licensed Material at any time; however, doing so
     will not terminate this Public License.

  d. Sections 1, 5, 6, 7, and 8 survive termination of this Public
     License.


Section 7 -- Other Terms and Conditions.

  a. The Licensor shall not be bound by any additional or different
     terms or conditions communicated by You unless expressly agreed.

  b. Any arrangements, understandings, or agreements regarding the
     Licensed Material not stated herein are separate from and
     independent of the terms and conditions of this Public License.


Section 8 -- Interpretation.

  a. For the avoidance of doubt, this Public License does not, and
     shall not be interpreted to, reduce, limit, restrict, or impose
     conditions on any use of the Licensed Material that could lawfully
     be made without permission under this Public License.

  b. To the extent possible, if any provision of this Public License is
     deemed unenforceable, it shall be automatically reformed to the
     minimum extent necessary to make it enforceable. If the provision
     cannot be reformed, it shall be severed from this Public License
     without affecting the enforceability of the remaining terms and
     conditions.

  c. No term or condition of this Public License will be waived and no
     failure to comply consented to unless expressly agreed to by the
     Licensor.

  d. Nothing in this Public License constitutes or may be interpreted
     as a limitation upon, or waiver of, any privileges and immunities
     that apply to the Licensor or You, including from the legal
     processes of any jurisdiction or authority.


=======================================================================

Creative Commons is not a party to its public
licenses. Notwithstanding, Creative Commons may elect to apply one of
its public licenses to material it publishes and in those instances
will be considered the “Licensor.” The text of the Creative Commons
public licenses is dedicated to the public domain under the CC0 Public
Domain Dedication. Except for the limited purpose of indicating that
material is shared under a Creative Commons public license or as
otherwise permitted by the Creative Commons policies published at
creativecommons.org/policies, Creative Commons does not authorize the
use of the trademark "Creative Commons" or any other trademark or logo
of Creative Commons without its prior written consent including,
without limitation, in connection with any unauthorized modifications
to any of its public licenses or any other arrangements,
understandings, or agreements concerning use of licensed material. For
the avoidance of doubt, this paragraph does not form part of the
public licenses.

Creative Commons may be contacted at creativecommons.org.
```

### CC0-1.0

代表性全文来源：`../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/dunce-1.0.5/LICENSE`

```text
Creative Commons Legal Code

CC0 1.0 Universal

    CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM AND DOES NOT PROVIDE
    LEGAL SERVICES. DISTRIBUTION OF THIS DOCUMENT DOES NOT CREATE AN
    ATTORNEY-CLIENT RELATIONSHIP. CREATIVE COMMONS PROVIDES THIS
    INFORMATION ON AN "AS-IS" BASIS. CREATIVE COMMONS MAKES NO WARRANTIES
    REGARDING THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS
    PROVIDED HEREUNDER, AND DISCLAIMS LIABILITY FOR DAMAGES RESULTING FROM
    THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS PROVIDED
    HEREUNDER.

Statement of Purpose

The laws of most jurisdictions throughout the world automatically confer
exclusive Copyright and Related Rights (defined below) upon the creator
and subsequent owner(s) (each and all, an "owner") of an original work of
authorship and/or a database (each, a "Work").

Certain owners wish to permanently relinquish those rights to a Work for
the purpose of contributing to a commons of creative, cultural and
scientific works ("Commons") that the public can reliably and without fear
of later claims of infringement build upon, modify, incorporate in other
works, reuse and redistribute as freely as possible in any form whatsoever
and for any purposes, including without limitation commercial purposes.
These owners may contribute to the Commons to promote the ideal of a free
culture and the further production of creative, cultural and scientific
works, or to gain reputation or greater distribution for their Work in
part through the use and efforts of others.

For these and/or other purposes and motivations, and without any
expectation of additional consideration or compensation, the person
associating CC0 with a Work (the "Affirmer"), to the extent that he or she
is an owner of Copyright and Related Rights in the Work, voluntarily
elects to apply CC0 to the Work and publicly distribute the Work under its
terms, with knowledge of his or her Copyright and Related Rights in the
Work and the meaning and intended legal effect of CC0 on those rights.

1. Copyright and Related Rights. A Work made available under CC0 may be
protected by copyright and related or neighboring rights ("Copyright and
Related Rights"). Copyright and Related Rights include, but are not
limited to, the following:

  i. the right to reproduce, adapt, distribute, perform, display,
     communicate, and translate a Work;
 ii. moral rights retained by the original author(s) and/or performer(s);
iii. publicity and privacy rights pertaining to a person's image or
     likeness depicted in a Work;
 iv. rights protecting against unfair competition in regards to a Work,
     subject to the limitations in paragraph 4(a), below;
  v. rights protecting the extraction, dissemination, use and reuse of data
     in a Work;
 vi. database rights (such as those arising under Directive 96/9/EC of the
     European Parliament and of the Council of 11 March 1996 on the legal
     protection of databases, and under any national implementation
     thereof, including any amended or successor version of such
     directive); and
vii. other similar, equivalent or corresponding rights throughout the
     world based on applicable law or treaty, and any national
     implementations thereof.

2. Waiver. To the greatest extent permitted by, but not in contravention
of, applicable law, Affirmer hereby overtly, fully, permanently,
irrevocably and unconditionally waives, abandons, and surrenders all of
Affirmer's Copyright and Related Rights and associated claims and causes
of action, whether now known or unknown (including existing as well as
future claims and causes of action), in the Work (i) in all territories
worldwide, (ii) for the maximum duration provided by applicable law or
treaty (including future time extensions), (iii) in any current or future
medium and for any number of copies, and (iv) for any purpose whatsoever,
including without limitation commercial, advertising or promotional
purposes (the "Waiver"). Affirmer makes the Waiver for the benefit of each
member of the public at large and to the detriment of Affirmer's heirs and
successors, fully intending that such Waiver shall not be subject to
revocation, rescission, cancellation, termination, or any other legal or
equitable action to disrupt the quiet enjoyment of the Work by the public
as contemplated by Affirmer's express Statement of Purpose.

3. Public License Fallback. Should any part of the Waiver for any reason
be judged legally invalid or ineffective under applicable law, then the
Waiver shall be preserved to the maximum extent permitted taking into
account Affirmer's express Statement of Purpose. In addition, to the
extent the Waiver is so judged Affirmer hereby grants to each affected
person a royalty-free, non transferable, non sublicensable, non exclusive,
irrevocable and unconditional license to exercise Affirmer's Copyright and
Related Rights in the Work (i) in all territories worldwide, (ii) for the
maximum duration provided by applicable law or treaty (including future
time extensions), (iii) in any current or future medium and for any number
of copies, and (iv) for any purpose whatsoever, including without
limitation commercial, advertising or promotional purposes (the
"License"). The License shall be deemed effective as of the date CC0 was
applied by Affirmer to the Work. Should any part of the License for any
reason be judged legally invalid or ineffective under applicable law, such
partial invalidity or ineffectiveness shall not invalidate the remainder
of the License, and in such case Affirmer hereby affirms that he or she
will not (i) exercise any of his or her remaining Copyright and Related
Rights in the Work or (ii) assert any associated claims and causes of
action with respect to the Work, in either case contrary to Affirmer's
express Statement of Purpose.

4. Limitations and Disclaimers.

 a. No trademark or patent rights held by Affirmer are waived, abandoned,
    surrendered, licensed or otherwise affected by this document.
 b. Affirmer offers the Work as-is and makes no representations or
    warranties of any kind concerning the Work, express, implied,
    statutory or otherwise, including without limitation warranties of
    title, merchantability, fitness for a particular purpose, non
    infringement, or the absence of latent or other defects, accuracy, or
    the present or absence of errors, whether or not discoverable, all to
    the greatest extent permissible under applicable law.
 c. Affirmer disclaims responsibility for clearing rights of other persons
    that may apply to the Work or any use thereof, including without
    limitation any person's Copyright and Related Rights in the Work.
    Further, Affirmer disclaims responsibility for obtaining any necessary
    consents, permissions or other rights required for any use of the
    Work.
 d. Affirmer understands and acknowledges that Creative Commons is not a
    party to this document and has no duty or obligation with respect to
    this CC0 or use of the Work.
```

### ISC

代表性全文来源：`node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/lru-cache/LICENSE`

```text
The ISC License

Copyright (c) 2010-2023 Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### MIT

代表性全文来源：`node_modules/.pnpm/@asamuzakjp+css-color@3.2.0/node_modules/@asamuzakjp/css-color/LICENSE`

```text
MIT License

Copyright (c) 2024 asamuzaK (Kazz)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT-0

代表性全文来源：`node_modules/.pnpm/@csstools+color-helpers@5.1.0/node_modules/@csstools/color-helpers/LICENSE.md`

```text
MIT No Attribution (MIT-0)

Copyright © CSSTools Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MPL-2.0

代表性全文来源：`node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/LICENSE`

```text
Mozilla Public License, version 2.0

1. Definitions

1.1. "Contributor"

     means each individual or legal entity that creates, contributes to the
     creation of, or owns Covered Software.

1.2. "Contributor Version"

     means the combination of the Contributions of others (if any) used by a
     Contributor and that particular Contributor's Contribution.

1.3. "Contribution"

     means Covered Software of a particular Contributor.

1.4. "Covered Software"

     means Source Code Form to which the initial Contributor has attached the
     notice in Exhibit A, the Executable Form of such Source Code Form, and
     Modifications of such Source Code Form, in each case including portions
     thereof.

1.5. "Incompatible With Secondary Licenses"
     means

     a. that the initial Contributor has attached the notice described in
        Exhibit B to the Covered Software; or

     b. that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the terms of
        a Secondary License.

1.6. "Executable Form"

     means any form of the work other than Source Code Form.

1.7. "Larger Work"

     means a work that combines Covered Software with other material, in a
     separate file or files, that is not Covered Software.

1.8. "License"

     means this document.

1.9. "Licensable"

     means having the right to grant, to the maximum extent possible, whether
     at the time of the initial grant or subsequently, any and all of the
     rights conveyed by this License.

1.10. "Modifications"

     means any of the following:

     a. any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered Software; or

     b. any new file in Source Code Form that contains any Covered Software.

1.11. "Patent Claims" of a Contributor

      means any patent claim(s), including without limitation, method,
      process, and apparatus claims, in any patent Licensable by such
      Contributor that would be infringed, but for the grant of the License,
      by the making, using, selling, offering for sale, having made, import,
      or transfer of either its Contributions or its Contributor Version.

1.12. "Secondary License"

      means either the GNU General Public License, Version 2.0, the GNU Lesser
      General Public License, Version 2.1, the GNU Affero General Public
      License, Version 3.0, or any later versions of those licenses.

1.13. "Source Code Form"

      means the form of the work preferred for making modifications.

1.14. "You" (or "Your")

      means an individual or a legal entity exercising rights under this
      License. For legal entities, "You" includes any entity that controls, is
      controlled by, or is under common control with You. For purposes of this
      definition, "control" means (a) the power, direct or indirect, to cause
      the direction or management of such entity, whether by contract or
      otherwise, or (b) ownership of more than fifty percent (50%) of the
      outstanding shares or beneficial ownership of such entity.


2. License Grants and Conditions

2.1. Grants

     Each Contributor hereby grants You a world-wide, royalty-free,
     non-exclusive license:

     a. under intellectual property rights (other than patent or trademark)
        Licensable by such Contributor to use, reproduce, make available,
        modify, display, perform, distribute, and otherwise exploit its
        Contributions, either on an unmodified basis, with Modifications, or
        as part of a Larger Work; and

     b. under Patent Claims of such Contributor to make, use, sell, offer for
        sale, have made, import, and otherwise transfer either its
        Contributions or its Contributor Version.

2.2. Effective Date

     The licenses granted in Section 2.1 with respect to any Contribution
     become effective for each Contribution on the date the Contributor first
     distributes such Contribution.

2.3. Limitations on Grant Scope

     The licenses granted in this Section 2 are the only rights granted under
     this License. No additional rights or licenses will be implied from the
     distribution or licensing of Covered Software under this License.
     Notwithstanding Section 2.1(b) above, no patent license is granted by a
     Contributor:

     a. for any code that a Contributor has removed from Covered Software; or

     b. for infringements caused by: (i) Your and any other third party's
        modifications of Covered Software, or (ii) the combination of its
        Contributions with other software (except as part of its Contributor
        Version); or

     c. under Patent Claims infringed by Covered Software in the absence of
        its Contributions.

     This License does not grant any rights in the trademarks, service marks,
     or logos of any Contributor (except as may be necessary to comply with
     the notice requirements in Section 3.4).

2.4. Subsequent Licenses

     No Contributor makes additional grants as a result of Your choice to
     distribute the Covered Software under a subsequent version of this
     License (see Section 10.2) or under the terms of a Secondary License (if
     permitted under the terms of Section 3.3).

2.5. Representation

     Each Contributor represents that the Contributor believes its
     Contributions are its original creation(s) or it has sufficient rights to
     grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

     This License is not intended to limit any rights You have under
     applicable copyright doctrines of fair use, fair dealing, or other
     equivalents.

2.7. Conditions

     Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted in
     Section 2.1.


3. Responsibilities

3.1. Distribution of Source Form

     All distribution of Covered Software in Source Code Form, including any
     Modifications that You create or to which You contribute, must be under
     the terms of this License. You must inform recipients that the Source
     Code Form of the Covered Software is governed by the terms of this
     License, and how they can obtain a copy of this License. You may not
     attempt to alter or restrict the recipients' rights in the Source Code
     Form.

3.2. Distribution of Executable Form

     If You distribute Covered Software in Executable Form then:

     a. such Covered Software must also be made available in Source Code Form,
        as described in Section 3.1, and You must inform recipients of the
        Executable Form how they can obtain a copy of such Source Code Form by
        reasonable means in a timely manner, at a charge no more than the cost
        of distribution to the recipient; and

     b. You may distribute such Executable Form under the terms of this
        License, or sublicense it under different terms, provided that the
        license for the Executable Form does not attempt to limit or alter the
        recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

     You may create and distribute a Larger Work under terms of Your choice,
     provided that You also comply with the requirements of this License for
     the Covered Software. If the Larger Work is a combination of Covered
     Software with a work governed by one or more Secondary Licenses, and the
     Covered Software is not Incompatible With Secondary Licenses, this
     License permits You to additionally distribute such Covered Software
     under the terms of such Secondary License(s), so that the recipient of
     the Larger Work may, at their option, further distribute the Covered
     Software under the terms of either this License or such Secondary
     License(s).

3.4. Notices

     You may not remove or alter the substance of any license notices
     (including copyright notices, patent notices, disclaimers of warranty, or
     limitations of liability) contained within the Source Code Form of the
     Covered Software, except that You may alter any license notices to the
     extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

     You may choose to offer, and to charge a fee for, warranty, support,
     indemnity or liability obligations to one or more recipients of Covered
     Software. However, You may do so only on Your own behalf, and not on
     behalf of any Contributor. You must make it absolutely clear that any
     such warranty, support, indemnity, or liability obligation is offered by
     You alone, and You hereby agree to indemnify every Contributor for any
     liability incurred by such Contributor as a result of warranty, support,
     indemnity or liability terms You offer. You may include additional
     disclaimers of warranty and limitations of liability specific to any
     jurisdiction.

4. Inability to Comply Due to Statute or Regulation

   If it is impossible for You to comply with any of the terms of this License
   with respect to some or all of the Covered Software due to statute,
   judicial order, or regulation then You must: (a) comply with the terms of
   this License to the maximum extent possible; and (b) describe the
   limitations and the code they affect. Such description must be placed in a
   text file included with all distributions of the Covered Software under
   this License. Except to the extent prohibited by statute or regulation,
   such description must be sufficiently detailed for a recipient of ordinary
   skill to be able to understand it.

5. Termination

5.1. The rights granted under this License will terminate automatically if You
     fail to comply with any of its terms. However, if You become compliant,
     then the rights granted under this License from a particular Contributor
     are reinstated (a) provisionally, unless and until such Contributor
     explicitly and finally terminates Your grants, and (b) on an ongoing
     basis, if such Contributor fails to notify You of the non-compliance by
     some reasonable means prior to 60 days after You have come back into
     compliance. Moreover, Your grants from a particular Contributor are
     reinstated on an ongoing basis if such Contributor notifies You of the
     non-compliance by some reasonable means, this is the first time You have
     received notice of non-compliance with this License from such
     Contributor, and You become compliant prior to 30 days after Your receipt
     of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
     infringement claim (excluding declaratory judgment actions,
     counter-claims, and cross-claims) alleging that a Contributor Version
     directly or indirectly infringes any patent, then the rights granted to
     You by any and all Contributors for the Covered Software under Section
     2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all end user
     license agreements (excluding distributors and resellers) which have been
     validly granted by You or Your distributors under this License prior to
     termination shall survive termination.

6. Disclaimer of Warranty

   Covered Software is provided under this License on an "as is" basis,
   without warranty of any kind, either expressed, implied, or statutory,
   including, without limitation, warranties that the Covered Software is free
   of defects, merchantable, fit for a particular purpose or non-infringing.
   The entire risk as to the quality and performance of the Covered Software
   is with You. Should any Covered Software prove defective in any respect,
   You (not any Contributor) assume the cost of any necessary servicing,
   repair, or correction. This disclaimer of warranty constitutes an essential
   part of this License. No use of  any Covered Software is authorized under
   this License except under this disclaimer.

7. Limitation of Liability

   Under no circumstances and under no legal theory, whether tort (including
   negligence), contract, or otherwise, shall any Contributor, or anyone who
   distributes Covered Software as permitted above, be liable to You for any
   direct, indirect, special, incidental, or consequential damages of any
   character including, without limitation, damages for lost profits, loss of
   goodwill, work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses, even if such party shall have been
   informed of the possibility of such damages. This limitation of liability
   shall not apply to liability for death or personal injury resulting from
   such party's negligence to the extent applicable law prohibits such
   limitation. Some jurisdictions do not allow the exclusion or limitation of
   incidental or consequential damages, so this exclusion and limitation may
   not apply to You.

8. Litigation

   Any litigation relating to this License may be brought only in the courts
   of a jurisdiction where the defendant maintains its principal place of
   business and such litigation shall be governed by laws of that
   jurisdiction, without reference to its conflict-of-law provisions. Nothing
   in this Section shall prevent a party's ability to bring cross-claims or
   counter-claims.

9. Miscellaneous

   This License represents the complete agreement concerning the subject
   matter hereof. If any provision of this License is held to be
   unenforceable, such provision shall be reformed only to the extent
   necessary to make it enforceable. Any law or regulation which provides that
   the language of a contract shall be construed against the drafter shall not
   be used to construe this License against a Contributor.


10. Versions of the License

10.1. New Versions

      Mozilla Foundation is the license steward. Except as provided in Section
      10.3, no one other than the license steward has the right to modify or
      publish new versions of this License. Each version will be given a
      distinguishing version number.

10.2. Effect of New Versions

      You may distribute the Covered Software under the terms of the version
      of the License under which You originally received the Covered Software,
      or under the terms of any subsequent version published by the license
      steward.

10.3. Modified Versions

      If you create software not governed by this License, and you want to
      create a new license for such software, you may create and use a
      modified version of this License if you rename the license and remove
      any references to the name of the license steward (except to note that
      such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
      Licenses If You choose to distribute Source Code Form that is
      Incompatible With Secondary Licenses under the terms of this version of
      the License, the notice described in Exhibit B of this License must be
      attached.

Exhibit A - Source Code Form License Notice

      This Source Code Form is subject to the
      terms of the Mozilla Public License, v.
      2.0. If a copy of the MPL was not
      distributed with this file, You can
      obtain one at
      http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular file,
then You may include the notice in a location (such as a LICENSE file in a
relevant directory) where a recipient would be likely to look for such a
notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice

      This Source Code Form is "Incompatible
      With Secondary Licenses", as defined by
      the Mozilla Public License, v. 2.0.
```

### OFL-1.1

代表性全文来源：`assets/fonts/OFL-1.1.txt`

```text
This Font Software is licensed under the SIL Open Font License,
Version 1.1.

This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to
provide a free and open framework in which fonts may be shared and
improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software
components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to,
deleting, or substituting -- in part or in whole -- any of the
components of the Original Version, by changing formats or by porting
the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed,
modify, redistribute, and sell modified and unmodified copies of the
Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### OFL-1.1  license text

代表性全文来源：`assets/fonts/OFL-1.1.txt`

```text
This Font Software is licensed under the SIL Open Font License,
Version 1.1.

This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to
provide a free and open framework in which fonts may be shared and
improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software
components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to,
deleting, or substituting -- in part or in whole -- any of the
components of the Original Version, by changing formats or by porting
the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed,
modify, redistribute, and sell modified and unmodified copies of the
Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Python-2.0

代表性全文来源：`node_modules/.pnpm/argparse@2.0.1/node_modules/argparse/LICENSE`

```text
A. HISTORY OF THE SOFTWARE
==========================

Python was created in the early 1990s by Guido van Rossum at Stichting
Mathematisch Centrum (CWI, see http://www.cwi.nl) in the Netherlands
as a successor of a language called ABC.  Guido remains Python's
principal author, although it includes many contributions from others.

In 1995, Guido continued his work on Python at the Corporation for
National Research Initiatives (CNRI, see http://www.cnri.reston.va.us)
in Reston, Virginia where he released several versions of the
software.

In May 2000, Guido and the Python core development team moved to
BeOpen.com to form the BeOpen PythonLabs team.  In October of the same
year, the PythonLabs team moved to Digital Creations, which became
Zope Corporation.  In 2001, the Python Software Foundation (PSF, see
https://www.python.org/psf/) was formed, a non-profit organization
created specifically to own Python-related Intellectual Property.
Zope Corporation was a sponsoring member of the PSF.

All Python releases are Open Source (see http://www.opensource.org for
the Open Source Definition).  Historically, most, but not all, Python
releases have also been GPL-compatible; the table below summarizes
the various releases.

    Release         Derived     Year        Owner       GPL-
                    from                                compatible? (1)

    0.9.0 thru 1.2              1991-1995   CWI         yes
    1.3 thru 1.5.2  1.2         1995-1999   CNRI        yes
    1.6             1.5.2       2000        CNRI        no
    2.0             1.6         2000        BeOpen.com  no
    1.6.1           1.6         2001        CNRI        yes (2)
    2.1             2.0+1.6.1   2001        PSF         no
    2.0.1           2.0+1.6.1   2001        PSF         yes
    2.1.1           2.1+2.0.1   2001        PSF         yes
    2.1.2           2.1.1       2002        PSF         yes
    2.1.3           2.1.2       2002        PSF         yes
    2.2 and above   2.1.1       2001-now    PSF         yes

Footnotes:

(1) GPL-compatible doesn't mean that we're distributing Python under
    the GPL.  All Python licenses, unlike the GPL, let you distribute
    a modified version without making your changes open source.  The
    GPL-compatible licenses make it possible to combine Python with
    other software that is released under the GPL; the others don't.

(2) According to Richard Stallman, 1.6.1 is not GPL-compatible,
    because its license has a choice of law clause.  According to
    CNRI, however, Stallman's lawyer has told CNRI's lawyer that 1.6.1
    is "not incompatible" with the GPL.

Thanks to the many outside volunteers who have worked under Guido's
direction to make these releases possible.


B. TERMS AND CONDITIONS FOR ACCESSING OR OTHERWISE USING PYTHON
===============================================================

PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2
--------------------------------------------

1. This LICENSE AGREEMENT is between the Python Software Foundation
("PSF"), and the Individual or Organization ("Licensee") accessing and
otherwise using this software ("Python") in source or binary form and
its associated documentation.

2. Subject to the terms and conditions of this License Agreement, PSF hereby
grants Licensee a nonexclusive, royalty-free, world-wide license to reproduce,
analyze, test, perform and/or display publicly, prepare derivative works,
distribute, and otherwise use Python alone or in any derivative version,
provided, however, that PSF's License Agreement and PSF's notice of copyright,
i.e., "Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010,
2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020 Python Software Foundation;
All Rights Reserved" are retained in Python alone or in any derivative version
prepared by Licensee.

3. In the event Licensee prepares a derivative work that is based on
or incorporates Python or any part thereof, and wants to make
the derivative work available to others as provided herein, then
Licensee hereby agrees to include in any such work a brief summary of
the changes made to Python.

4. PSF is making Python available to Licensee on an "AS IS"
basis.  PSF MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PSF MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

5. PSF SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON
FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS
A RESULT OF MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON,
OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

7. Nothing in this License Agreement shall be deemed to create any
relationship of agency, partnership, or joint venture between PSF and
Licensee.  This License Agreement does not grant permission to use PSF
trademarks or trade name in a trademark sense to endorse or promote
products or services of Licensee, or any third party.

8. By copying, installing or otherwise using Python, Licensee
agrees to be bound by the terms and conditions of this License
Agreement.


BEOPEN.COM LICENSE AGREEMENT FOR PYTHON 2.0
-------------------------------------------

BEOPEN PYTHON OPEN SOURCE LICENSE AGREEMENT VERSION 1

1. This LICENSE AGREEMENT is between BeOpen.com ("BeOpen"), having an
office at 160 Saratoga Avenue, Santa Clara, CA 95051, and the
Individual or Organization ("Licensee") accessing and otherwise using
this software in source or binary form and its associated
documentation ("the Software").

2. Subject to the terms and conditions of this BeOpen Python License
Agreement, BeOpen hereby grants Licensee a non-exclusive,
royalty-free, world-wide license to reproduce, analyze, test, perform
and/or display publicly, prepare derivative works, distribute, and
otherwise use the Software alone or in any derivative version,
provided, however, that the BeOpen Python License is retained in the
Software, alone or in any derivative version prepared by Licensee.

3. BeOpen is making the Software available to Licensee on an "AS IS"
basis.  BEOPEN MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, BEOPEN MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

4. BEOPEN SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF THE
SOFTWARE FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS
AS A RESULT OF USING, MODIFYING OR DISTRIBUTING THE SOFTWARE, OR ANY
DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

5. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

6. This License Agreement shall be governed by and interpreted in all
respects by the law of the State of California, excluding conflict of
law provisions.  Nothing in this License Agreement shall be deemed to
create any relationship of agency, partnership, or joint venture
between BeOpen and Licensee.  This License Agreement does not grant
permission to use BeOpen trademarks or trade names in a trademark
sense to endorse or promote products or services of Licensee, or any
third party.  As an exception, the "BeOpen Python" logos available at
http://www.pythonlabs.com/logos.html may be used according to the
permissions granted on that web page.

7. By copying, installing or otherwise using the software, Licensee
agrees to be bound by the terms and conditions of this License
Agreement.


CNRI LICENSE AGREEMENT FOR PYTHON 1.6.1
---------------------------------------

1. This LICENSE AGREEMENT is between the Corporation for National
Research Initiatives, having an office at 1895 Preston White Drive,
Reston, VA 20191 ("CNRI"), and the Individual or Organization
("Licensee") accessing and otherwise using Python 1.6.1 software in
source or binary form and its associated documentation.

2. Subject to the terms and conditions of this License Agreement, CNRI
hereby grants Licensee a nonexclusive, royalty-free, world-wide
license to reproduce, analyze, test, perform and/or display publicly,
prepare derivative works, distribute, and otherwise use Python 1.6.1
alone or in any derivative version, provided, however, that CNRI's
License Agreement and CNRI's notice of copyright, i.e., "Copyright (c)
1995-2001 Corporation for National Research Initiatives; All Rights
Reserved" are retained in Python 1.6.1 alone or in any derivative
version prepared by Licensee.  Alternately, in lieu of CNRI's License
Agreement, Licensee may substitute the following text (omitting the
quotes): "Python 1.6.1 is made available subject to the terms and
conditions in CNRI's License Agreement.  This Agreement together with
Python 1.6.1 may be located on the Internet using the following
unique, persistent identifier (known as a handle): 1895.22/1013.  This
Agreement may also be obtained from a proxy server on the Internet
using the following URL: http://hdl.handle.net/1895.22/1013".

3. In the event Licensee prepares a derivative work that is based on
or incorporates Python 1.6.1 or any part thereof, and wants to make
the derivative work available to others as provided herein, then
Licensee hereby agrees to include in any such work a brief summary of
the changes made to Python 1.6.1.

4. CNRI is making Python 1.6.1 available to Licensee on an "AS IS"
basis.  CNRI MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, CNRI MAKES NO AND
DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON 1.6.1 WILL NOT
INFRINGE ANY THIRD PARTY RIGHTS.

5. CNRI SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON
1.6.1 FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS
A RESULT OF MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON 1.6.1,
OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material
breach of its terms and conditions.

7. This License Agreement shall be governed by the federal
intellectual property law of the United States, including without
limitation the federal copyright law, and, to the extent such
U.S. federal law does not apply, by the law of the Commonwealth of
Virginia, excluding Virginia's conflict of law provisions.
Notwithstanding the foregoing, with regard to derivative works based
on Python 1.6.1 that incorporate non-separable material that was
previously distributed under the GNU General Public License (GPL), the
law of the Commonwealth of Virginia shall govern this License
Agreement only as to issues arising under or with respect to
Paragraphs 4, 5, and 7 of this License Agreement.  Nothing in this
License Agreement shall be deemed to create any relationship of
agency, partnership, or joint venture between CNRI and Licensee.  This
License Agreement does not grant permission to use CNRI trademarks or
trade name in a trademark sense to endorse or promote products or
services of Licensee, or any third party.

8. By clicking on the "ACCEPT" button where indicated, or by copying,
installing or otherwise using Python 1.6.1, Licensee agrees to be
bound by the terms and conditions of this License Agreement.

        ACCEPT


CWI LICENSE AGREEMENT FOR PYTHON 0.9.0 THROUGH 1.2
--------------------------------------------------

Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam,
The Netherlands.  All rights reserved.

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose and without fee is hereby granted,
provided that the above copyright notice appear in all copies and that
both that copyright notice and this permission notice appear in
supporting documentation, and that the name of Stichting Mathematisch
Centrum or CWI not be used in advertising or publicity pertaining to
distribution of the software without specific, written prior
permission.

STICHTING MATHEMATISCH CENTRUM DISCLAIMS ALL WARRANTIES WITH REGARD TO
THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS, IN NO EVENT SHALL STICHTING MATHEMATISCH CENTRUM BE LIABLE
FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Unicode-3.0

代表性全文来源：`../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/icu_collections-2.3.0/LICENSE`

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2020-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0

—

Portions of ICU4X may have been adapted from ICU4C and/or ICU4J.
ICU 1.8.1 to ICU 57.1 © 1995-2016 International Business Machines Corporation and others.
```

### Unlicense

代表性全文来源：`../../.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/aho-corasick-1.1.5/COPYING`

```text
This project is dual-licensed under the Unlicense and MIT licenses.

You may use this code under the terms of either license.
```

### Zlib

代表性全文来源：`node_modules/.pnpm/@pdf-lib+fontkit@1.1.1/node_modules/pako/LICENSE`

```text
(The MIT License)

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Notes

- `Text:` 路径指构建环境中该依赖自带的许可文本文件（node_modules / cargo registry src）。
- 本候选为本地验收构建（unsigned / not published）；正式公开发布前的法律复核
  属于独立授权的发布执行任务范围。


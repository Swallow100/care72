# 第三者のライセンスと出典

ケア72 が使う依存・書体・地図とデータ・動画の道具のライセンスと出典。作品そのもののライセンスは [LICENSE](LICENSE)。

依存の決まり: 直接の依存（package.json に書く物）は MIT・Apache-2.0・OFL の物だけにする（CLAUDE.md）。足したら下の「主な依存」に書き、`npm run docs:notices` で「依存の全部」の表を作り直す。

## 主な依存（package.json に直接書いた物）

| 名前 | 用途 | ライセンス | 著作権者 |
| --- | --- | --- | --- |
| next | 画面とサーバーの枠（App Router） | MIT | Vercel, Inc. |
| react・react-dom | 画面 | MIT | Meta Platforms, Inc. and affiliates |
| @opennextjs/cloudflare | Next.js を Cloudflare Workers で動かす | MIT | Cloudflare, Inc. |
| @anthropic-ai/sdk | Claude を呼ぶ（lib/claude） | Apache-2.0 | Anthropic, PBC |
| @google/genai | Gemini TTS で声を作る（lib/gemini。fetch だけで動く web の入口を使う） | Apache-2.0 | Google LLC |
| zod | Claude の返す JSON の形を書き、返った物を検査する | MIT | Colin McDonnell |
| qrcode-generator | QR の点の並び（lib/qr/image.ts）。SVG はこちらで描く | MIT | Kazuhiko Arase |
| fast-xml-parser | 気象庁の防災情報 XML を読む（lib/jma/xml.ts。Workers には DOMParser が無いので）。間接の依存の is-unsafe は package.json の overrides で 2.0.2 に固定 | MIT | Amit Kumar Gupta |
| @heroicons/react | 操作のアイコン（components/ui/Icon.tsx） | MIT | Tailwind Labs, Inc. |
| pdfjs-dist | 黒塗りの画面で、選んだ PDF の頭の 3 頁をブラウザの中で画像にする（lib/redact/browser.ts）。PDF を選んだときだけ読み込む | Apache-2.0 | Mozilla Foundation |
| wrangler・@cloudflare/workers-types | Workers の設定と手元の D1・R2 の模擬、D1・R2 の型（開発） | MIT OR Apache-2.0 | Cloudflare, Inc. |
| tailwindcss・@tailwindcss/postcss・postcss | 見た目、CSS の処理（開発。作った CSS は配信に入る） | MIT | Tailwind Labs, Inc.・Andrey Sitnik |
| typescript | 型（開発） | Apache-2.0 | Microsoft Corporation |
| @types/node・@types/react・@types/react-dom | 型（開発） | MIT | Microsoft Corporation |
| vitest | テスト（開発） | MIT | VoidZero Inc. and Vitest contributors |
| puppeteer-core | 紙面の印刷の確かめ（手元の Chrome・Edge で印刷して PDF の頁数を数える。開発。Chrome は同梱しない） | Apache-2.0 | Google LLC（The Chromium Authors） |
| @modelcontextprotocol/sdk | 手元の MCP サーバー（tools/mcp/care72-local。開発） | MIT | Anthropic, PBC |

## 依存の全部

package-lock.json に載り、この端末で `npm ci` したときに入った物を、node_modules の各 package.json の license の欄と LICENSE・NOTICE の著作権の行（無ければ author の欄）から機械で集めた。OS ごとの任意の依存（`@esbuild/*`・`@img/sharp-*`・workerd の OS 版など）は、build する端末で入れ替わる。

MIT・Apache-2.0 のほかに入っている物:

- ISC・BSD-2-Clause・BSD-3-Clause・0BSD・BlueOak-1.0.0（glob・minimatch など）・CC0-1.0・Unlicense: どれも著作権の表示を残せば使える許諾型。
- CC-BY-4.0: caniuse-lite（build のときにブラウザの対応を調べる表。browserslist から使う）。データは caniuse.com（Alexis Deveria）。
- Apache-2.0 AND LGPL-3.0-or-later: @img/sharp-win32-x64（next の画像の最適化の任意の依存 sharp の、libvips を含む Windows 用の部品）。ケア72 は画像の最適化を使わず、Workers の配信には入らない。
- MPL-2.0: lightningcss（tailwindcss が build のときに CSS を処理する。開発だけ）。
- next は自分の中に写した依存を持ち、それぞれのライセンスは `node_modules/next/dist/compiled/` の下にある。

<!-- deps:start -->
<!-- この間は tools/licenses/notices.mjs が書く。手で直さない -->

### 配信と build に使う依存（package.json の dependencies とその依存、400 件）

内訳: MIT 238・Apache-2.0 101・ISC 21・BSD-3-Clause 20・BlueOak-1.0.0 7・MIT OR Apache-2.0 4・BSD-2-Clause 4・Apache-2.0 AND LGPL-3.0-or-later 1・CC0-1.0 1・CC-BY-4.0 1・Unlicense 1・0BSD 1。太字は package.json に直接書いた物。

| 名前 | 版 | ライセンス | 著作権者 |
| --- | --- | --- | --- |
| **@anthropic-ai/sdk** | 1.3.0 | Apache-2.0 | Copyright 2023 Anthropic, PBC. |
| @ast-grep/napi | 0.45.3 | MIT | Copyright (c) 2020 N-API for Rust |
| @ast-grep/napi-win32-x64-msvc | 0.45.3 | MIT | （記載なし。github.com/ast-grep/ast-grep） |
| @aws-crypto/sha1-browser | 5.2.0 | Apache-2.0 | AWS Crypto Tools Team |
| @aws-crypto/sha256-browser | 5.2.0 | Apache-2.0 | AWS Crypto Tools Team |
| @aws-crypto/sha256-js | 5.2.0 | Apache-2.0 | AWS Crypto Tools Team |
| @aws-crypto/supports-web-crypto | 5.2.0 | Apache-2.0 | AWS Crypto Tools Team |
| @aws-crypto/util | 5.2.0 | Apache-2.0 | AWS Crypto Tools Team |
| @aws-sdk/checksums | 3.1002.1 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-cloudfront | 3.984.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-dynamodb | 3.984.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-lambda | 3.984.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-s3 | 3.984.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-sqs | 3.984.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/core | 3.979.1 | Apache-2.0 | Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-env | 3.972.80 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 | AWS SDK for JavaScript Team |
| @aws-sdk/credential-provider-ini | 3.973.25 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 | AWS SDK for JavaScript Team |
| @aws-sdk/credential-provider-node | 3.972.92 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-process | 3.972.80 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-sso | 3.973.24 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-web-identity | 3.972.86 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/dynamodb-codec | 3.973.54 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/endpoint-cache | 3.972.11 | Apache-2.0 | Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-bucket-endpoint | 3.972.58 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-endpoint-discovery | 3.972.37 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-expect-continue | 3.972.54 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-flexible-checksums | 3.974.64 | Apache-2.0 | Copyright 2018-2022 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-host-header | 3.972.55 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-location-constraint | 3.972.51 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-logger | 3.972.54 | Apache-2.0 | Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-recursion-detection | 3.972.56 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-sdk-s3 | 3.972.85 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-sdk-sqs | 3.972.48 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-ssec | 3.972.51 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-user-agent | 3.972.84 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 | AWS SDK for JavaScript Team |
| @aws-sdk/region-config-resolver | 3.972.58 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/signature-v4-multi-region | 3.984.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/signature-v4-multi-region | 3.996.51 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/token-providers | 3.1161.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/types | 3.975.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-endpoints | 3.984.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-locate-window | 3.965.10 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-user-agent-browser | 3.972.55 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-user-agent-node | 3.973.70 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/xml-builder | 3.972.42 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 | Amazon Web Services |
| @babel/runtime | 7.29.10 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @cloudflare/kv-asset-handler | 0.5.0 | MIT OR Apache-2.0 | wrangler@cloudflare.com |
| @cloudflare/unenv-preset | 2.16.2 | MIT OR Apache-2.0 | （記載なし。github.com/cloudflare/workers-sdk） |
| @cloudflare/workerd-windows-64 | 1.20261101.1 | Apache-2.0 | （記載なし。github.com/cloudflare/workerd） |
| **@cloudflare/workers-types** | 5.20261102.1 | MIT OR Apache-2.0 | Cloudflare Workers DevProd Team |
| @cspotcode/source-map-support | 0.8.1 | MIT | Copyright (c) 2014 Evan Wallace |
| @dotenvx/dotenvx | 2.38.2 | BSD-3-Clause | Copyright (c) 2024, Scott Motte |
| @dotenvx/primitives | 3.3.1 | BSD-3-Clause | Copyright (c) 2024, Scott Motte |
| @dotenvx/primitives | 4.3.0 | BSD-3-Clause | Copyright (c) 2024, Scott Motte |
| @dotenvx/providers | 0.3.13 | BSD-3-Clause | Copyright (c) 2024, Scott Motte |
| @dotenvx/tooling | 1.0.6 | BSD-3-Clause | Copyright (c) 2026, Scott Motte |
| @esbuild/win32-x64 | 0.28.2 | MIT | （記載なし。github.com/evanw/esbuild） |
| **@google/genai** | 2.32.0 | Apache-2.0 | Copyright 2025 Google LLC |
| **@heroicons/react** | 2.2.0 | MIT | Copyright (c) Tailwind Labs, Inc. |
| @hono/node-server | 2.1.5 | MIT | Copyright (c) 2022 - present, Yusuke Wada and Hono contributors |
| @img/colour | 1.1.0 | MIT | Copyright (c) 2012 Heather Arthur / Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com>. |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Lovell Fuller |
| @isaacs/cliui | 8.0.2 | ISC | Copyright (c) 2015, Contributors |
| @jridgewell/gen-mapping | 0.3.13 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/resolve-uri | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> |
| @jridgewell/source-map | 0.3.11 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping | 0.3.9 | MIT | Copyright 2022 Justin Ridgewell <justin@ridgewell.name> |
| **@modelcontextprotocol/sdk** | 1.32.2 | MIT | Copyright (c) 2024 Anthropic, PBC |
| @napi-rs/canvas | 1.1.0 | MIT | Copyright (c) 2020 lynweklm@gmail.com / Copyright 2015 The Chromium Authors |
| @napi-rs/canvas-win32-x64-msvc | 1.1.0 | MIT | （記載なし。github.com/Brooooooklyn/canvas） |
| @next/env | 16.4.3 | MIT | Next.js Team |
| @next/swc-win32-x64-msvc | 16.4.3 | MIT | （記載なし。github.com/vercel/next） |
| @nodable/entities | 3.1.0 | MIT | Amit Gupta |
| @node-minify/core | 9.0.2 | MIT | Copyright (c) 2024 Rodolphe Stoclin |
| @node-minify/terser | 9.0.1 | MIT | Copyright (c) 2024 Rodolphe Stoclin |
| @node-minify/utils | 9.0.1 | MIT | Copyright (c) 2024 Rodolphe Stoclin |
| @opennextjs/aws | 4.1.14 | MIT | Copyright (c) 2022 SST |
| **@opennextjs/cloudflare** | 1.20.15 | MIT | Copyright (c) 2020 Cloudflare, Inc. |
| @opentelemetry/api | 1.10.0 | Apache-2.0 | OpenTelemetry Authors |
| @pkgjs/parseargs | 0.11.0 | MIT | （記載なし。github.com/pkgjs/parseargs） |
| @poppinss/colors | 4.1.6 | MIT | Copyright 2021 Harminder Virk, contributors |
| @poppinss/dumper | 0.6.5 | MIT | Copyright (c) 2023 |
| @poppinss/exception | 1.2.3 | MIT | Copyright (c) 2023 |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| @sindresorhus/is | 7.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| @smithy/config-resolver | 4.7.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/core | 3.38.1 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/eventstream-serde-browser | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/eventstream-serde-config-resolver | 4.6.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/eventstream-serde-node | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/hash-blob-browser | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/hash-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/hash-stream-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/invalid-dependency | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/is-array-buffer | 2.2.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/md5-js | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-content-length | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-endpoint | 4.7.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-retry | 4.8.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-serde | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-stack | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/node-config-provider | 4.6.2 | Apache-2.0 | Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/node-http-handler | 4.14.1 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/protocol-http | 5.6.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/signature-v4 | 5.7.5 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/smithy-client | 4.15.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/types | 4.19.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/url-parser | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-base64 | 4.6.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-body-length-browser | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-body-length-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-buffer-from | 2.2.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-defaults-mode-browser | 4.6.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-defaults-mode-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-endpoints | 3.7.2 | Apache-2.0 | Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-middleware | 4.5.2 | Apache-2.0 | Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-retry | 4.6.2 | Apache-2.0 | Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-stream | 4.8.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-utf8 | 2.3.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-utf8 | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-waiter | 4.6.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @speed-highlight/core | 1.2.24 | CC0-1.0 | matubu |
| @stablelib/base64 | 1.0.1 | MIT | Copyright (C) 2016 Dmitry Chestnykh |
| @swc/helpers | 0.5.23 | Apache-2.0 | Copyright 2024 SWC contributors. |
| @tsconfig/node18 | 18.2.7 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node | 18.19.130 | MIT | Copyright (c) Microsoft Corporation. |
| **@types/node** | 24.19.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node-fetch | 2.6.13 | MIT | Copyright (c) Microsoft Corporation. |
| @types/retry | 0.12.0 | MIT | Copyright (c) Microsoft Corporation. All rights reserved. |
| abort-controller | 3.0.0 | MIT | Copyright (c) 2017 Toru Nagashima |
| accepts | 2.0.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| acorn | 8.19.0 | MIT | Copyright (C) 2012-2022 by various contributors (see AUTHORS) |
| agent-base | 7.1.4 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |
| agentkeepalive | 4.6.0 | MIT | Copyright(c) node-modules and other contributors. / Copyright(c) 2012 - 2015 fengmk2 <fengmk2@gmail.com> |
| ajv | 8.20.0 | MIT | Copyright (c) 2015-2021 Evgeny Poberezkin |
| ajv-formats | 3.0.1 | MIT | Copyright (c) 2020 Evgeny Poberezkin |
| ansi-colors | 4.1.3 | MIT | Copyright (c) 2015-present, Brian Woodward. |
| ansi-regex | 5.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| ansi-regex | 6.5.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| ansi-styles | 4.3.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| ansi-styles | 6.2.3 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| anynum | 1.0.1 | MIT | Copyright (c) 2026 Natural Intelligence |
| array-timsort | 1.0.3 | MIT | Copyright (c) 2015 Marco Ziccardi |
| asynckit | 0.4.0 | MIT | Copyright (c) 2016 Alex Indigo |
| aws4fetch | 1.0.20 | MIT | Copyright 2018 Michael Hart (michael.hart.au@gmail.com) |
| balanced-match | 1.0.2 | MIT | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| balanced-match | 4.0.4 | MIT | （記載なし。github.com/juliangruber/balanced-match） |
| base64-js | 1.5.1 | MIT | Copyright (c) 2014 Jameson Little |
| baseline-browser-mapping | 2.11.34 | Apache-2.0 | （記載なし。github.com/web-platform-dx/baseline-browser-mapping） |
| bignumber.js | 9.3.1 | MIT | Copyright © `<2025>` `Michael Mclaughlin` |
| blake3-wasm | 2.1.5 | MIT | Copyright (c) 2019 Connor Peet |
| body-parser | 2.4.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| bowser | 2.15.0 | MIT | Copyright 2015, Dustin Diaz (the "Original Author") |
| brace-expansion | 2.1.7 | MIT | Copyright (c) 2013 Julian Gruber <julian@juliangruber.com> |
| brace-expansion | 5.0.12 | MIT | （記載なし。github.com/juliangruber/brace-expansion） |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause | Copyright (c) 2013, GoInstant Inc., a salesforce.com company |
| buffer-from | 1.1.2 | MIT | Copyright (c) 2016, 2018 Linus Unnebäck |
| bytes | 3.1.2 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca> / Copyright (c) 2015 Jed Watson <jed.watson@me.com> |
| call-bind-apply-helpers | 1.0.2 | MIT | Copyright (c) 2024 Jordan Harband |
| call-bound | 1.0.4 | MIT | Copyright (c) 2024 Jordan Harband |
| caniuse-lite | 1.0.30001820 | CC-BY-4.0 | Ben Briggs |
| chalk | 5.6.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| ci-info | 4.4.0 | MIT | Copyright (c) 2016 Thomas Watson Steen |
| client-only | 0.0.1 | MIT | （記載なし） |
| cliui | 9.0.1 | ISC | Copyright (c) 2015, Contributors |
| cloudflare | 4.5.0 | Apache-2.0 | Copyright 2025 Cloudflare |
| color-convert | 2.0.1 | MIT | Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com> |
| color-name | 1.1.4 | MIT | Copyright (c) 2015 Dmitry Ivanov |
| combined-stream | 1.0.8 | MIT | Copyright (c) 2011 Debuggable Limited <felix@debuggable.com> |
| commander | 2.20.3 | MIT | Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca> |
| comment-json | 4.6.2 | MIT | Copyright (c) 2013 kaelzhang <>, contributors |
| content-disposition | 2.0.1 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| content-type | 1.0.5 | MIT | Copyright (c) 2015 Douglas Christopher Wilson |
| content-type | 2.1.0 | MIT | Copyright (c) 2015 Douglas Christopher Wilson |
| cookie | 0.7.2 | MIT | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| cookie | 1.1.1 | MIT | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| cookie-signature | 1.2.2 | MIT | Copyright (c) 2012–2024 LearnBoost <tj@learnboost.com> and other contributors; |
| cors | 2.8.6 | MIT | Copyright (c) 2013 Troy Goode <troygoode@gmail.com> |
| cross-spawn | 7.0.6 | MIT | Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio> |
| data-uri-to-buffer | 4.0.1 | MIT | Nathan Rajlich |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> / Copyright (c) 2018-2021 Josh Junon |
| delayed-stream | 1.0.0 | MIT | Copyright (c) 2011 Debuggable Limited <felix@debuggable.com> |
| depd | 2.0.0 | MIT | Copyright (c) 2014-2018 Douglas Christopher Wilson |
| detect-libc | 2.1.2 | Apache-2.0 | Lovell Fuller |
| dunder-proto | 1.0.1 | MIT | Copyright (c) 2024 ECMAScript Shims |
| duplexer | 0.1.2 | MIT | Copyright (c) 2012 Raynos. |
| eastasianwidth | 0.2.0 | MIT | Masaki Komagata |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 | Copyright 2015 D2L Corporation |
| ee-first | 1.1.1 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com |
| emoji-regex | 10.6.0 | MIT | Mathias Bynens |
| emoji-regex | 8.0.0 | MIT | Mathias Bynens |
| emoji-regex | 9.2.2 | MIT | Mathias Bynens |
| encodeurl | 2.0.1 | MIT | Copyright (c) 2016 Douglas Christopher Wilson |
| enquirer | 2.4.1 | MIT | Copyright (c) 2016-present, Jon Schlinkert. |
| error-stack-parser-es | 1.0.5 | MIT | Copyright (c) 2023-PRESENT Anthony Fu <https://github.com/antfu> / Copyright (c) 2017 Eric Wendelin and other contributors |
| es-define-property | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband |
| es-errors | 1.3.0 | MIT | Copyright (c) 2024 Jordan Harband |
| es-object-atoms | 1.1.2 | MIT | Copyright (c) 2024 Jordan Harband |
| es-set-tostringtag | 2.1.0 | MIT | Copyright (c) 2022 ECMAScript Shims |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| escalade | 3.2.0 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| escape-html | 1.0.3 | MIT | Copyright (c) 2012-2013 TJ Holowaychuk / Copyright (c) 2015 Andreas Lubbe |
| esprima | 4.0.1 | BSD-2-Clause | Copyright JS Foundation and other contributors, https://js.foundation/ |
| etag | 1.8.1 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson |
| event-target-shim | 5.0.1 | MIT | Copyright (c) 2015 Toru Nagashima |
| eventsource | 3.0.7 | MIT | Copyright (c) EventSource GitHub organisation |
| eventsource-parser | 3.1.1 | MIT | Copyright (c) 2026 Espen Hovlandsdal <espen@hovlandsdal.com> |
| express | 5.3.0 | MIT | Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca> / Copyright (c) 2013-2014 Roman Shtylman <shtylman+expressjs@gmail.com> |
| express-rate-limit | 8.7.2 | MIT | Copyright 2023 Nathan Friedly, Vedant K |
| extend | 3.0.2 | MIT | Copyright (c) 2014 Stefan Thomas |
| fast-deep-equal | 3.1.3 | MIT | Copyright (c) 2017 Evgeny Poberezkin |
| fast-sha256 | 1.3.0 | Unlicense | Dmitry Chestnykh |
| fast-uri | 3.1.9 | BSD-3-Clause | Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae / Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team> |
| fast-xml-builder | 1.3.1 | MIT | Copyright (c) 2026 Natural Intelligence |
| **fast-xml-parser** | 5.11.2 | MIT | Copyright (c) 2017 Amit Kumar Gupta |
| fetch-blob | 3.2.0 | MIT | Copyright (c) 2019 David Frank |
| finalhandler | 2.1.1 | MIT | Copyright (c) 2014-2022 Douglas Christopher Wilson <doug@somethingdoug.com> |
| foreground-child | 3.3.1 | ISC | Copyright (c) 2015-2023 Isaac Z. Schlueter and Contributors |
| form-data | 4.0.6 | MIT | Copyright (c) 2012 Felix Geisendörfer (felix@debuggable.com) and contributors |
| form-data-encoder | 1.7.2 | MIT | Copyright (c) 2021-present Nick K. |
| formdata-node | 4.4.1 | MIT | Copyright (c) 2017-present Nick K. |
| formdata-polyfill | 4.0.10 | MIT | Copyright (c) 2016 Jimmy Karl Roland Wärting |
| forwarded | 0.2.0 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| fresh | 2.0.0 | MIT | Copyright (c) 2012 TJ Holowaychuk <tj@vision-media.ca> / Copyright (c) 2016-2017 Douglas Christopher Wilson <doug@somethingdoug.com> |
| function-bind | 1.1.2 | MIT | Copyright (c) 2013 Raynos. |
| gaxios | 7.3.1 | Apache-2.0 | Google, LLC |
| gcp-metadata | 8.1.2 | Apache-2.0 | Google LLC |
| get-caller-file | 2.0.5 | ISC | Copyright 2018 Stefan Penner |
| get-east-asian-width | 1.7.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| get-intrinsic | 1.3.0 | MIT | Copyright (c) 2020 Jordan Harband |
| get-proto | 1.0.1 | MIT | Copyright (c) 2025 Jordan Harband |
| glob | 10.3.3 | ISC | Copyright (c) 2009-2023 Isaac Z. Schlueter and Contributors |
| glob | 13.0.6 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| google-auth-library | 10.9.1 | Apache-2.0 | Google Inc. |
| google-logging-utils | 1.1.3 | Apache-2.0 | Google API Authors |
| gopd | 1.2.0 | MIT | Copyright (c) 2022 Jordan Harband |
| gzip-size | 6.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| has-symbols | 1.1.0 | MIT | Copyright (c) 2016 Jordan Harband |
| has-tostringtag | 1.0.2 | MIT | Copyright (c) 2021 Inspect JS |
| hasown | 2.0.4 | MIT | Copyright (c) Jordan Harband and contributors |
| hono | 4.13.16 | MIT | Copyright (c) 2021 - present, Yusuke Wada and Hono contributors |
| http-errors | 2.0.1 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com / Copyright (c) 2016 Douglas Christopher Wilson doug@somethingdoug.com |
| https-proxy-agent | 7.0.6 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |
| humanize-ms | 1.2.1 | MIT | dead-horse |
| iconv-lite | 0.7.3 | MIT | Copyright (c) 2011 Alexander Shtuchkin |
| imurmurhash | 0.1.4 | MIT | Jens Taylor |
| inherits | 2.0.4 | ISC | Copyright (c) Isaac Z. Schlueter |
| ip-address | 10.7.5 | MIT | Copyright (C) 2011 by Beau Gunderson |
| ipaddr.js | 1.9.1 | MIT | Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org> |
| is-fullwidth-code-point | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| is-promise | 4.0.0 | MIT | Copyright (c) 2014 Forbes Lindesay |
| is-unsafe | 2.0.2 | MIT | Copyright (c) 2026 Natural Intelligence |
| isexe | 2.0.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| jackspeak | 2.3.6 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| jose | 6.2.15 | MIT | Copyright (c) 2018 Filip Skokan |
| json-bigint | 1.0.0 | MIT | Copyright (c) 2013 Andrey Sidorov |
| json-schema-to-ts | 3.1.1 | MIT | Copyright (c) 2020 Thomas Aribart |
| json-schema-traverse | 1.0.0 | MIT | Copyright (c) 2017 Evgeny Poberezkin |
| json-schema-typed | 8.0.2 | BSD-2-Clause | Remy Rylan |
| jwa | 2.0.1 | MIT | Copyright (c) 2013 Brian J. Brennan |
| jws | 4.0.1 | MIT | Copyright (c) 2013 Brian J. Brennan |
| kleur | 4.1.5 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| long | 5.3.2 | Apache-2.0 | Daniel Wirtz |
| lru-cache | 10.4.3 | ISC | Copyright (c) 2010-2023 Isaac Z. Schlueter and Contributors |
| lru-cache | 11.5.3 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| math-intrinsics | 1.1.0 | MIT | Copyright (c) 2024 ECMAScript Shims |
| media-typer | 1.1.1 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| merge-descriptors | 2.0.0 | MIT | Copyright (c) Jonathan Ong <me@jongleberry.com> / Copyright (c) Douglas Christopher Wilson <doug@somethingdoug.com> |
| mime-db | 1.52.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015-2022 Douglas Christopher Wilson <doug@somethingdoug.com> |
| mime-db | 1.54.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015-2022 Douglas Christopher Wilson <doug@somethingdoug.com> |
| mime-types | 2.1.35 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| mime-types | 3.0.2 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| miniflare | 5.20261101.0-beta | MIT | MrBBot |
| minimatch | 10.2.6 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| minimatch | 9.0.9 | ISC | Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors |
| minipass | 7.1.3 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| mkdirp | 3.0.1 | MIT | Copyright (c) 2011-2023 James Halliday (mail@substack.net) and Isaac Z. Schlueter (i@izs.me) |
| mnemonist | 0.38.3 | MIT | Copyright (c) 2016 Guillaume Plique (Yomguithereal) |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |
| nanoid | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |
| negotiator | 1.1.0 | MIT | Copyright (c) 2012-2014 Federico Romero / Copyright (c) 2012-2014 Isaac Z. Schlueter |
| **next** | 16.4.3 | MIT | Copyright (c) 2025 Vercel, Inc. |
| node-domexception | 1.0.0 | MIT | Copyright (c) 2021 Jimmy Wärting |
| node-fetch | 2.7.0 | MIT | Copyright (c) 2016 David Frank |
| node-fetch | 3.3.2 | MIT | Copyright (c) 2016 - 2020 Node Fetch Team |
| object-assign | 4.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| object-inspect | 1.13.4 | MIT | Copyright (c) 2013 James Halliday |
| obliterator | 1.6.1 | MIT | Copyright (c) 2017 Guillaume Plique (Yomguithereal) |
| on-finished | 2.4.2 | MIT | Copyright (c) 2013 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2014 Douglas Christopher Wilson <doug@somethingdoug.com> |
| once | 1.4.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| p-retry | 4.6.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| parseurl | 1.3.3 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2014-2017 Douglas Christopher Wilson <doug@somethingdoug.com> |
| path-expression-matcher | 1.6.2 | MIT | Copyright (c) 2024 |
| path-key | 3.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| path-scurry | 1.11.1 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | Isaac Z. Schlueter |
| path-to-regexp | 6.3.0 | MIT | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) |
| path-to-regexp | 8.4.2 | MIT | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) |
| pathe | 2.0.3 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> - Daniel Roe <daniel@roe.dev> / Copyright Joyent, Inc. and other Node contributors. |
| **pdfjs-dist** | 6.4.299 | Apache-2.0 | Copyright 2024 Mozilla Foundation |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| pkce-challenge | 5.0.1 | MIT | Copyright (c) 2019 |
| postcss | 8.5.23 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |
| protobufjs | 7.6.6 | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz All rights reserved. |
| proxy-addr | 2.0.8 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson |
| **qrcode-generator** | 2.0.4 | MIT | Kazuhiko Arase |
| qs | 6.17.1 | BSD-3-Clause | Copyright (c) 2014, Nathan LaFreniere and other [contributors](https://github.com/ljharb/qs/graphs/contributors) |
| range-parser | 1.3.0 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca> / Copyright (c) 2015-2016 Douglas Christopher Wilson <doug@somethingdoug.com |
| raw-body | 3.0.2 | MIT | Copyright (c) 2013-2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2014-2022 Douglas Christopher Wilson <doug@somethingdoug.com> |
| **react** | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| **react-dom** | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| require-from-string | 2.0.2 | MIT | Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop) |
| retry | 0.13.1 | MIT | Copyright (c) 2011: |
| router | 2.2.0 | MIT | Copyright (c) 2013 Roman Shtylman / Copyright (c) 2014-2022 Douglas Christopher Wilson |
| safe-buffer | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh |
| safer-buffer | 2.1.2 | MIT | Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com> |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| semver | 7.8.5 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| send | 1.2.1 | MIT | Copyright (c) 2012 TJ Holowaychuk / Copyright (c) 2014-2022 Douglas Christopher Wilson |
| serve-static | 2.2.1 | MIT | Copyright (c) 2010 Sencha Inc. / Copyright (c) 2011 LearnBoost |
| setprototypeof | 1.2.0 | ISC | Copyright (c) 2015, Wes Todd |
| sharp | 0.35.5 | Apache-2.0 | Lovell Fuller |
| shebang-command | 2.0.0 | MIT | Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva) |
| shebang-regex | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| side-channel | 1.1.1 | MIT | Copyright (c) 2019 Jordan Harband |
| side-channel-list | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband |
| side-channel-map | 1.0.1 | MIT | Copyright (c) 2024 Jordan Harband |
| side-channel-weakmap | 1.0.2 | MIT | Copyright (c) 2019 Jordan Harband |
| signal-exit | 4.1.0 | ISC | Copyright (c) 2015-2023 Benjamin Coe, Isaac Z. Schlueter, and Contributors |
| source-map | 0.6.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| source-map-support | 0.5.21 | MIT | Copyright (c) 2014 Evan Wallace |
| standardwebhooks | 1.1.1 | MIT | Standard Webhooks |
| statuses | 2.0.2 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com> |
| string-width | 4.2.3 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| string-width | 5.1.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| string-width | 7.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| string-width | 8.3.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| string-width-cjs | 4.2.3 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| strip-ansi | 6.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| strip-ansi | 7.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| strip-ansi-cjs | 6.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| strnum | 2.5.1 | MIT | Copyright (c) 2021 Natural Intelligence |
| styled-jsx | 5.1.6 | MIT | Copyright (c) 2016-present Vercel, Inc. |
| supports-color | 10.2.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| terser | 5.36.0 | BSD-2-Clause | Copyright 2012-2018 (c) Mihai Bazon <mihai.bazon@gmail.com> |
| toidentifier | 1.0.1 | MIT | Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com> |
| tr46 | 0.0.3 | MIT | Sebastian Mayr |
| ts-algebra | 2.0.0 | MIT | Copyright (c) 2020 Thomas Aribart |
| ts-tqdm | 0.8.6 | MIT | Copyright (c) 2023 Leandro Del'Arco |
| tslib | 2.9.1 | 0BSD | Copyright (c) Microsoft Corporation. |
| type-is | 2.1.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> / Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| undici | 6.29.1 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| undici | 7.30.1 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| undici-types | 5.26.5 | MIT | （記載なし。github.com/nodejs/undici） |
| undici-types | 7.24.6 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| unenv | 2.0.0-rc.24 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> |
| unpipe | 1.0.0 | MIT | Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| urlpattern-polyfill | 10.1.0 | MIT | Copyright 2020 Intel Corporation |
| vary | 1.1.2 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| web-streams-polyfill | 3.3.3 | MIT | Copyright (c) 2024 Mattias Buelens / Copyright (c) 2016 Diwank Singh Tomer |
| web-streams-polyfill | 4.0.0-beta.3 | MIT | Copyright (c) 2021 Mattias Buelens / Copyright (c) 2016 Diwank Singh Tomer |
| webidl-conversions | 3.0.1 | BSD-2-Clause | Copyright (c) 2014, Domenic Denicola |
| whatwg-url | 5.0.0 | MIT | Copyright (c) 2015–2016 Sebastian Mayr |
| which | 2.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| workerd | 1.20261101.1 | Apache-2.0 | （記載なし。github.com/cloudflare/workerd） |
| **wrangler** | 4.156.1 | MIT OR Apache-2.0 | wrangler@cloudflare.com |
| wrap-ansi | 8.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| wrap-ansi | 9.0.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| wrap-ansi-cjs | 7.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| wrappy | 1.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| write-file-atomic | 5.0.1 | ISC | Copyright (c) 2015, Rebecca Turner |
| ws | 8.21.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> / Copyright (c) 2013 Arnout Kazemier and contributors |
| xml-naming | 0.3.0 | MIT | Copyright (c) 2026 Natural Intelligence |
| y18n | 5.0.8 | ISC | Copyright (c) 2015, Contributors |
| yaml | 2.9.1 | ISC | Eemeli Aro |
| yargs | 18.2.0 | MIT | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) |
| yargs-parser | 22.0.0 | ISC | Copyright (c) 2016, Contributors |
| yocto-spinner | 1.2.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| yoctocolors | 2.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| youch | 4.1.0-beta.10 | MIT | Copyright (c) 2023 |
| youch-core | 0.3.3 | MIT | Copyright (c) 2024 |
| **zod** | 4.6.7 | MIT | Copyright (c) 2025 Colin McDonnell |
| zod-to-json-schema | 3.25.2 | ISC | Copyright (c) 2020, Stefan Terdell |

### 開発の道具（devDependencies だけが使う物、55 件）

内訳: MIT 43・Apache-2.0 6・MPL-2.0 4・BSD-3-Clause 1・ISC 1。配信の Worker には入らない（tailwindcss が作った CSS だけは配信に入る）。

| 名前 | 版 | ライセンス | 著作権者 |
| --- | --- | --- | --- |
| @alloc/quick-lru | 5.3.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |
| @jridgewell/remapping | 2.3.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @oxc-project/types | 0.156.0 | MIT | Copyright (c) 2024-present VoidZero Inc. & Contributors / Copyright (c) 2023 Boshen |
| @puppeteer/browsers | 3.2.6 | Apache-2.0 | The Chromium Authors |
| @rolldown/binding-win32-x64-msvc | 1.2.16 | MIT | （記載なし。github.com/rolldown/rolldown） |
| @rolldown/pluginutils | 1.0.1 | MIT | Copyright (c) 2026-present, rolldown/plugins repository contributors |
| @tailwindcss/node | 4.3.3 | MIT | Copyright (c) Tailwind Labs, Inc. |
| @tailwindcss/oxide | 4.3.3 | MIT | Copyright (c) Tailwind Labs, Inc. |
| @tailwindcss/oxide-win32-x64-msvc | 4.3.3 | MIT | Copyright (c) Tailwind Labs, Inc. |
| **@tailwindcss/postcss** | 4.3.3 | MIT | Copyright (c) Tailwind Labs, Inc. |
| @types/chai | 5.2.3 | MIT | Copyright (c) Microsoft Corporation. |
| @types/deep-eql | 4.0.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/estree | 1.0.10 | MIT | Copyright (c) Microsoft Corporation. |
| **@types/react** | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| **@types/react-dom** | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @vitest/mocker | 5.0.5 | MIT | Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors |
| @vitest/spy | 5.0.5 | MIT | Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors |
| assertion-error | 2.0.1 | MIT | Copyright (c) 2013 Jake Luer jake@qualiancy.com (http://qualiancy.com) |
| chai | 6.3.0 | MIT | Copyright (c) 2017 Chai.js Assertion Library |
| chromium-bidi | 157.0.8090-0 | Apache-2.0 | The Chromium Authors |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| devtools-protocol | 0.0.1704951 | BSD-3-Clause | The Chromium Authors |
| enhanced-resolve | 5.26.0 | MIT | Copyright JS Foundation and other contributors |
| es-module-lexer | 2.3.2 | MIT | Copyright (C) 2018-2022 Guy Bedford |
| estree-walker | 3.0.3 | MIT | Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors) |
| expect-type | 1.4.0 | Apache-2.0 | Copyright 2024 Misha Kaletsky |
| fdir | 6.5.0 | MIT | Copyright 2023 Abdullah Atta |
| graceful-fs | 4.2.11 | ISC | Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors |
| jiti | 2.7.0 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> |
| lightningcss | 1.32.0 | MPL-2.0 | （記載なし。github.com/parcel-bundler/lightningcss） |
| lightningcss | 1.33.0 | MPL-2.0 | （記載なし。github.com/parcel-bundler/lightningcss） |
| lightningcss-win32-x64-msvc | 1.32.0 | MPL-2.0 | （記載なし。github.com/parcel-bundler/lightningcss） |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | （記載なし。github.com/parcel-bundler/lightningcss） |
| magic-string | 0.30.21 | MIT | Copyright 2018 Rich Harris |
| magic-string | 1.4.5 | MIT | Copyright 2018 Rich Harris |
| mitt | 3.0.1 | MIT | Copyright (c) 2021 Jason Miller |
| modern-tar | 0.8.6 | MIT | Copyright (c) 2025 Ayuhito |
| obug | 3.0.0 | MIT | Copyright © 2025-PRESENT Kevin Deng (https://github.com/sxzz) / Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |
| **postcss** | 8.5.32 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |
| **puppeteer-core** | 25.16.0 | Apache-2.0 | The Chromium Authors |
| rolldown | 1.2.16 | MIT | Copyright (c) 2024-present VoidZero Inc. & Contributors |
| std-env | 4.3.0 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> |
| **tailwindcss** | 4.3.3 | MIT | Copyright (c) Tailwind Labs, Inc. |
| tapable | 2.3.3 | MIT | Copyright JS Foundation and other contributors |
| tinybench | 6.2.3 | MIT | Copyright (c) 2022 Tinylibs |
| tinyexec | 1.3.1 | MIT | Copyright (c) 2024 Tinylibs |
| tinyglobby | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán |
| typed-query-selector | 2.12.3 | MIT | Copyright (c) 2020-present Pig Fang |
| **typescript** | 5.9.3 | Apache-2.0 | Microsoft Corp. |
| vite | 8.3.5 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| **vitest** | 5.0.5 | MIT | Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors |
| webdriver-bidi-protocol | 1.0.1 | Apache-2.0 | Copyright 2024 Google Inc. |
| why-is-node-running | 3.2.1 | MIT | Copyright (c) 2016 Mathias Buus |
| ws | 8.22.1 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> / Copyright (c) 2013 Arnout Kazemier and contributors |

<!-- deps:end -->

## 書体

画面の日本語は端末の書体（Hiragino Sans・Yu Gothic UI・Meiryo）で、配信に入れない。次の 3 つは next/font/google が build のときに Google Fonts から取り込み、配信の静的ファイルとして配る。動画（video/）は書き出しのときに Google Fonts の CSS から Inter と BIZ UDPGothic を読む。

| 書体 | 使う所 | ライセンス | 著作権の表示（Google Fonts の OFL.txt のまま） |
| --- | --- | --- | --- |
| Inter | 画面の英数字（数字を等幅にして表の縦を揃える） | SIL Open Font License 1.1 | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) |
| BIZ UDPGothic | 本人・家族のスマホ、本人の 1 枚、書類の紙面 | SIL Open Font License 1.1 | Copyright 2022 The BIZ UDGothic Project Authors (https://github.com/googlefonts/morisawa-biz-ud-mincho) |
| BIZ UDPMincho | 書類の紙面で、元の様式が明朝の字（計画書の題・同意の問い・注など） | SIL Open Font License 1.1 | Copyright 2022 The BIZ UDMincho Project Authors (https://github.com/googlefonts/morisawa-biz-ud-mincho) |

SIL Open Font License 1.1 の全文はこのファイルの末尾。

## 地図とデータ（画面とサーバーが外から読む物。リポジトリにも build にも入れない）

| 名前 | 使う所 | 条件と出典の表示 |
| --- | --- | --- |
| 地理院タイル（淡色地図） | 担当一覧と事業所の地図の下の地図（components/map。タイルを並べる計算は lib/map/geo.ts） | 国土地理院コンテンツ利用規約。ウェブでその場で読み込むときは出典の明示（「地理院タイル」と地理院タイル一覧 https://maps.gsi.go.jp/development/ichiran.html へのリンク）で申請は要らない。地図の下に出典を出す |
| 重ねるハザードマップ（洪水浸水想定区域〔想定最大規模〕・土砂災害警戒区域・津波浸水想定） | 地図に透過して重ねる層（lib/map/layers.ts） | ハザードマップポータルサイトのオープンデータ（https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html）。出典「ハザードマップポータルサイト」と層ごとの作成者を地図の下に出す。土砂災害警戒区域は「国土交通省政策統括官付地理空間情報課『国土数値情報（土砂災害警戒区域）』をもとに国土地理院が加工」と、国土数値情報の利用規約・都道府県の条件 |
| 気象庁 防災情報XML（PULL 型のフィード extra.xml・eqvol.xml と電文） | 事業所の画面の警報・注意報と地震。Workers の cron が 5 分ごとに 1 か所で取って D1 に写す（lib/jma） | 気象庁ホームページのコンテンツ利用規約（https://www.jma.go.jp/jma/kishou/info/coment.html、公共データ利用規約 第1.0版）。加工せず、出典「気象庁ホームページ（https://www.jma.go.jp/bosai/warning/）、気象庁防災情報XML」を出す |
| 気象庁 降水ナウキャストのタイルと凡例の画像 | 本物の事業所の地図の雨雲（旗 JMA_NOWCAST が on のときだけ） | 同上。加工せず重ね、凡例も気象庁のまま。出典「雨雲：気象庁ホームページ（https://www.jma.go.jp/bosai/nowc/）／背景：地理院タイル」 |

lib/jma/fixtures/sample の XML は、防災情報 XML の形に合わせて作った見本で、気象庁の電文の写しではない。

## 様式と出典の資料（リンクだけ。PDF はリポジトリに入れない）

書類の欄の名前と順はコードに持ち、元の PDF はリンクする。引用は短くし、出典を付ける。

| 資料 | 発行 | 使う所 |
| --- | --- | --- |
| 松山市 個別避難計画書の様式 | 松山市 | lib/forms/matsuyama.ts（欄の名前と順） |
| 避難行動要支援者の避難行動支援に関する取組指針（個別避難計画の様式例を含む） | 内閣府（防災担当） | lib/forms の計画書の既定、出典の登録簿 |
| 介護施設・事業所における自然災害発生時の業務継続ガイドラインと様式集（様式 9） | 厚生労働省老健局 | lib/forms/form9.ts（列の名前と順） |
| 医療機器プログラムの該当性の事例 | 厚生労働省 | 設計の線引き（docs/DECISIONS.md） |
| 難病・呼吸器・透析・糖尿病・循環器・認知症・肺血栓塞栓症・災害診療記録の指針と手引き | 学会・研究班・厚生労働省 | 台帳の時計と骨格の段の根拠 |

出典の登録簿の全部（発行・題・URL・使う範囲・確かめた日）は lib/sources/index.ts にあり、[docs/SOURCES.md](docs/SOURCES.md) に書き出してある。

## 動画の編集の道具（video/。アプリの依存にも build にも配信にも入らない）

提出の動画を組む枠。`video/package.json` はこのフォルダだけの物で、ルートの依存とは別。

| 名前 | 用途 | ライセンス |
| --- | --- | --- |
| remotion・@remotion/cli（4.0.539） | 動画の編集の枠と書き出し | Remotion License（MIT ではない） |
| react・react-dom | 動画の画面 | MIT |
| typescript・@types/react | 型 | Apache-2.0・MIT |

Remotion License（4.0.539 の LICENSE.md、https://github.com/remotion-dev/remotion/blob/v4.0.539/LICENSE.md）の Free License は、次のどれかに当たる者が無料で使える: 「an individual」「a for-profit organization with up to 3 employees」「a non-profit or not-for-profit organization」「evaluating whether Remotion is a good fit, and are not yet using it in a commercial way」。これに当たらない営利の団体は Company License が要る。許される使い方は動画と画像を作ること（商用を含む）と、自分の用途のための改変。Remotion の改変版を売る・貸す・再許諾することは許されない。著作権の表示は「Copyright © 2026 Remotion」。

間接の依存（`video/package-lock.json` の license の欄）は MIT 239・ISC 18・BSD-2-Clause 9・BSD-3-Clause 6・Apache-2.0 5・MPL-2.0 4（mediabunny）・Unlicense 2・0BSD 1・CC-BY-4.0 1（caniuse-lite）・Python-2.0 1（argparse）と、Remotion の部品（@remotion/bundler・renderer・player・web-renderer ほか。Remotion License）、書き出しに使う ffmpeg を含む @remotion/compositor の OS 版（license の欄なし）。動画の素材（録画・声・音楽・生成画像）の出典は docs/video/MATERIALS.md。

## SIL Open Font License 1.1

Inter・BIZ UDPGothic・BIZ UDPMincho に掛かる許諾の全文（https://openfontlicense.org）。

```text
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

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

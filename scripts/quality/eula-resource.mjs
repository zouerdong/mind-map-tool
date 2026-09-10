// eula-resource.mjs — 根 LICENSE → DMG 挂载前 EULA resource（PRR-069C / ADR 0013 v1.1.0）。
//
// 交付物是 `hdiutil udifrez -xml <file> '' -quiet <image>` 接受的一份 UDIF resource XML：
//   TEXT 5000 "English"  = 根 LICENSE 的原始字节（base64），保证 EULA 内容与法律文本字节级同源；
//   LPic / STR# / TMPL / styl = Apple 标准许可证面板固定资源（按钮、语言表、样式），
//   取自已验证可用的 create-dmg eula-resources-template.xml。
//
// 本模块不做任何文件系统写入，也不调用外部命令：只做字节 → XML 与 XML → 字节的纯转换，
// 供 assemble-dmg.mjs 生成 resource、并在装配后从最终 DMG 复算 EULA 绑定。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** 挂载前 EULA 正文的资源槽位（与作废 Tauri 候选 DMG 及 create-dmg 模板一致）。 */
export const EULA_TEXT_RESOURCE = Object.freeze({
  type: "TEXT",
  id: "5000",
  name: "English",
});

const RESOURCE_ATTRS = "0x0000";

// Apple 标准许可证面板资源：语言/按钮表、图片槽、样式表、模板。内容固定，不随 LICENSE 变化。
const FIXED_RESOURCES = Object.freeze({
  LPic: [{ attributes: RESOURCE_ATTRS, id: "5000", name: "", data: "AAAAAgAAAAAAAAAAAAQAAA==" }],
  "STR#": [
    {
      attributes: RESOURCE_ATTRS,
      id: "5000",
      name: "English buttons",
      data:
        "AAYNRW5nbGlzaCB0ZXN0MQVBZ3JlZQhEaXNhZ3JlZQVQcmludAdTYXZlLi4ueklmIHlvdSBhZ3JlZSB3aXRoIHRoZSB0" +
        "ZXJtcyBvZiB0aGlzIGxpY2Vuc2UsIGNsaWNrICJBZ3JlZSIgdG8gYWNjZXNzIHRoZSBzb2Z0d2FyZS4gIElmIHlvdSBk" +
        "byBub3QgYWdyZWUsIHByZXNzICJEaXNhZ3JlZS4i",
    },
    {
      attributes: RESOURCE_ATTRS,
      id: "5002",
      name: "English",
      data:
        "AAYHRW5nbGlzaAVBZ3JlZQhEaXNhZ3JlZQVQcmludAdTYXZlLi4ue0lmIHlvdSBhZ3JlZSB3aXRoIHRoZSB0ZXJtcyBv" +
        "ZiB0aGlzIGxpY2Vuc2UsIHByZXNzICJBZ3JlZSIgdG8gaW5zdGFsbCB0aGUgc29mdHdhcmUuICBJZiB5b3UgZG8gbm90" +
        "IGFncmVlLCBwcmVzcyAiRGlzYWdyZWUiLg==",
    },
  ],
  TMPL: [
    {
      attributes: RESOURCE_ATTRS,
      id: "128",
      name: "LPic",
      data:
        "E0RlZmF1bHQgTGFuZ3VhZ2UgSUREV1JEBUNvdW50T0NOVAQqKioqTFNUQwtzeXMgbGFuZyBJRERXUkQebG9jYWwgcmVz" +
        "IElEIChvZmZzZXQgZnJvbSA1MDAwRFdSRBAyLWJ5dGUgbGFuZ3VhZ2U/RFdSRAQqKioqTFNURQ==",
    },
  ],
  styl: [
    {
      attributes: RESOURCE_ATTRS,
      id: "5000",
      name: "English",
      data: "AAMAAAAAAAwACQAUAAAAAAAAAAAAAAAAACcADAAJABQBAAAAAAAAAAAAAAAAKgAMAAkAFAAAAAAAAAAAAAA=",
    },
  ],
});

/** 把 base64 按 52 字符折行，贴近 hdiutil 自己输出的排版。 */
function wrapBase64(b64) {
  return b64.replace(/.{52}/g, "$&\n\t\t\t");
}

function renderResource(kind, entries) {
  const body = entries
    .map(
      (entry) => `\t\t<dict>
\t\t\t<key>Attributes</key>
\t\t\t<string>${entry.attributes}</string>
\t\t\t<key>Data</key>
\t\t\t<data>
\t\t\t${entry.data}
\t\t\t</data>
\t\t\t<key>ID</key>
\t\t\t<string>${entry.id}</string>
\t\t\t<key>Name</key>
\t\t\t<string>${entry.name}</string>
\t\t</dict>`,
    )
    .join("\n");
  return `\t<key>${kind}</key>\n\t<array>\n${body}\n\t</array>`;
}

/**
 * 用根 LICENSE 字节生成 UDIF resource XML。
 * @param {Buffer} licenseBytes LICENSE 原始字节（不做任何换行/编码改写）
 * @returns {{ xml: string, licenseSha256: string, licenseBytes: number }}
 */
export function buildLicenseResourceXml(licenseBytes) {
  if (!Buffer.isBuffer(licenseBytes) || licenseBytes.length === 0) {
    throw new Error("LICENSE 字节为空或不是 Buffer");
  }
  const sections = Object.entries(FIXED_RESOURCES).map(([kind, entries]) =>
    renderResource(kind, entries),
  );
  sections.push(
    renderResource(EULA_TEXT_RESOURCE.type, [
      {
        attributes: RESOURCE_ATTRS,
        id: EULA_TEXT_RESOURCE.id,
        name: EULA_TEXT_RESOURCE.name,
        data: wrapBase64(licenseBytes.toString("base64")),
      },
    ]),
  );
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${sections.join("\n")}
</dict>
</plist>
`,
    licenseSha256: sha256(licenseBytes),
    licenseBytes: licenseBytes.length,
  };
}

export function buildLicenseResourceXmlFromFile(licensePath) {
  return buildLicenseResourceXml(readFileSync(licensePath));
}

/**
 * 从 `hdiutil udifderez -xml` 输出中取出 EULA 正文资源字节。
 * 缺失 TEXT 5000 时抛错（fail-closed），不返回空 buffer。
 */
export function extractEulaTextFromRezXml(rezXml) {
  if (typeof rezXml !== "string" || rezXml.length === 0) {
    throw new Error("udifderez 输出为空，无法复算 EULA");
  }
  const section = new RegExp(
    `<key>${EULA_TEXT_RESOURCE.type}</key>\\s*<array>([\\s\\S]*?)</array>`,
  ).exec(rezXml);
  if (!section) {
    throw new Error(`udifderez 输出中没有 ${EULA_TEXT_RESOURCE.type} 资源段，EULA 缺失`);
  }
  for (const dict of section[1].matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
    const body = dict[1];
    const id = /<key>ID<\/key>\s*<string>([^<]*)<\/string>/.exec(body)?.[1];
    if (id !== EULA_TEXT_RESOURCE.id) continue;
    const data = /<key>Data<\/key>\s*<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/.exec(body)?.[1];
    if (!data) throw new Error(`${EULA_TEXT_RESOURCE.type} ${id} 资源没有 Data 字段`);
    return Buffer.from(data.replace(/\s+/g, ""), "base64");
  }
  throw new Error(`udifderez 输出中没有 ${EULA_TEXT_RESOURCE.type} ID ${EULA_TEXT_RESOURCE.id}`);
}

/**
 * EULA 是否已被镜像声明：hdiutil imageinfo 的机器可读字段。
 * 真实 hdiutil 输出的该行带前导制表符（`\tSoftware License Agreement: true`），
 * 因此必须容忍行首空白，不能按行首精确匹配。
 */
export function imageInfoDeclaresLicenseAgreement(imageInfoStdout) {
  return /^\s*Software License Agreement:\s*true\s*$/im.test(imageInfoStdout);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

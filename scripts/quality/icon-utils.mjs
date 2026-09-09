// icon-utils.mjs — PRR-068 图标二进制工具：ICNS 严格解析/规范化、PNG IHDR、ICO 基本校验。
// 仅使用 Node 标准库（Node >= 24）；供 verify-icons / generate-icons / 测试复用。
// 注意：ICNS 规范化只重排完整 chunk（按 type、chunk bytes 稳定排序），
// 不重编码图片、不删除任何槽位；结果必须仍可由 iconutil 解包。

import { createHash } from "node:crypto";

/** 计算字节 SHA-256（hex）。 */
export function computeSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 严格解析 ICNS 容器。Fail-closed：
 * - header 魔数必须是 "icns"；
 * - 总长度字段必须与文件长度一致；
 * - 每个 chunk 长度字段 >= 8（含自身 8 字节 header）且不越界；
 * - chunk 序列必须恰好铺满文件（无剩余字节、无缺口）。
 * 抛错即视为非法。返回 { total, chunks: [{ type, length, data }] }。
 */
export function parseIcns(bytes) {
  if (bytes.length < 8) throw new Error("ICNS 文件小于 8 字节（缺 header）");
  if (bytes.toString("latin1", 0, 4) !== "icns")
    throw new Error(`ICNS header 魔数错误（实际 "${bytes.toString("latin1", 0, 4)}"）`);
  const total = bytes.readUInt32BE(4);
  if (total !== bytes.length)
    throw new Error(`ICNS 总长度字段 ${total} 与文件长度 ${bytes.length} 不一致`);
  const chunks = [];
  let off = 8;
  while (off < bytes.length) {
    if (off + 8 > bytes.length) throw new Error(`ICNS chunk header 越界（offset ${off}）`);
    const type = bytes.toString("latin1", off, off + 4);
    const length = bytes.readUInt32BE(off + 4);
    if (length < 8) throw new Error(`ICNS chunk ${type} 长度 ${length} < 8（过短）`);
    if (off + length > bytes.length)
      throw new Error(`ICNS chunk ${type} 越界（offset ${off}，length ${length}）`);
    chunks.push({ type, length, data: bytes.subarray(off + 8, off + length) });
    off += length;
  }
  if (off !== bytes.length)
    throw new Error(`ICNS chunk 覆盖不完整（末尾剩余 ${bytes.length - off} 字节）`);
  return { total, chunks };
}

/**
 * 规范化 ICNS：解析后按 (chunk type, chunk data bytes) 稳定排序整个 chunk 重写。
 * 排序键先比 type（4 字节），相同时按 data 字节字典序——完全确定性。
 * 返回规范化后的 Buffer。
 */
export function canonicalIcns(bytes) {
  const { chunks } = parseIcns(bytes);
  const sorted = [...chunks].sort((a, b) => {
    if (a.type < b.type) return -1;
    if (a.type > b.type) return 1;
    return Buffer.compare(a.data, b.data);
  });
  let total = 8;
  for (const chunk of sorted) total += 8 + chunk.data.length;
  const out = Buffer.alloc(total);
  out.write("icns", 0, "latin1");
  out.writeUInt32BE(total, 4);
  let off = 8;
  for (const chunk of sorted) {
    out.write(chunk.type, off, "latin1");
    out.writeUInt32BE(8 + chunk.data.length, off + 4);
    chunk.data.copy(out, off + 8);
    off += 8 + chunk.data.length;
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 读取 PNG IHDR（签名 + IHDR 头）。抛错即非法。
 * 返回 { width, height, bitDepth, colorType }；colorType 6=RGBA，4=grayscale+alpha。
 */
export function readPngIhdr(bytes) {
  if (bytes.length < 33) throw new Error("PNG 小于 33 字节（缺 IHDR）");
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error(`PNG 签名错误（第 ${i} 字节）`);
  }
  if (bytes.toString("latin1", 12, 16) !== "IHDR") throw new Error("PNG IHDR 块缺失");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

/**
 * 基本解析 ICO（Windows 移植入口所需）。Fail-closed：
 * - header reserved==0、type==1、count>0；
 * - 目录项不越界、图像数据区间不越界、无零字节图像。
 * 返回 { count, entries: [{ width, height, bytesInRes, dataOff }] }（8bit 中 0 表示 256）。
 */
export function parseIco(bytes) {
  if (bytes.length < 6) throw new Error("ICO 小于 6 字节（缺 header）");
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1)
    throw new Error(
      `ICO header 错误（reserved=${bytes.readUInt16LE(0)}, type=${bytes.readUInt16LE(2)}）`,
    );
  const count = bytes.readUInt16LE(4);
  if (count === 0) throw new Error("ICO 目录项数量为 0");
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > bytes.length) throw new Error(`ICO 第 ${i} 个目录项越界`);
    const bytesInRes = bytes.readUInt32LE(off + 8);
    const dataOff = bytes.readUInt32LE(off + 12);
    if (bytesInRes === 0) throw new Error(`ICO 第 ${i} 个图像零字节`);
    if (dataOff + bytesInRes > bytes.length)
      throw new Error(`ICO 第 ${i} 个图像数据越界（offset ${dataOff}，len ${bytesInRes}）`);
    entries.push({
      width: bytes[off] === 0 ? 256 : bytes[off],
      height: bytes[off + 1] === 0 ? 256 : bytes[off + 1],
      bytesInRes,
      dataOff,
    });
  }
  return { count, entries };
}

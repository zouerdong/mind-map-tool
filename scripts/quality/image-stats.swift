// MRT-004W2R R7：截图最小有效性检查（零依赖，系统 Swift + CoreGraphics）。
// 用法：swift scripts/quality/image-stats.swift <png>...
// 输出（TSV）：path<TAB>sha256<TAB>width<TAB>height<TAB>meanLuma<TAB>nonDarkRatio<TAB>verdict
// verdict 判定（E2 runner 复用同一阈值）：
//   - nonDarkRatio（亮度 > 32/255 的采样像素占比）< 0.02 → DARK（近全黑，
//     无法辨认窗口内容——W2R-F6 实测的失效模式）；
//   - meanLuma > 250 → BLANK-WHITE（近全白，同样无法辨认）；
//   - 其余 VALID（最终人工复核仍按任务卡要求执行，本工具只挡明显废片）。
// 跨场景完全重复由 runner 以 SHA-256 去重（本工具顺带输出哈希）。

import Foundation
import CoreGraphics
import ImageIO

func sha256(of data: Data) -> String {
  // 系统无 CommonCrypto 直接接口给 Swift script;用 Process 谲 shasum 保持零依赖。
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum")
  p.arguments = ["-a", "256"]
  let inPipe = Pipe()
  let outPipe = Pipe()
  p.standardInput = inPipe
  p.standardOutput = outPipe
  try? p.run()
  inPipe.fileHandleForWriting.write(data)
  inPipe.fileHandleForWriting.closeFile()
  p.waitUntilExit()
  let out = String(data: outPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return out.split(separator: " ").first.map(String.init) ?? "?"
}

func stats(of url: URL) -> (w: Int, h: Int, mean: Double, nonDark: Double)? {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
  let w = min(img.width, 480), h = min(img.height, 480)
  guard w > 0, h > 0 else { return nil }
  var pixels = [UInt8](repeating: 0, count: w * h * 4)
  let cs = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(
    data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var total = 0.0, dark = 0.0
  for i in stride(from: 0, to: pixels.count, by: 4) {
    let luma = 0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1]) + 0.0722 * Double(pixels[i + 2])
    total += luma
    if luma <= 32 { dark += 1 }
  }
  let n = Double(w * h)
  return (w: img.width, h: img.height, mean: total / n, nonDark: (n - dark) / n)
}

let files = CommandLine.arguments.dropFirst()
// --allow-white：窗口区域截图允许近全白（空白画布合法）；BLANK-WHITE
// 判定仅用于整屏截图（整屏废片检测）。DARK 判定两者都生效。
let allowWhite = files.contains("--allow-white")
let paths = files.filter { !$0.hasPrefix("--") }
if paths.isEmpty {
  fputs("usage: swift image-stats.swift [--allow-white] <png>...\n", stderr)
  exit(2)
}
var bad = false
print("path\tsha256\twidth\theight\tmeanLuma\tnonDarkRatio\tverdict")
for f in paths {
  let url = URL(fileURLWithPath: f)
  guard let data = try? Data(contentsOf: url), let s = stats(of: url) else {
    print("\(f)\t?\t?\t?\t?\t?\tUNREADABLE")
    bad = true
    continue
  }
  let digest = sha256(of: data)
  let verdict: String
  if s.nonDark < 0.02 { verdict = "DARK"; bad = true }
  else if s.mean > 250 && !allowWhite { verdict = "BLANK-WHITE"; bad = true }
  else { verdict = "VALID" }
  print("\(f)\t\(digest)\t\(s.w)\t\(s.h)\t\(String(format: "%.1f", s.mean))\t\(String(format: "%.3f", s.nonDark))\t\(verdict)")
}
exit(bad ? 1 : 0)

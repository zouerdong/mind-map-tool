// MRT-004W2R Phase E 环境探针：macOS 辅助权限事实（零依赖）。
// 用法：
//   swift scripts/quality/permission-probe.swift           # 只探测（不弹窗）
//   swift scripts/quality/permission-probe.swift --request # 触发系统授权请求
// 输出（TSV）：item\tgranted(0/1)\tnote
// 探测项：
//   screen-capture  Screen Recording（screencapture 内容截图；R7 截图有效性前提）
//   accessibility   Accessibility（System Events AX / CGEvent 合成输入）
//   input-monitor   Input Monitoring（键盘事件监听）

import Foundation
import CoreGraphics
import ApplicationServices
import IOKit.hid

let request = CommandLine.arguments.contains("--request")

func line(_ item: String, _ granted: Bool, _ note: String) {
  print("\(item)\t\(granted ? 1 : 0)\t\(note)")
}

// Screen Recording
if #available(macOS 10.15, *) {
  let pre = CGPreflightScreenCaptureAccess()
  if pre {
    line("screen-capture", true, "preflight granted")
  } else if request {
    let got = CGRequestScreenCaptureAccess() // 弹系统请求（用户在场时可点允许）
    line("screen-capture", got, got ? "granted after request" : "denied/pending user approval")
  } else {
    line("screen-capture", false, "not granted（screencapture 将得到纯黑画面）")
  }
} else {
  line("screen-capture", true, "macOS < 10.15 不适用")
}

// Accessibility
var options: CFDictionary?
if request {
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
  let trusted = AXIsProcessTrustedWithOptions(opts) // 弹系统设置指引
  line("accessibility", trusted, trusted ? "granted" : "denied/pending（请求已弹出）")
} else {
  let trusted = AXIsProcessTrusted()
  line("accessibility", trusted, trusted ? "granted" : "not granted（AX 枚举/合成输入不可用）")
}

// Input Monitoring
let input = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
line("input-monitor", input == kIOHIDAccessTypeGranted, "\(input.rawValue)")

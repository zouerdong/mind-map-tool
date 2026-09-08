# Pre-Release Evidence

本目录存放 Mind Map Tool v1 发布前收口批次（PRC 批次）的审计账本。2026-09-07 独立审阅已判定旧候选与放行结论无效；本目录当前不包含有效放行证据。

## 文件索引

- `source-change-ledger-2026-09-07.json`：PRC-000 建立的源码变更账本，覆盖脏工作树中所有变更路径的批次来源、所有者、发布归属分类和处置意图。

## 被审阅拒绝的旧候选（REJECTED_BY_REVIEW，只读审计）

以下候选被 2026-09-07 全面代码审阅判定为 `REJECTED_BY_REVIEW`，只保留审计用途。禁止修改其 JSON 让它"看起来合格"，禁止把新证据写回旧 manifest，禁止在发布输入中引用：

| 项 | 值 |
| --- | --- |
| source commit | `541d38ceebe15b272689450072f6195b2440b2b5` |
| `.app` SHA-256 | `240153e5c053ae8afeed118f55ff3d812997bf7f7112c20e794d7bc80ae7ebc4` |
| `.dmg` SHA-256 | `9a410ad8b8ee0f269cfe9ffd201ccec9b5d8563f8dcdc05128121c3d908b8fe0` |
| `.dmg` size | `28,011,310` B（超 ADR 0006 25MB 预算） |
| 位置（git 忽略） | `.tmp/release-candidate/` |
| 拒绝依据 | [pre-release-code-review-2026-09-07.md](../../pre-release-code-review-2026-09-07.md)（RLS-001～RLS-014） |

旧 PRC-090 交接包只存在于被忽略的 `.tmp/release-candidate/release-handoff-packet-v1.md`，其 `READY_TO_RELEASE` 已被[全面代码审阅](../../pre-release-code-review-2026-09-07.md)推翻，不得作为发布输入。PRR-070/080 只负责生成并冻结新 source commit、新 candidate hash 与验收证据；新的发布交接包只能在 PRR-090 独立验收 `ACCEPT` 后生成。

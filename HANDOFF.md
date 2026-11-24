# HANDOFF — Purple 音乐工作室（dev/music-studio-v1）

更新：2026-11-24（Claude 接手 Codex 中断的工作）

## 已完成
- 现场恢复：确认仓库在 work/purple-audit，分支 dev/music-studio-v1（基于 acc680a），已备份到 ../backup-before-claude-takeover/；Fork（fsan70056-ctrl/purple）已存在。
- 修复 Codex 半成品：use-strudel.ts 导入/解构、superdough-worklet 路径、main.tsx 导入、security-headers 测试。
- 本地构建配置 apps/web/vite.local.config.ts；dev/build/preview 脚本改用它（Cloudflare 版为 dev:cloudflare/build:cloudflare）。
- P3 WAV 导出：packages/ui/src/wav-recorder.ts（ScriptProcessor 抓取输出，16-bit PCM，上限 5 分钟）+ 单元测试；界面“录制 WAV”按钮。
- 本地起始曲目（纯合成器，不含授权不明采样）：packages/core/src/local-starter-patterns.ts。
- P4 中文化：主界面、agent-card、purple-app、编辑器/可视化标签。

## 普通用户创作模式（2026-11-24，已完成，待验收）
- 默认首页 `/` = 创作模式；原代码编辑器移到高级模式 `/studio`（分享链接 `/?s=` 仍进入编辑器，功能不变）。高级模式顶栏有“← 创作模式”。
- 创作页：文字描述框（可不填，带 4 个示例）、曲风 6 种（Lo-fi/流行/电子舞曲/空灵氛围/电影感/复古放克）、情绪 5 种、BPM 60–180、乐器 6 类多选、时长 30秒/1/2/3分钟。
- 编曲引擎 packages/core/src/composer.ts：纯规则，按参数+种子拼出 Strudel 代码；只用 sawtooth/triangle/sine/square 与白噪声鼓，无采样、无网络、无付费 API；同参数同种子结果相同，“重新生成”换种子。
- 描述解析 = 关键词匹配，不是 AI。认不出时明确提示，并给“复制给外部 AI 的编曲指令”；要歌词/人声会明确说明不支持并忽略；钢琴/吉他等会提示用合成音色代替。
- 试听/停止/重新生成/保存（进高级模式作品库）/导出 WAV（实时录制所选时长，可取消，带进度）。
- 新手引导：首次打开弹 3 步引导（localStorage `purple.create-guide.v1`），顶部可随时“新手引导”重看；页面本身 ①②③ 分步。
- 新文件：packages/core/src/composer.ts、packages/ui/src/composer.test.ts、apps/web/src/components/create-mode.tsx；改动：purple-app.tsx（路由）、purple-studio.tsx（返回链接）、styles.css（.mk-* 样式，勿用 cm- 前缀，会撞 CodeMirror）。
- 验证：定向测试 4 个文件 141 项通过（含 30 种曲风×情绪组合均能求值并只请求内置音色）；core/ui/web tsc 通过；本地构建通过；预览中实测创作/重新生成/保存/停止/导出 WAV（30.04 秒、48kHz 立体声 16 位、无削波）、未识别提示、歌词提示、手机宽度无横向溢出、高级模式往返。
- 未验证：真人试听音质（尤其合成鼓）、真机手机、各浏览器（仅 Chrome）。

## 进行中 / 未完成
- patterns 页、分享/反馈对话框尚未中文化；高级模式界面仍偏程序员化（本轮未改）。
- 创作模式暂无“作品列表”页，已保存作品在高级模式的作品库里。
- 播放音质、WAV 实际听感需人工试听（目前仅自动化+构建验证）。

## 验证结果（outputs/claude-verify-*.log）
- 定向测试：3 个文件 100 项全部通过（wav-recorder、strudel-examples、security-headers）。
- tsc --noEmit：core / ui / web 均通过。
- 本地构建通过，已同步到 work/preview-dist。

## Git / 远程
- origin = 原作者仓库 ferdousbhai/purple（**禁止推送**）；fork = fsan70056-ctrl/purple（你的 Fork，已确认存在，master=acc680a）。
- 2026-11-24 已推送 dev/music-studio-v1 到 fork（fork 的 master 仍为 acc680a，未改动；origin 未推送）。PR 链接未创建。
- 只推送 dev/music-studio-v1 到 fork；不改 main/master。命令：`git push fork dev/music-studio-v1`
- 三个提交已审查：仅文本源码，无二进制/音频/采样文件，无密钥或 token；起始曲目为纯合成器。
- 锁文件根因：沙箱挂载默认禁止删除文件，git 提交时无法删除自己的 .lock/tmp_obj，导致残留。解决：用 device_request_delete_permission 经用户批准开启删除权限（已完成），**不要**用 mv 改名作常规办法。在 Windows 本机直接用 git 不受影响。

## 已知问题
- 仅合成音色；分享、反馈、托管 MCP 本地不可用（依赖 Cloudflare 后端）。
- ScriptProcessorNode 已被标记弃用（为避免改 CSP 选用），以后可换 AudioWorklet。
- 工作区 CRLF、索引 LF：已设置仓库本地 core.autocrlf=input，编辑文件请保持 LF。
- 不要重跑 outputs/implement-stage2.mjs（已部分应用）。

## 启动方式
- 预览：outputs\start-preview.ps1（http://127.0.0.1:3000/）；重建：双击 outputs\claude-verify.bat（测试+类型检查+构建+刷新预览）或 outputs\rebuild-preview.ps1。

## 下一步
1. 用户验收创作模式：戴耳机试听各曲风，调整节奏/音量平衡。
2. 补全剩余界面中文化（小改动）。
3. 经用户许可后再推送到 fsan70056-ctrl/purple；不商业化，授权不明音源不得进公开版本（Strudel AGPL-3.0+，Purple MIT）。

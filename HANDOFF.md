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

## 虚拟歌手技术验证（voice-lab，独立于工作室代码）

位置：`../../voice-lab/`（不在本仓库内，未提交；模型与大文件不得入库）。未改动任何音乐工作室核心代码。

### 环境
- CPU：AMD Ryzen 7 7730U（8 核 16 线程）；GPU：集成 Radeon（约 512MB 专用显存）→ 无 CUDA，全程 CPU 推理；内存 15.3GB（采样时空闲约 3.4GB）；Windows 11；C 盘剩余 37.7GB。
- 方案：OpenUtau 0.1.576 便携版（MIT）+ DiffSinger 渲染器（ONNX，CPU）+ 声库 绮萱 Qixuan v2.7.0 + 社区声码器 PC-NSF-HiFiGAN 2025.02。

### 授权结论（个人研究可用）
- 绮萱：允许个人/商业使用其输出；公开发布须标明「AI 合成」并署名「绮萱」「DiffSinger」；不得修改/转换/蒸馏模型权重；不得用输出训练声音模型；立绘版权属不伊子；再分发须完整、未修改、免费。
- 声码器 PC-NSF-HiFiGAN：CC BY-NC-SA 4.0（非商业，需署名并相同方式共享）。
- 因此：模型文件不得纳入 Purple 仓库或公开构建；仅本机使用。

### 步骤与结果
1. 用 `download-assets.bat` 下载（共约 612MB，已校验）、`extract.bat` 解压，经 OpenUtau「工具→安装歌手」安装。
2. 原创歌词「晚风吹过熟悉的街道，月光照着回家的方向」，18 个音符，90 BPM，C 大调（E-G-A-G-E-G-A-C-A / A-C-C-A-F-A-G-B-D），见 `work/qixuan-vocal-test.ustx`。
3. 导出人声 `work/qixuan-vocal-test.wav`：10.77s，44.1kHz 立体声；自相关 f0 检测与目标音高中位误差 4 音分，18/18 音符命中，确为有旋律的歌声而非朗读。
4. 伴奏：`composeSong({genre:"lofi",mood:"calm",bpm:90,...},12)` 生成的 Strudel 代码（C–Am–F–G），在 /studio 用 WAV 录制器录得 `work/accomp-recorded.wav`（25.2s）；按底鼓 onset 与低音音高定位小节线（和弦小节起点 4.59s，周期 2.667s 吻合 90BPM），从 C 和弦小节起切 14s。
5. 混音（numpy）：人声 44.1k→48k，伴奏 ×0.6，人声峰值 0.55，整体归一到 0.89，末尾 1.5s 淡出 → `work/qixuan-vocal-with-strudel-mix.wav`（14.0s，48kHz 立体声）。

### 耗时与资源
- OpenUtau 渲染 10.77s 人声约 20s（CPU，实时因子约 2×，含首次加载模型）。
- **未采集到 CPU/内存占用曲线**：`monitor.bat` 本轮未运行，`monitor.csv` 不存在，因此没有资源占用实测数据（不作估算）。如需要，可重渲染一次并同时运行 monitor.bat。

### 局限 / 下一步
- 伴奏由屏幕录制式导出，起点靠算法对齐，人声与伴奏拍点为人工校验级，不保证采样级精确。
- 人声发音自然度、咬字需人工试听验收；未调参（无颤音/气声）。
- 公开发布前须标注：「人声由 AI 歌声合成（绮萱 / DiffSinger）」。
- 未做：训练、付费服务、集成进工作室。等待验收。

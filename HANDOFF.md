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

## 本地歌曲后端（Python）+ 前端「歌曲」模式

目标：网页输入歌词 → 一键生成「伴奏 + 虚拟歌手人声」的完整 WAV，不再手动操作 OpenUtau。零付费、不上传、仅本机。

### 架构（backend/，已提交；模型与大文件不入库）
- `app/lyrics.py` 歌词分句 → pypinyin 转拼音 → 用声库自带 `dsdur/dsdict-zh.yaml`（603 个拼音）映射音素（只流式读文件开头，约 0.04 秒）。
- `app/song.py` 统一歌曲结构 `Song`：BPM、调式/主音、每小节和弦（1 小节 1 和弦、1 个 Strudel cycle = 1 小节）、小节/节拍格（4/4，每小节 8 个八分格）、人声音符时间轴。`plan_bars` 按歌词自动补足小节数（默认示例在 80BPM/15 秒放不下时会自动延长，界面会提示）。旋律规则：弧形轮廓、强拍落和弦音、弱拍级进、句尾半终止、末句回主音。
- `app/singer.py` **无界面 DiffSinger 推理**（ONNX Runtime CPU）：音素/语言/时长/f0 → 方差模型预测气声与发声(dB) → 声学模型(depth 0.6, steps 20) → PC-NSF-HiFiGAN 声码器。辅音提前于拍点、元音踩拍；f0 含 5 点平滑滑音与长音颤音。按歌词句分段合成。**未使用 OpenUtau 命令行**（没有验证过的命令行渲染接口，故未假设）。
  - 关键发现：气声/发声必须喂方差模型预测值（元音约 −20/−46 dB）；喂 0 会比 OpenUtau 响约 20dB 并削波。
- `app/accomp.py` 伴奏：沿用现有 `composer.ts` 生成的 Strudel 代码，Node 无头查询事件（`tools/strudel_events.mjs`，运行时由 `tools/build_strudel_runtime.py` 从仓库 pnpm 库复制到 `.strudel-runtime/`，不下载），再用 numpy 合成（振荡器/ADSR/双二阶滤波/混响/回声）。注意：此 Strudel 版本 `.cpm(x)` 为 `fast(x/60)`，事件时间单位就是秒。与浏览器 Strudel 实录对比：鼓/低音包络相关 0.92，踩镲 0.99，琶音 0.79，零延迟。
  - 安全：后端会在 Node 里求值伴奏文本，所以 `validate_code` 只接受白名单 Strudel 调用（拒绝 `;`、反引号、未知标识符等），提交时先验证。
- `app/mixer.py` 自动混音：人声/伴奏电平平衡（人声约高 7dB）、人声轻混响、人声出现时伴奏闪避 2.5dB、淡入 0.15s/淡出 1.6s、峰值上限 0.89；`wavio.py` 写 WAV 并在 LIST/INFO 写入 AI 合成标识。
- `app/jobs.py` 单工作线程队列（同一时刻只跑 1 个，最多再排 2 个，其余 429）、进度（plan/accomp/vocal/mix）、取消（排队中立即取消；运行中在当前句结束后停止；Node 子进程直接 kill）、错误信息、每任务 `ResourceSampler`（进程 CPU、工作集、系统可用内存，真实采样）、空闲后卸载模型。内存低于 1200MB 拒绝开始。
- `app/main.py` FastAPI，**仅监听 127.0.0.1:8765**；校验 Host（防 DNS 重绑定）与 Origin（只允许本地预览源）；CORS 仅 GET/POST；任务 ID 必须是 32 位十六进制，音频名白名单（无任意路径）。接口：`/api/health /api/singers /api/lyrics/preview /api/songs /api/jobs/{id} /api/jobs/{id}/cancel /api/jobs/{id}/audio/{mix|vocal|accomp}.wav /api/jobs/{id}/download.wav?vocal=&accomp=`（按音量重新混音）。
- 前端：`song-mode.tsx`（创作页新增「纯音乐 / 歌曲」切换：歌词框、虚拟歌手选择、15/30 秒、生成/取消、真实进度、完整歌曲试听、人声/伴奏独立音量(滑块→重新混音试听)、WAV 下载、实际耗时与资源占用、AI 合成标识）。通过本地 vite 的 `/local-song-api` 同源代理访问后端，**未改动 CSP**；生产/Cloudflare 构建里没有该代理，页面会提示后端未启动。纯音乐模式与高级代码编辑器原样保留。`composer.ts` 只做了增量：`Composition.meta`（bpm/root/mode/progression），`MoodSpec.mode` 收窄类型。

### 运行方式
1. 首次：双击 `backend\setup-backend.bat`（建 .venv、pip 装 fastapi/uvicorn/numpy/onnxruntime/pyyaml/pypinyin、构建 Strudel 运行时；日志 `setup-log.txt`）。
2. 日常：双击 `outputs\claude-start-song-stack.bat`（重启后端 8765 与预览 3000）；改前端后先双击 `outputs\claude-verify.bat`（测试+类型检查+构建+刷新预览）。浏览器打开 http://127.0.0.1:3000/ → 「🎤 歌曲」。
3. 验收脚本：`outputs\claude-run-smoke.bat`（端到端，结果在 `backend/tests/http_smoke_result.json` / `http_smoke.log`）。单元测试：`backend\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`（14 项）。

### 实测（本机 Ryzen 7 7730U，16 逻辑核，真实采样；空闲内存仅约 2.5GB）
| 项目 | 15 秒档（实得 16.0 秒，6 小节） | 30 秒档（实得 29.3 秒，11 小节） |
|---|---|---|
| 总耗时 | 12.1 秒 | 23.1 秒 |
| 伴奏 / 载入模型 / 人声 / 混音 | 1.0 / 0.8 / 9.9 / 0.3 秒 | 2.1 / 0.7 / 19.7 / 0.5 秒 |
| CPU 平均 / 峰值（占整机） | 44.9% / 62.5%（约 7 核在忙） | 45.5% / 62.6% |
| 后端进程内存峰值 | 648 MB | 659 MB |
| 系统可用内存（起点→最低） | 2455 → 1945 MB | 2323 → 1868 MB |
| 人声音高 | 18/18 音符，中位误差 6.7 音分 | 32/32，中位 5.8 音分 |
- 验收脚本 27 项全部通过（第一次整套运行 11.6 / 22.4 秒，结果一致）：Origin/Host 拦截、代码注入拒绝、路径穿越、队列上限（1 运行+2 排队，第 4 个 429）、运行中取消（0.5 秒内生效）、取消后无残留音频、混音不削波、人声在前奏小节之后进入、独立音量重混。
- 一个修过的坑：混音阶段曾因 0.3 秒窗口卷积耗时 61 秒，改为 O(N) 滑动平均后 0.2 秒。
- 试听文件：`voice-lab/work/song-15s-mix.wav`、`song-30s-mix.wav`（另有分轨 vocal/accomp 与 `remix-vocal40`）。

### 已知局限 / 下一步
- 人声为规则旋律 + 声库默认表现，无表情参数；咬字/情感需人耳验收。歌词只支持中文汉字；英文/数字被忽略并提示。
- 取消在「当前这一句」合成结束后生效（ONNX 单次推理不可中断）；一句通常 4–10 秒。
- 独立音量为「滑块 → 后端重混 → 试听」，不是实时拖动。
- 授权：绮萱与 PC-NSF-HiFiGAN（CC BY-NC-SA 4.0）仅本机；公开发布须标注「AI 合成」并署名绮萱/DiffSinger；见 THIRD_PARTY_NOTICES.md。本分支未提交任何模型/音频文件。
- 待办：打包成一个启动入口；多歌手；更丰富的旋律/段落结构（主歌+副歌）；节奏型/和弦与歌词情绪联动。

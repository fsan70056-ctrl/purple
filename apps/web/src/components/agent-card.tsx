/**
 * The pairing panel: Purple's first-run surface. It hands the visitor the one
 * address their agent needs, in whatever form their client expects.
 */
import { AGENT_CLIENTS } from '@purple/core/agent-tools'
import { useClipboardCopy } from '@purple/ui/use-clipboard-copy'
import { useState } from 'react'
import { agentMcpUrl } from '#/lib/agent-link-storage'

const AGENT_PROMPT = 'Read https://soundspurple.com/connect/guide, connect to my open Purple tab, and make music with me.'

// Block wordmark. Rows are fixed width so the letterforms stay aligned in any
// monospace fallback.
const PURPLE_WORDMARK = [
  '███  █  █ ███  ███  █    ████',
  '█  █ █  █ █  █ █  █ █    █',
  '███  █  █ ███  ███  █    ███',
  '█    █  █ █ █  █    █    █',
  '█     ██  █  █ █    ████ ████',
].join('\n')

type AgentClientId = (typeof AGENT_CLIENTS)[number]['id']

export function AgentCard(props: {
  code: string
  linked: boolean
  mobile: boolean
  onClose: () => void
}) {
  const [clientId, setClientId] = useState<AgentClientId>('claude')
  const clipboard = useClipboardCopy()
  const promptClipboard = useClipboardCopy()
  const client =
    AGENT_CLIENTS.find(({ id }) => id === clientId) ?? AGENT_CLIENTS[0]
  const command = props.mobile
    ? agentMcpUrl(props.code)
    : client.command(agentMcpUrl(client.needsPairingCode ? props.code : null))
  return (
    <aside className="session-pane agent-card">
      <pre className="agent-card-ascii" aria-hidden="true">{PURPLE_WORDMARK}</pre>
      <h2>{props.mobile ? '连接 AI 助手' : '让你的 AI 助手来演奏'}</h2>
      <p role="status" className={props.linked ? 'agent-status linked' : 'agent-status'}>
        {props.linked ? 'AI 助手已连接' : '等待 AI 助手连接'}
      </p>
      <p>{props.mobile
        ? '在手机上可以播放作品、编辑音乐，并保存到作品库。'
        : '把下面这段话粘贴到你和 AI 助手（如 Codex 或 Claude Code）的对话里：'}</p>
      {!props.mobile && <>
        <pre className="agent-command agent-prompt">{AGENT_PROMPT}</pre>
        <button
          type="button"
          className="primary"
          onClick={() => void promptClipboard.copy(AGENT_PROMPT)}
        >
          <span aria-live="polite">{promptClipboard.copied ? '已复制' : '复制提示语'}</span>
        </button>
        <p>如果出现授权提示请同意，然后保持此页面打开即可听到音乐。</p>
      </>}
      {props.mobile && (
        <p>请在另一台设备（如笔记本电脑）上运行 AI 助手，并把此页面的专属配对地址添加到支持服务器地址的 MCP 客户端。播放时请让此页面保持在前台：手机会暂停后台页面，所以同一部手机上的助手应用无法连接。</p>
      )}
      <details className="agent-setup" open={props.mobile}>
        <summary>{props.mobile ? '配对地址' : '手动配置 MCP'}</summary>
        {!props.mobile && <p>或者自己把 Purple 注册到你的 AI 助手：</p>}
        {!props.mobile && <div className="agent-clients" role="group" aria-label="AI 助手">
          {AGENT_CLIENTS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`chip ${option.id === clientId ? 'selected' : ''}`}
              aria-pressed={option.id === clientId}
              onClick={() => {
                setClientId(option.id)
                clipboard.reset()
              }}
            >
              {option.label}
            </button>
          ))}
        </div>}
        <pre className="agent-command">{command}</pre>
        <div className="agent-card-actions">
          <button
            type="button"
            className="primary"
            // A blocked clipboard is not an error here: the command stays selectable.
            onClick={() => void clipboard.copy(command)}
          >
            <span aria-live="polite">{clipboard.copied ? '已复制' : props.mobile ? '复制配对地址' : '复制命令'}</span>
          </button>
        </div>
        {!props.mobile && <p>
          {client.needsPairingCode
            ? '这是此浏览器的专属配对地址，适用于任何支持 Streamable HTTP 的 MCP 客户端。'
            : '它会打开此浏览器一次，请求你的授权。'}
        </p>}
      </details>
      <p>如果没有声音，请点一下「播放」。</p>
      <button type="button" className="chrome" onClick={props.onClose}>
        关闭
      </button>
    </aside>
  )
}

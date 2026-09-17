import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NewsItem } from '../../plugin/localApi'

/**
 * 自动刷新间隔（毫秒）。快讯不是价格，60s 足够 —— 服务端还有 30s 内存缓存兜底。
 */
const NEWS_REFRESH_MS = 60_000

/**
 * 关键词高亮：与服务端「重要级」判定同一批词的扩展版。
 * 展示层多做几个「有信息量但不够重要」的词（公司/行业级），让扫读时更容易抓到重点。
 * ⚠️ 只做纯文本切分渲染，不拼 HTML —— 快讯正文是外部输入，拼 HTML 是 XSS 口子。
 */
const HIGHLIGHT_RE =
  /(央行|降准|降息|加息|证监会|国务院|财政部|发改委|印花税|关税|美联储|议息|政治局|国务院常务|加息|汇率|IPO|注册制|涨停|跌停|熔断)/g

/** 正文按高亮词切分；返回 [文本, 是否高亮, ...] 交替序列。 */
function segments(text: string): { s: string; hl: boolean }[] {
  const out: { s: string; hl: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(HIGHLIGHT_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ s: text.slice(last, i), hl: false })
    out.push({ s: m[0], hl: true })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ s: text.slice(last), hl: false })
  return out
}

/** 正文太长时截断（详情点标题跳新浪 7×24 页面）。 */
const TEXT_MAX = 120

function NewsBody({ text }: { text: string }) {
  const clipped = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text
  return (
    <p className="news-item__text">
      {segments(clipped).map((seg, i) =>
        seg.hl ? (
          <b key={i} className="news-item__hl">
            {seg.s}
          </b>
        ) : (
          <span key={i}>{seg.s}</span>
        ),
      )}
    </p>
  )
}

interface NewsDockProps {
  /** 当前是否在「大盘趋势」页 —— 只在大盘页挂载 */
  active: boolean
}

/**
 * 折叠式右侧资讯坞：收起时是 36px 窄竖条（含未读红点），点开展开 340px 面板。
 *
 * 注意力设计（为什么默认收起）：快讯 80% 是噪音、20% 是关键 —— 常驻视野中央会让
 * 每次扫读都付出过滤成本。红点只在**重要级**快讯出现时点亮，普通快讯不配打扰。
 */
export default function NewsDock({ active }: NewsDockProps) {
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [ts, setTs] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  /** 已读快讯 id 集合（会话内）；红点数 = 未读的重要条数 */
  const seenRef = useRef<Set<string>>(new Set())
  const [unseenImportant, setUnseenImportant] = useState(0)

  const load = useCallback(() => {
    fetch('/api/news', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { ts?: string; items?: NewsItem[]; errors?: string[] }) => {
        const list = Array.isArray(d.items) ? d.items : []
        setItems(list)
        setTs(typeof d.ts === 'string' ? d.ts : '')
        setErrors(Array.isArray(d.errors) ? d.errors : [])
        // 未读只在**收起状态**下累计；展开面板时全部标记已读
        if (!open) {
          setUnseenImportant(list.filter((it) => it.important && !seenRef.current.has(it.id)).length)
        } else {
          for (const it of list) seenRef.current.add(it.id)
        }
      })
      .catch(() => {
        // 静态部署 /api/news 不存在：面板里显示引导，窄条不出现
        setErrors(['快讯接口不可用（需通过 npm run dev / npm run preview 访问）'])
      })
  }, [open])

  // 挂载拉一次 + 60s 轮询
  useEffect(() => {
    if (!active) return
    load()
    const id = window.setInterval(load, NEWS_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [active, load])

  const toggle = () => {
    setOpen((v) => {
      const next = !v
      if (next) {
        // 展开即全部已读
        for (const it of items ?? []) seenRef.current.add(it.id)
        setUnseenImportant(0)
      }
      return next
    })
  }

  // 面板内容（含加载/空态）
  const list = useMemo(() => {
    if (!items) return null
    // 重要置顶：只把重要条目挪到最前，组内保持时间倒序
    return [...items].sort((a, b) => Number(b.important) - Number(a.important))
  }, [items])

  if (!active) return null

  return (
    <aside className={`news-dock ${open ? 'news-dock--open' : ''}`}>
      {open ? (
        <section className="news-dock__panel" aria-label="7×24 快讯">
          <header className="news-dock__head">
            <h3 className="news-dock__title">
              <span className="live-strip__dot" aria-hidden="true" />
              快讯 · 7×24
            </h3>
            <div className="news-dock__head-actions">
              <span className="news-dock__ts num">{ts}</span>
              <button type="button" className="btn btn--mini" onClick={toggle} aria-label="收起快讯">
                收起
              </button>
            </div>
          </header>

          {errors.length > 0 && (items === null || items.length === 0) ? (
            <p className="news-dock__notice muted">{errors.join('；')}</p>
          ) : list === null ? (
            <p className="news-dock__notice muted">正在读取 /api/news …</p>
          ) : list.length === 0 ? (
            <p className="news-dock__notice muted">暂无快讯</p>
          ) : (
            <ul className="news-list">
              {list.map((it) => (
                <li key={it.id || it.time + it.text.slice(0, 8)} className={`news-item ${it.important ? 'news-item--important' : ''}`}>
                  <div className="news-item__meta">
                    <span className="news-item__time num">{it.time}</span>
                    {it.tag ? <span className="news-item__tag">{it.tag}</span> : null}
                    {it.important ? <span className="news-item__flag">重要</span> : null}
                    {it.url ? (
                      <a className="news-item__link" href={it.url} target="_blank" rel="noreferrer">
                        详情
                      </a>
                    ) : null}
                  </div>
                  <NewsBody text={it.text} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <button
          type="button"
          className="news-dock__tab"
          onClick={toggle}
          title="展开 7×24 快讯"
          aria-label={`展开快讯${unseenImportant > 0 ? `（${unseenImportant} 条重要未读）` : ''}`}
        >
          <span className="news-dock__tab-text">快讯</span>
          {unseenImportant > 0 ? (
            <span className="news-dock__badge num">{unseenImportant > 9 ? '9+' : unseenImportant}</span>
          ) : null}
        </button>
      )}
    </aside>
  )
}

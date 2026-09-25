import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/standard.css'
import '@fontsource-variable/noto-sans-jp/wght.css'
import Papa from 'papaparse'
import { IconCameraPlus, IconClockHour4, IconHeart, IconLetterCase } from '@tabler/icons-react'
import { Bookmark, ChevronDown, ChevronLeft, ChevronUp, Copy as CopyIcon, Ellipsis, ExternalLink, FileText, FileUp, Image, Languages, Menu, Search, SlidersHorizontal, Sun, X } from 'lucide-react'
import { createId } from './id'
import { importText } from './importers'
import type { Collection, CollectionType, EmbeddedPost, Media, Post, PostType, Profile } from './types'
import './styles.css'

type View = 'timeline' | 'collections' | 'bookmarks' | 'import' | 'settings' | 'info'
type Theme = 'light' | 'dark' | 'system'
type LanguageSetting = 'auto' | 'ja' | 'en'
type FontSetting = 'noto' | 'system'
type AppLanguage = Exclude<LanguageSetting, 'auto'>
type SortMode = 'newest' | 'popular'
type TimelineTab = 'posts' | 'replies' | 'reposts' | 'media'
type NavIconName = 'home' | 'bookmark' | 'layout-grid' | 'file-import' | 'settings' | 'info-circle'
type SettingsState = { theme?: Theme; language?: LanguageSetting; font?: FontSetting | 'twitter' | 'inter' }
type AdvancedSearchFilters = { minReplies: string; minLikes: string; minReposts: string; since: string; until: string }
type ManualPostDraft = {
  text: string
  postUrl: string
  createdAt: string
  type: PostType
  language: string
  mediaUrls: string
  replyCount: string
  repostCount: string
  likeCount: string
  quoteCount: string
  bookmarkCount: string
  viewCount: string
}
type ProfileEditDraft = {
  displayName: string
  bio: string
  customAvatarUrl: string
  headerImageUrl: string
}
type ProfileMediaEditTarget = 'customAvatarUrl' | 'headerImageUrl'
type MediaViewerState = { post: Post; collection?: Collection; index: number }

const collectionsKey = 'x-archive-collections'
const bookmarksKey = 'x-archive-bookmarks'
const settingsKey = 'x-archive-settings'
const timelineTabsKey = 'x-archive-timeline-tabs'
const detailStateKey = 'x-archive-detail'
const publicBase = import.meta.env.BASE_URL
const buttonIconBase = `${publicBase}assets/button/`
const postIconBase = `${publicBase}assets/post/`
const profileSortIconBase = `${publicBase}assets/profile/sort/`
const profileIconBase = `${publicBase}assets/profile/icon/`
const sidebarCollectionIconBase = `${publicBase}assets/sidebar/collection/icon/`
const defaultProfileIcon = `${publicBase}assets/profile/icon/default_profile_400x400.png`
const appLogoPath = `${publicBase}assets/logo/twview_logo.png`
const emptyAdvancedFilters: AdvancedSearchFilters = { minReplies: '', minLikes: '', minReposts: '', since: '', until: '' }
const timelinePageSize = 80
const largeCollectionPostLimit = 2000
const storedSourceTextLimit = 1_000_000
const modalAnimationMs = 150

const load = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T } catch { return fallback }
}
const saveJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
const collectionsWithoutSourceText = (items: Collection[]) => items.map(({ sourceText, originalSourceText, ...collection }) => collection)
const collectionsWithoutRawRows = (items: ReturnType<typeof collectionsWithoutSourceText>) => items.map(collection => ({
  ...collection,
  posts: collection.posts.map(({ raw, ...post }) => post)
}))
const isLargeCollection = (collection: Collection) =>
  collection.posts.length > largeCollectionPostLimit ||
  (collection.sourceText?.length ?? 0) > storedSourceTextLimit ||
  (collection.originalSourceText?.length ?? 0) > storedSourceTextLimit
const saveCollections = (items: Collection[]) => {
  const hasLargeCollection = items.some(isLargeCollection)
  const withoutSource = collectionsWithoutSourceText(items)
  if (hasLargeCollection) {
    if (saveJson(collectionsKey, collectionsWithoutRawRows(withoutSource))) return 'compact'
    if (saveJson(collectionsKey, withoutSource)) return 'without-source'
    return 'failed'
  }
  if (saveJson(collectionsKey, items)) return 'full'
  if (saveJson(collectionsKey, withoutSource)) return 'without-source'
  if (saveJson(collectionsKey, collectionsWithoutRawRows(withoutSource))) return 'compact'
  return 'failed'
}
const collectionWithoutRawRows = (collection: Collection): Collection => ({ ...collection, posts: collection.posts.map(({ raw, ...post }) => post) })
const collectionWithStoredSource = (collection: Collection, sourceText: string): Collection => {
  if (sourceText.length > storedSourceTextLimit || collection.posts.length > largeCollectionPostLimit) return collectionWithoutRawRows(collection)
  return { ...collection, sourceText, originalSourceText: sourceText }
}
const useAnimatedClose = (onClose: () => void) => {
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    timer.current = window.setTimeout(onClose, modalAnimationMs)
  }, [closing, onClose])
  return { closing, close }
}
const useBodyScrollLock = (active = true) => {
  useEffect(() => {
    if (!active) return
    const scrollY = window.scrollY
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyPosition = document.body.style.position
    const previousBodyTop = document.body.style.top
    const previousBodyWidth = document.body.style.width
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.documentElement.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.body.style.position = previousBodyPosition
      document.body.style.top = previousBodyTop
      document.body.style.width = previousBodyWidth
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' })
    }
  }, [active])
}
const useDetailScrollbarHidden = (active = true) => {
  useEffect(() => {
    document.documentElement.classList.toggle('detail-scrollbar-hidden', active)
    document.body.classList.toggle('detail-scrollbar-hidden', active)
    return () => {
      document.documentElement.classList.remove('detail-scrollbar-hidden')
      document.body.classList.remove('detail-scrollbar-hidden')
    }
  }, [active])
}
const isTimelineTab = (value: unknown): value is TimelineTab => value === 'posts' || value === 'replies' || value === 'reposts' || value === 'media'
const savedTimelineTab = (collectionId: string): TimelineTab => {
  const saved = load<Record<string, unknown>>(timelineTabsKey, {})
  return isTimelineTab(saved[collectionId]) ? saved[collectionId] : 'posts'
}

const inferRegionalLanguage = (): AppLanguage => {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  const locale = languages.find(Boolean)?.toLowerCase() || ''
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return locale.startsWith('ja') || timeZone === 'Asia/Tokyo' ? 'ja' : 'en'
}
const resolveLanguage = (language: LanguageSetting): AppLanguage => language === 'auto' ? inferRegionalLanguage() : language
const resolveFont = (font?: SettingsState['font']): FontSetting => font === 'system' || font === 'twitter' ? 'system' : 'noto'
const localeOf = (language: AppLanguage) => language === 'ja' ? 'ja-JP' : 'en-US'
const compact = (n: number | undefined, locale: string) => n === undefined ? '' : Math.abs(n) < 10000 ? numberText(n, locale) : new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const compactNonZero = (n: number | undefined, locale: string) => n ? compact(n, locale) : ''
const numberText = (n: number, locale: string) => n.toLocaleString(locale)
const displayPostText = (text: string) => text.replace(/^'(?=@)/, '')
const renderTextMentions = (text: string, keyPrefix: string) => text.split(/(@[A-Za-z0-9_]{1,15})/g).map((part, index) => part.startsWith('@') ? <span className="post-mention" key={`${keyPrefix}-mention-${index}`}>{part}</span> : part)
const cleanUrlMatch = (value: string) => {
  const trailing = /[。．、，.!?）)\]}」』]+$/.exec(value)?.[0] || ''
  return { url: trailing ? value.slice(0, -trailing.length) : value, trailing }
}
const displayUrlText = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.host}${url.pathname}${url.search}`.replace(/\/$/, '')
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}
const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
const isShortTwitterUrl = (value: string) => /^https?:\/\/t\.co\//i.test(value)
const isPostStatusUrl = (value: string) => /(?:x|twitter)\.com\/[^/?#]+\/status\/\d+/i.test(value)
const renderPostText = (text: string, urls?: string[]) => {
  const value = displayPostText(text)
  const expandedUrls = (urls || []).map(url => url.trim()).filter(url => url && !isPostStatusUrl(url))
  const nodes: ReactNode[] = []
  const pattern = /https?:\/\/[^\s<>"']+/g
  let lastIndex = 0
  let urlIndex = 0
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > lastIndex) nodes.push(...renderTextMentions(value.slice(lastIndex, match.index), `text-${lastIndex}`))
    const { url: matchedUrl, trailing } = cleanUrlMatch(match[0])
    const expandedUrl = isShortTwitterUrl(matchedUrl) ? expandedUrls[urlIndex] : ''
    const href = expandedUrl || matchedUrl
    nodes.push(<a className="post-link" href={href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} key={`link-${match.index}`}>{displayUrlText(href)}</a>)
    if (trailing) nodes.push(trailing)
    lastIndex = match.index + match[0].length
    urlIndex += 1
  }
  if (lastIndex < value.length) nodes.push(...renderTextMentions(value.slice(lastIndex), `text-${lastIndex}`))
  return nodes
}
const isUnknownAuthorName = (value?: string) => {
  const normalized = value?.trim()
  return !normalized || normalized === '不明なユーザー' || normalized === 'Unknown author'
}
const collectionDisplayTitle = (collection: Collection) => collection.type === 'account' && collection.accountProfile?.displayName ? collection.accountProfile.displayName : collection.title
const displayAuthorName = (post: Pick<Post, 'authorName' | 'username'>, copy: { unknownAuthor: string }, fallbackDisplayName?: string, fallbackUsername?: string) => {
  const authorName = post.authorName?.trim()
  const username = post.username || fallbackUsername
  return !isUnknownAuthorName(authorName) ? authorName : fallbackDisplayName || username || copy.unknownAuthor
}
const sameHandle = (a?: string, b?: string) => {
  const normalize = (value?: string) => value?.trim().replace(/^@/, '').toLowerCase() || ''
  return !!normalize(a) && normalize(a) === normalize(b)
}
const relatedPostAvatarUrl = (parent: EmbeddedPost | undefined, post: Post, avatarUrl?: string, fallbackUsername?: string) =>
  parent && avatarUrl && (sameHandle(parent.username, post.username) || sameHandle(parent.username, fallbackUsername)) ? avatarUrl : undefined
const replyTargetUsername = (post: Post) => {
  if (post.repliedPost) return ''
  const explicit = post.replyToUsername?.trim() || post.raw?.['返信先ユーザー名']?.trim() || ''
  if (explicit) return explicit.replace(/^@/, '')
  return post.type === 'reply' ? /^@([A-Za-z0-9_]{1,15})\b/.exec(displayPostText(post.text))?.[1] || '' : ''
}
const sortableDateText = (date: string) => {
  const raw = date.trim()
  if (!raw) return ''
  const jp = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (jp) return `${jp[1]}-${jp[2].padStart(2, '0')}-${jp[3].padStart(2, '0')}T${(jp[4] || '00').padStart(2, '0')}:${jp[5] || '00'}:${jp[6] || '00'}`
  const slash = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (slash) return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}T${(slash[4] || '00').padStart(2, '0')}:${slash[5] || '00'}:${slash[6] || '00'}`
  return raw
}
const dateTimestamp = (date: string) => {
  const parsed = Date.parse(sortableDateText(date))
  return Number.isNaN(parsed) ? 0 : parsed
}
const trendingScore = (post: Post) => {
  const created = dateTimestamp(post.createdAt)
  const daysOld = created ? Math.max(0, (Date.now() - created) / 86400000) : 30
  return (post.likeCount ?? 0)
    + (post.repostCount ?? 0) * 3
    + (post.quoteCount ?? 0) * 4
    + (post.replyCount ?? 0) * 2
    + Math.log10((post.viewCount ?? 0) + 1) * 8
    + Math.max(0, 30 - daysOld) * 2
}
const dateText = (date: string, locale: string) => {
  if (!date) return ''
  const d = new Date(sortableDateText(date))
  if (Number.isNaN(+d)) return date.replace('T', ' ')
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) {
    const elapsed = Math.max(0, now.getTime() - d.getTime())
    const seconds = Math.max(1, Math.floor(elapsed / 1000))
    const japanese = locale.toLowerCase().startsWith('ja')
    if (seconds < 60) return japanese ? `${seconds}秒` : `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return japanese ? `${minutes}分` : `${minutes}m`
    const hours = Math.floor(minutes / 60)
    return japanese ? `${hours}時間` : `${hours}h`
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}
const detailTimeText = (date: string, locale: string) => {
  if (!date) return ''
  const d = new Date(sortableDateText(date))
  return Number.isNaN(+d) ? date.replace('T', ' ').split(/\s+/).at(-1) || date : new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
}
const absoluteDateText = (date: string, locale: string) => {
  if (!date) return ''
  const d = new Date(sortableDateText(date))
  if (Number.isNaN(+d)) return date.replace('T', ' ')
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}
const detailDateTimeText = (date: string, locale: string) => [detailTimeText(date, locale), absoluteDateText(date, locale)].filter(Boolean).join(' · ')
const profileIconSrc = (src?: string) => src?.trim() || defaultProfileIcon
const profileAvatarSrc = (profile?: { avatarUrl?: string; customAvatarUrl?: string }, fallback?: string) => profile?.customAvatarUrl || fallback || profile?.avatarUrl
const useDefaultProfileIcon = (image: HTMLImageElement) => {
  if (!image.src.endsWith(defaultProfileIcon)) image.src = defaultProfileIcon
}
type ParsedSearchQuery = {
  includeGroups: string[][]
  excludeTerms: string[]
  minReplies?: number
  minLikes?: number
  minRetweets?: number
  mediaFilter?: 'images' | 'videos'
}
const normalizeSearchCommands = (query: string) => query.replace(/\bmin_(retweets|reposts|faves|likes|replies):\s*([0-9][\d,]*)/gi, (_match, kind: string, value: string) => `min_${kind}:${value.replace(/,/g, '')}`)
const tokenizeSearchQuery = (query: string) => normalizeSearchCommands(query).replace(/(\S)-"/g, '$1 -"').match(/-?"[^"]+"|\S+/g) ?? []
const stripSearchTokenQuotes = (token: string) => token.replace(/^"|"$/g, '').trim().toLocaleLowerCase()
const parsedSearchCache = new Map<string, ParsedSearchQuery>()
const parseSearchQuery = (query: string): ParsedSearchQuery => {
  const cached = parsedSearchCache.get(query)
  if (cached) return cached
  const parsed: ParsedSearchQuery = { includeGroups: [], excludeTerms: [] }
  let currentGroup: string[] = []
  const pushGroup = () => {
    if (currentGroup.length) parsed.includeGroups.push(currentGroup)
    currentGroup = []
  }
  for (const rawToken of tokenizeSearchQuery(query)) {
    const token = rawToken.trim()
    if (!token) continue
    if (/^OR$/i.test(token)) {
      pushGroup()
      continue
    }
    const minMatch = token.match(/^min_(retweets|reposts|faves|likes|replies):(\d+)$/i)
    if (minMatch) {
      const value = Number(minMatch[2])
      if (['retweets', 'reposts'].includes(minMatch[1].toLowerCase())) parsed.minRetweets = value
      if (['faves', 'likes'].includes(minMatch[1].toLowerCase())) parsed.minLikes = value
      if (minMatch[1].toLowerCase() === 'replies') parsed.minReplies = value
      continue
    }
    const mediaMatch = token.match(/^f?ilter:(images|videos)$/i)
    if (mediaMatch) {
      parsed.mediaFilter = mediaMatch[1].toLowerCase() as 'images' | 'videos'
      continue
    }
    if (token.startsWith('-')) {
      const term = stripSearchTokenQuotes(token.slice(1))
      if (term) parsed.excludeTerms.push(term)
      continue
    }
    const term = stripSearchTokenQuotes(token)
    if (term) currentGroup.push(term)
  }
  pushGroup()
  parsedSearchCache.set(query, parsed)
  if (parsedSearchCache.size > 100) {
    const firstKey = parsedSearchCache.keys().next().value
    if (firstKey !== undefined) parsedSearchCache.delete(firstKey)
  }
  return parsed
}
const matchesSearch = (value: string, query: string) => {
  const parsed = parseSearchQuery(query)
  const haystack = value.toLocaleLowerCase()
  if (parsed.excludeTerms.some(term => haystack.includes(term))) return false
  if (!parsed.includeGroups.length) return true
  return parsed.includeGroups.some(group => group.every(term => haystack.includes(term)))
}
const postSearchText = (post: Post, collectionType: CollectionType, extra = '') =>
  collectionType === 'account' ? post.text : `${post.text} ${post.authorName} ${post.username} ${extra}`
const normalizedMediaUrl = (value?: string) => (value || '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/&amp;/gi, '&')
  .replace(/\\([_()*[\]{}])/g, '$1')
const isImageMedia = (media: { type?: string; url: string }) => {
  const type = (media.type || '').toLocaleLowerCase()
  const url = normalizedMediaUrl(media.url)
  return /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url) || type.includes('image') || type.includes('photo')
}
const isVideoMedia = (media: { type?: string; url: string }) => {
  const type = (media.type || '').toLocaleLowerCase()
  const url = normalizedMediaUrl(media.url)
  if (/\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return false
  return type.includes('video') || type.includes('動画') || /\.(m3u8|mov|mp4|webm)(?:[?#].*)?$/i.test(url)
}
const isVideoPosterImage = (media: Media) => isImageMedia(media) && /(?:video_thumb|amplify_video_thumb|tweet_video_thumb)\//i.test(media.url)
const normalizedMediaItem = (media: Media): Media => ({ ...media, url: normalizedMediaUrl(media.url), posterUrl: normalizedMediaUrl(media.posterUrl) || undefined })
const displayMediaItems = (media: Media[]) => {
  const normalized = media.map(normalizedMediaItem).filter(item => item.url)
  const posters = normalized.filter(isVideoPosterImage)
  let posterIndex = 0
  return normalized
    .filter(item => !isVideoPosterImage(item))
    .map(item => isVideoMedia(item) && !item.posterUrl && posters[posterIndex] ? { ...item, posterUrl: posters[posterIndex++]!.url } : item)
}
const matchesSearchCommands = (post: Post, query: string) => {
  const parsed = parseSearchQuery(query)
  if (parsed.minReplies !== undefined && (post.replyCount ?? 0) < parsed.minReplies) return false
  if (parsed.minLikes !== undefined && (post.likeCount ?? 0) < parsed.minLikes) return false
  if (parsed.minRetweets !== undefined && (post.repostCount ?? 0) < parsed.minRetweets) return false
  if (parsed.mediaFilter === 'images' && !post.media?.some(isImageMedia)) return false
  if (parsed.mediaFilter === 'videos' && !post.media?.some(isVideoMedia)) return false
  return true
}
const postCanonicalUrl = (post: Post, fallbackUsername?: string) => {
  if (post.postUrl) return post.postUrl
  const id = post.id?.trim()
  const username = (post.username || fallbackUsername || '').trim().replace(/^@/, '')
  return id && /^\d{5,}$/.test(id) && /^[A-Za-z0-9_]{1,15}$/.test(username) ? `https://twitter.com/${username}/status/${id}` : ''
}
const writeClipboard = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  }
}
const minNumber = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
const matchesAdvancedSearch = (post: Post, filters: AdvancedSearchFilters) => {
  const minReplies = minNumber(filters.minReplies)
  const minLikes = minNumber(filters.minLikes)
  const minReposts = minNumber(filters.minReposts)
  if (minReplies !== undefined && (post.replyCount ?? 0) < minReplies) return false
  if (minLikes !== undefined && (post.likeCount ?? 0) < minLikes) return false
  if (minReposts !== undefined && (post.repostCount ?? 0) < minReposts) return false
  if (!filters.since && !filters.until) return true
  const created = new Date(post.createdAt)
  if (Number.isNaN(+created)) return false
  if (filters.since) {
    const since = new Date(`${filters.since}T00:00:00`)
    if (!Number.isNaN(+since) && created < since) return false
  }
  if (filters.until) {
    const until = new Date(`${filters.until}T23:59:59.999`)
    if (!Number.isNaN(+until) && created > until) return false
  }
  return true
}
const hasAdvancedSearchFilters = (filters: AdvancedSearchFilters) => Object.values(filters).some(value => value.trim())
const toLocalDateTimeInputValue = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const csvDateText = (date: string) => {
  if (!date) return ''
  const d = new Date(sortableDateText(date))
  if (Number.isNaN(+d)) return date.replace('T', ' ')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const csvCell = (value: unknown) => {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const normalizeHandle = (value?: string) => value ? `@${value.trim().replace(/^@/, '')}` : ''
const splitList = (value: string) => value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean)
const numericDraftValue = (value: string) => {
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) && value.trim() !== '' ? parsed : undefined
}
const idFromPostUrl = (url: string) => /(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/i.exec(url.trim())
const normalizedPostUrl = (url?: string) => (url || '')
  .trim()
  .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com/i, 'https://x.com')
  .replace(/\/$/, '')
  .toLowerCase()
const findQuotedPostInCollection = (embedded: EmbeddedPost | undefined, collection: Collection | undefined, owner: Post, fallbackUsername?: string) => {
  if (!embedded || !collection || !(sameHandle(embedded.username, owner.username) || sameHandle(embedded.username, fallbackUsername))) return undefined
  const embeddedId = embedded.id?.trim() || idFromPostUrl(embedded.postUrl || '')?.[2] || ''
  const embeddedUrl = normalizedPostUrl(embedded.postUrl)
  return collection.posts.find(candidate => embeddedId && candidate.id === embeddedId)
    || collection.posts.find(candidate => embeddedUrl && normalizedPostUrl(candidate.postUrl) === embeddedUrl)
}
const mediaTypeText = (media?: Media[]) => {
  if (!media?.length) return ''
  if (media.some(isVideoMedia)) return 'video'
  if (media.some(isImageMedia)) return 'photo'
  return 'media'
}
const mediaUrlsText = (media?: Media[]) => media?.map(item => item.url).filter(Boolean).join(',') || ''
type ArticleInfo = { title?: string; url?: string; body?: string }
const articleUrlPattern = /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/i\/article\/\d+[^\s)]*/i
const articleUrlGlobalPattern = /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/i\/article\/\d+[^\s)]*/gi
const rawMediaItems = (post: Post): Media[] => splitList(post.raw?.['メディアURL'] || '').map(url => ({ url, type: post.raw?.['メディア種類'] || mediaTypeText([{ url }]) || undefined }))
const articleHeroMedia = (post: Post) => displayMediaItems([...(post.media || []), ...rawMediaItems(post)]).find(isImageMedia)
const articleUrlFromPost = (post: Post) => post.article?.url || post.urls?.find(url => articleUrlPattern.test(url)) || articleUrlPattern.exec(post.text)?.[0] || ''
const postArticleInfo = (post: Post): ArticleInfo | undefined => {
  const raw = post.raw || {}
  const title = post.article?.title || raw['記事タイトル'] || ''
  const url = articleUrlFromPost(post) || raw['記事URL'] || ''
  const body = post.article?.body || raw['記事本文'] || ''
  if (!title && !url && !body) return undefined
  return { title, url, body }
}
const postTextWithoutArticleUrl = (post: Post) => {
  const hasArticleUrl = !!postArticleInfo(post)?.url || post.urls?.some(url => articleUrlPattern.test(url))
  return post.text
    .replace(articleUrlGlobalPattern, '')
    .replace(hasArticleUrl ? /https?:\/\/t\.co\/[A-Za-z0-9_%-]+/gi : /$^/, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
const urlsWithoutArticleUrl = (post: Post) => post.urls?.filter(url => !articleUrlPattern.test(url))
const articleExcerpt = (value?: string, length = 88) => {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length)}…` : text
}
const articleParagraphs = (value?: string) => (value || '').split(/\n{2,}|\r?\n/).map(item => item.trim()).filter(Boolean)
const postTypeExportValue = (type?: PostType) => type && type !== 'unknown' ? type : 'tweet'
const safeFileName = (value: string) => (value || 'tweets').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim()
const downloadTextFile = (filename: string, content: string, type = 'text/csv;charset=utf-8') => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
const embeddedCsvHeaders = (prefix: string) => [`${prefix}: ID`, `${prefix}: 種類`, `${prefix}: 本文`, `${prefix}: 投稿URL`, `${prefix}: 投稿者名`, `${prefix}: 投稿者ユーザー名`, `${prefix}: 表示回数`, `${prefix}: ブックマーク数`, `${prefix}: いいね数`, `${prefix}: リポスト数`, `${prefix}: 返信数`, `${prefix}: 引用数`, `${prefix}: 日付`, `${prefix}: メディア種類`, `${prefix}: メディアURL`]
const xporterCsvHeaders = ['ID', '本文', '投稿URL', '言語', '種類', '投稿者名', '投稿者ユーザー名', '表示回数', 'ブックマーク数', 'いいね数', 'リポスト数', '返信数', '引用数', '日付', 'リンク', 'メディア種類', 'メディアURL', '記事タイトル', '記事URL', '記事本文', '返信先の投稿 ID', '返信先ユーザー名', '会話 ID', ...embeddedCsvHeaders('返信先の投稿'), ...embeddedCsvHeaders('返信先投稿内の引用'), ...embeddedCsvHeaders('引用された投稿')]
const embeddedCsvValues = (post?: EmbeddedPost) => [
  post?.id || '',
  postTypeExportValue(post?.type),
  post?.text || '',
  post?.postUrl || '',
  post?.authorName || '',
  normalizeHandle(post?.username),
  post?.viewCount ?? '',
  '',
  post?.likeCount ?? '',
  post?.repostCount ?? '',
  post?.replyCount ?? '',
  post?.quoteCount ?? '',
  post?.createdAt ? csvDateText(post.createdAt) : '',
  mediaTypeText(post?.media),
  mediaUrlsText(post?.media)
]
const collectionToXporterCsv = (collection: Collection) => {
  const rows = collection.posts
    .slice()
    .sort((a, b) => dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt))
    .map(post => [
      post.id,
      displayPostText(post.text),
      postCanonicalUrl(post, collection.accountProfile?.username),
      post.language || '',
      postTypeExportValue(post.type),
      !isUnknownAuthorName(post.authorName) ? post.authorName : collection.accountProfile?.displayName || '',
      normalizeHandle(post.username || collection.accountProfile?.username),
      post.viewCount ?? '',
      post.sourceBookmarkCount ?? '',
      post.likeCount ?? '',
      post.repostCount ?? '',
      post.replyCount ?? '',
      post.quoteCount ?? '',
      csvDateText(post.createdAt),
      post.urls?.join(',') || '',
      mediaTypeText(post.media),
      mediaUrlsText(post.media),
      postArticleInfo(post)?.title || '',
      postArticleInfo(post)?.url || '',
      postArticleInfo(post)?.body || '',
      post.replyToPostId || post.repliedPost?.id || '',
      normalizeHandle(post.replyToUsername || post.repliedPost?.username),
      '',
      ...embeddedCsvValues(post.repliedPost),
      ...embeddedCsvValues(undefined),
      ...embeddedCsvValues(post.quotedPost)
    ])
  return `\ufeff${[xporterCsvHeaders, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`
}
const editableSourceText = (collection: Collection) => collection.sourceText ?? collectionToXporterCsv(collection)
const originalSourceText = (collection: Collection) => collection.originalSourceText ?? collection.sourceText ?? collectionToXporterCsv(collection)
const sourceFileName = (collection: Collection) => `${safeFileName(collection.title) || 'tweets'}.${collection.sourceFormat === 'XML' ? 'xml' : collection.sourceFormat === 'JSON' ? 'json' : 'csv'}`
const scrollPageTop = () => {
  const reset = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    document.querySelector<HTMLElement>('.phone-frame')?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  window.requestAnimationFrame(() => {
    reset()
    window.requestAnimationFrame(reset)
  })
}
type CsvTableData = { headers: string[]; rows: string[][] }
type CsvSearchResult = { key: string; rowIndex: number; columnIndex: number; header: boolean }
const normalizeCsvRow = (row: unknown[], width: number) => Array.from({ length: width }, (_, i) => String(row[i] ?? ''))
const csvTextToTable = (value: string): CsvTableData => {
  const parsed = Papa.parse<string[]>(value.replace(/^\ufeff/, ''), { skipEmptyLines: false })
  const rawRows = (parsed.data || []).filter(row => row.some(cell => String(cell ?? '').length > 0))
  const width = Math.max(1, ...rawRows.map(row => row.length))
  const headerRow = rawRows[0] || []
  const headers = normalizeCsvRow(headerRow, width).map((header, index) => header || `列${index + 1}`)
  const rows = rawRows.slice(1).map(row => normalizeCsvRow(row, width))
  return { headers, rows }
}
const csvTableToText = ({ headers, rows }: CsvTableData) => `\ufeff${Papa.unparse({ fields: headers, data: rows }, { newline: '\r\n' })}`
const createManualPost = (collection: Collection, draft: ManualPostDraft): Post => {
  const urlMatch = idFromPostUrl(draft.postUrl)
  const username = normalizeHandle(urlMatch?.[1] || collection.accountProfile?.username).replace(/^@/, '')
  const media = splitList(draft.mediaUrls).map(url => ({ url, type: isVideoMedia({ url }) ? 'video' : 'photo' }))
  const createdAt = draft.createdAt ? new Date(draft.createdAt).toISOString() : new Date().toISOString()
  return {
    id: urlMatch?.[2] || createId('manual'),
    text: draft.text.trim(),
    createdAt,
    authorName: collection.accountProfile?.displayName || collection.posts.find(post => !isUnknownAuthorName(post.authorName))?.authorName || collection.title,
    username,
    authorAvatarUrl: profileAvatarSrc(collection.accountProfile) || defaultProfileIcon,
    language: draft.language.trim(),
    type: draft.type,
    media: media.length ? media : undefined,
    replyCount: numericDraftValue(draft.replyCount),
    repostCount: numericDraftValue(draft.repostCount),
    likeCount: numericDraftValue(draft.likeCount),
    quoteCount: numericDraftValue(draft.quoteCount),
    sourceBookmarkCount: numericDraftValue(draft.bookmarkCount),
    viewCount: numericDraftValue(draft.viewCount),
    postUrl: draft.postUrl.trim() || undefined,
    urls: splitList(draft.postUrl).filter(Boolean),
    raw: { manual: 'true' }
  }
}

const messages = {
  ja: {
    appName: 'ついびゅ',
    languageName: '日本語',
    nav: { home: 'ホーム', bookmarks: 'ブックマーク', collections: 'コレクション', import: 'データ追加', settings: '設定', info: 'データ情報' },
    titles: { collections: 'コレクション', bookmarks: 'ブックマーク', import: 'データ追加', settings: '設定', info: 'データ情報' },
    searchSuffix: 'を検索',
    cancel: 'キャンセル',
    menu: 'メニュー',
    search: '検索',
    brandCounts: (posts: number, collections: number, locale: string) => `${numberText(posts, locale)} 件のツイート\n${numberText(collections, locale)} 件のコレクション`,
    labels: { account: 'アカウント', keyword: 'キーワード', hashtag: 'ハッシュタグ' } satisfies Record<CollectionType, string>,
    tabs: { posts: 'ツイート', replies: '返信', reposts: 'リツイート', media: 'メディア', latest: '最新', popular: '人気', sort: '並べ替え', newest: '新しい順' },
    searchTabs: { top: '話題のツイート', latest: '最新', media: 'メディア' },
    searchEmpty: { title: (query: string) => query ? `「${query}」の検索結果はありません` : '検索結果はありません', body: '別のキーワードを検索するか、検索条件を確認してください。' },
    advancedSearch: {
      title: '高度な検索',
      engagement: 'エンゲージメント',
      minReplies: '返信の最小件数',
      minLikes: 'いいねの最小件数',
      minReposts: 'リツイートの最小件数',
      exampleReplies: '例: 280 · 返信が280件以上のツイート',
      exampleLikes: '例: 280 · いいねが280件以上のツイート',
      exampleReposts: '例: 280 · リツイートが280件以上のツイート',
      dates: '日付',
      since: '次の日付以降',
      until: '次の日付以前',
      clear: 'クリア'
    },
    postCount: (count: number, locale: string) => `${numberText(count, locale)}件のツイート`,
    resultCount: (query: string, count: number, locale: string) => `「${query}」 ${numberText(count, locale)}件`,
    noPosts: '条件に一致するツイートがありません',
    joined: (value: string) => `${value} に登録`,
    following: 'フォロー中',
    followers: 'フォロワー',
    profile: { changePhoto: '写真を変更', edit: 'プロフィールを編集', mediaEdit: 'メディアを編集', save: '保存', apply: '適用', next: '次へ', name: '名前', bio: 'メモ', editImage: '画像を変更', removeImage: '画像を削除', imageUrl: '画像URL', imageUrlPlaceholder: 'https://example.com/image.jpg', imageFailed: '画像URLはURL形式で入力してください', imageSize: 'サイズ' },
    unknownAuthor: '不明なユーザー',
    renameCollection: 'コレクション名変更',
    renameCollectionPrompt: '名前を入力',
    mediaAlt: 'ツイートメディア',
    savedEmpty: '保存したツイートはありません',
    postMenu: {
      openUrl: 'ツイートURLを開く',
      copyUrl: 'ツイートURLをコピー',
      copyText: 'ツイートテキストをコピー',
      viewData: 'ツイートデータの詳細',
      copyData: 'ツイートデータをコピー',
      dataTitle: 'ツイートデータ',
      copiedUrl: 'ツイートURLをコピーしました',
      copiedText: 'ツイートテキストをコピーしました',
      copiedData: 'ツイートデータをコピーしました',
      copyFailed: 'コピーに失敗しました'
    },
    import: {
      title: 'データを追加',
      body: 'CSV、XML、またはX API JSONのツイートデータを、この端末だけで閲覧できます。',
      sourcesTitle: 'ツイートの取得方法',
      sourcesLead: '必要な人向けの補足です。基本はCSV/XML/JSONを用意して読み込んでください。',
      recommended: '補足',
      sourceOfficialTitle: 'X公式API',
      sourceOfficialBody: '取得したX API v2のJSONレスポンスを貼り付けるか、JSONファイルとして読み込めます。',
      sourceOfficialLink: '公式API',
      sourceXporterTitle: 'XPorter',
      sourceXporterBody: 'CSV/JSONを書き出せるオープンソースのChrome拡張機能です。',
      sourceXporterLink: 'GitHub',
      sourceManualTitle: '手動CSV',
      sourceManualBody: 'TwExportly、TwSearchExport、TwiBot、ついすぽ -Tweet Export- などのCSV形式に対応しています。',
      chooseFile: 'ファイルを選択',
      changeFile: 'タップして変更',
      downloadToolsTitle: '取得用ファイル',
      downloadPython: 'Python取得スクリプトをDL',
      kind: '表示する種類',
      titleLabel: 'タイトル（任意）',
      titlePlaceholder: '例: @OpenAI / #AI',
      loading: '読み込み中…',
      submit: '読み込んで追加',
      privacy: 'データはブラウザ内だけで処理・保存されます。',
      failure: '読み込みに失敗しました'
    },
    settings: {
      appearance: '表示',
      displayMode: '表示モード',
      language: '言語',
      font: 'フォント',
      autoRegion: '自動（地域に合わせる）',
      localData: 'ローカルデータ',
      legal: '規約とプライバシー',
      terms: '利用規約',
      privacyPolicy: 'プライバシーポリシー',
      delete: '削除',
      note: 'ツイートデータ、設定、ブックマークはこのブラウザのローカルストレージに保存されます。'
    },
    confirm: {
      deleteBookmarksTitle: 'ブックマークを削除しますか？',
      deleteBookmarksBody: 'この操作は取り消せません。保存したブックマークがこのブラウザから削除されます。',
      deleteCollectionTitle: 'コレクションを削除しますか？',
      deleteCollectionBody: (title: string) => `「${title}」と、その中のツイートデータを削除します。この操作は取り消せません。`,
      deleteRowTitle: 'この行を削除しますか？',
      deleteRowBody: (rowNumber: number) => `${rowNumber}行目を削除します。この操作は取り消せません。`,
      deleteAction: '削除',
      cancelAction: 'キャンセル'
    },
    legal: {
      termsTitle: '利用規約',
      privacyTitle: 'プライバシーポリシー',
      open: '開く',
      close: '閉じる',
      termsSections: [
        { heading: '本アプリについて', body: '本アプリは、ユーザーが用意したCSV/XML/JSON等のツイートデータをブラウザ内で閲覧・整理するためのローカルビューアです。X Corp.、Twitter、各取得ツールとは提携していません。' },
        { heading: '利用者の責任', body: 'インポートするデータの取得、保存、利用については、利用者自身の責任で行ってください。Xおよび利用する取得ツールの規約、法令、第三者の権利を尊重してください。' },
        { heading: '禁止事項', body: '不正取得したデータの利用、第三者の権利を侵害する利用、違法または迷惑行為につながる利用を禁止します。' },
        { heading: '免責', body: '本アプリの動作、表示内容、データの完全性・正確性・保存継続性は保証されません。重要なデータは必ず別途バックアップしてください。' },
        { heading: '変更', body: '本アプリの機能や本規約は、必要に応じて変更される場合があります。' }
      ],
      privacySections: [
        { heading: '処理するデータ', body: '本アプリは、ユーザーが選択または貼り付けたCSV/XML/JSONデータ、ブックマーク、表示設定、コレクション情報を扱います。' },
        { heading: '保存場所', body: '読み込んだツイートデータ、設定、ブックマークは、このブラウザのローカルストレージに保存されます。' },
        { heading: '外部送信', body: '通常の利用では、インポートしたファイル内容を本アプリのサーバーへ送信しません。外部リンクを開いた場合は、リンク先サービスのポリシーが適用されます。' },
        { heading: '削除', body: 'コレクションやブックマークはアプリ内の削除機能で削除できます。ブラウザのサイトデータを削除すると、保存済みデータも削除されます。' },
        { heading: '注意', body: '共有端末や公共端末では、インポートしたデータがブラウザ内に残る可能性があります。利用後は必要に応じてデータを削除してください。' }
      ]
    },
    theme: { light: 'Light', dark: 'Dark', system: 'System' },
    font: { noto: 'Noto Sans + Inter', system: 'システム標準フォント' },
    infoLabels: { target: '表示するコレクション', collection: 'コレクション', type: '種類', posts: 'ツイート数', period: '期間', source: 'ソース', imported: '読み込み日時', format: '形式' },
    infoActions: { addPost: 'ツイートを追加', exportCsv: 'CSVを書き出し' },
    sourceEditor: {
      title: 'ソースデータ',
      body: 'CSV/XML/JSONを直接編集できます。保存するとこのコレクションを再読み込みし、ホームにも反映されます。',
      generated: '元ファイルの内容が保存されていないため、現在の投稿からXPorter形式のCSVを生成して表示しています。',
      loadGenerated: 'CSV編集を開く',
      largeGenerated: 'データが大きいため、CSV編集欄は必要なときだけ生成します。',
      save: '変更を保存',
      reset: '読み込み時に戻す',
      fullscreen: '全画面で編集',
      closeFullscreen: '全画面を閉じる',
      saved: 'ソースデータを保存しました',
      resetDone: '読み込み時の状態に戻しました',
      error: '解析できませんでした'
    },
    addPost: {
      title: 'ツイートを追加',
      text: '本文',
      textPlaceholder: 'ツイート本文を入力',
      postUrl: '投稿URL',
      postUrlPlaceholder: 'https://x.com/user/status/...',
      createdAt: '投稿日時',
      type: '種類',
      language: '言語',
      mediaUrls: 'メディアURL',
      mediaHelp: '複数ある場合は改行またはカンマ区切り',
      replyCount: '返信数',
      repostCount: 'リツイート数',
      likeCount: 'いいね数',
      quoteCount: '引用数',
      bookmarkCount: 'ブックマーク数',
      viewCount: '表示回数',
      save: '追加'
    },
    filter: { title: 'フィルター', mediaOnly: 'メディアを含むツイートのみ', apply: '適用' },
    detail: { title: 'ツイート', back: '戻る', origin: (title: string) => `${title} のアーカイブ`, open: 'Xで開く', views: (count: number, locale: string) => `${numberText(count, locale)} 件の表示` },
    empty: {
      title: 'アーカイブを読み込む',
      body: 'CSV、XML、またはX API JSONを追加すると、ツイートをX風の画面で閲覧できます。',
      action: 'データを追加'
    },
    toast: {
      bookmarkRemoved: 'ブックマークを解除しました',
      bookmarkSaved: 'ブックマークに保存しました',
      importDone: (count: number, warnings: number, locale: string) => `${numberText(count, locale)}件を読み込みました${warnings ? `（警告 ${numberText(warnings, locale)}件）` : ''}`,
      bookmarksCleared: 'ブックマークを削除しました',
      collectionDeleted: 'コレクションを削除しました',
      profilePhotoUpdated: 'プロフィールを変更しました',
      profilePhotoFailed: 'プロフィールを変更できませんでした',
      postAdded: 'ツイートを追加しました',
      csvExported: 'CSVを書き出しました'
    }
  },
  en: {
    appName: 'TwView',
    languageName: 'English',
    nav: { home: 'Home', bookmarks: 'Bookmarks', collections: 'Collections', import: 'Import Data', settings: 'Settings', info: 'Data information' },
    titles: { collections: 'Collections', bookmarks: 'Bookmarks', import: 'Import', settings: 'Settings', info: 'Data information' },
    searchSuffix: ' search',
    cancel: 'Cancel',
    menu: 'Menu',
    search: 'Search',
    brandCounts: (posts: number, collections: number, locale: string) => `${numberText(posts, locale)} Posts\n${numberText(collections, locale)} Collections`,
    labels: { account: 'Account', keyword: 'Keyword', hashtag: 'Hashtag' } satisfies Record<CollectionType, string>,
    tabs: { posts: 'Posts', replies: 'Replies', reposts: 'Retweets', media: 'Media', latest: 'Latest', popular: 'Popular', sort: 'Sort', newest: 'Newest' },
    searchTabs: { top: 'Top', latest: 'Latest', media: 'Media' },
    searchEmpty: { title: (query: string) => query ? `No results for "${query}"` : 'No results', body: 'Try searching for another keyword or checking your search terms.' },
    advancedSearch: {
      title: 'Advanced search',
      engagement: 'Engagement',
      minReplies: 'Minimum replies',
      minLikes: 'Minimum likes',
      minReposts: 'Minimum reposts',
      exampleReplies: 'Example: 280 · Posts with at least 280 replies',
      exampleLikes: 'Example: 280 · Posts with at least 280 likes',
      exampleReposts: 'Example: 280 · Posts with at least 280 reposts',
      dates: 'Dates',
      since: 'Since this date',
      until: 'Until this date',
      clear: 'Clear'
    },
    postCount: (count: number, locale: string) => `${numberText(count, locale)} posts`,
    resultCount: (query: string, count: number, locale: string) => `"${query}" ${numberText(count, locale)} results`,
    noPosts: 'No posts match the current filters',
    joined: (value: string) => `Joined ${value}`,
    following: 'Following',
    followers: 'Followers',
    profile: { changePhoto: 'Change photo', edit: 'Edit profile', mediaEdit: 'Edit media', save: 'Save', apply: 'Apply', next: 'Next', name: 'Name', bio: 'Memo', editImage: 'Change image', removeImage: 'Remove image', imageUrl: 'Image URL', imageUrlPlaceholder: 'https://example.com/image.jpg', imageFailed: 'Enter a valid image URL', imageSize: 'Size' },
    unknownAuthor: 'Unknown author',
    renameCollection: 'Rename collection',
    renameCollectionPrompt: 'Enter name',
    mediaAlt: 'Post media',
    savedEmpty: 'No saved posts yet',
    postMenu: {
      openUrl: 'Open post URL',
      copyUrl: 'Copy post URL',
      copyText: 'Copy post text',
      viewData: 'View post data',
      copyData: 'Copy post data',
      dataTitle: 'Post data',
      copiedUrl: 'Post URL copied',
      copiedText: 'Post text copied',
      copiedData: 'Post data copied',
      copyFailed: 'Copy failed'
    },
    import: {
      title: 'Add data',
      body: 'View CSV, XML, or X API JSON post data locally on this device.',
      sourcesTitle: 'How to get tweets',
      sourcesLead: 'A quiet note for users who need it. In most cases, prepare a CSV/XML/JSON file and import it here.',
      recommended: 'Note',
      sourceOfficialTitle: 'X API',
      sourceOfficialBody: 'Paste an X API v2 JSON response here, or import it as a JSON file.',
      sourceOfficialLink: 'Official API',
      sourceXporterTitle: 'XPorter',
      sourceXporterBody: 'An open-source Chrome extension for exporting CSV/JSON.',
      sourceXporterLink: 'GitHub',
      sourceManualTitle: 'Manual CSV',
      sourceManualBody: 'Supports CSV formats from TwExportly, TwSearchExport, TwiBot, Tsuisupo -Tweet Export-, and similar tools.',
      chooseFile: 'Choose a file',
      changeFile: 'Tap to change',
      downloadToolsTitle: 'Download helpers',
      downloadPython: 'Download Python fetcher',
      kind: 'Collection type',
      titleLabel: 'Title (optional)',
      titlePlaceholder: 'Example: @OpenAI / #AI',
      loading: 'Importing…',
      submit: 'Import and add',
      privacy: 'Data is processed and saved only in this browser.',
      failure: 'Import failed'
    },
    settings: {
      appearance: 'APPEARANCE',
      displayMode: 'Display mode',
      language: 'Language',
      font: 'Font',
      autoRegion: 'Auto by region',
      localData: 'LOCAL DATA',
      legal: 'LEGAL AND PRIVACY',
      terms: 'Terms of use',
      privacyPolicy: 'Privacy policy',
      delete: 'Delete',
      note: 'Posts, settings, and bookmarks are saved in this browser’s local storage.'
    },
    confirm: {
      deleteBookmarksTitle: 'Delete bookmarks?',
      deleteBookmarksBody: 'This cannot be undone. Saved bookmarks will be removed from this browser.',
      deleteCollectionTitle: 'Delete collection?',
      deleteCollectionBody: (title: string) => `"${title}" and its posts will be deleted. This cannot be undone.`,
      deleteRowTitle: 'Delete this row?',
      deleteRowBody: (rowNumber: number) => `Row ${rowNumber} will be deleted. This cannot be undone.`,
      deleteAction: 'Delete',
      cancelAction: 'Cancel'
    },
    legal: {
      termsTitle: 'Terms of use',
      privacyTitle: 'Privacy policy',
      open: 'Open',
      close: 'Close',
      termsSections: [
        { heading: 'About this app', body: 'This app is a local viewer for browsing and organizing tweet data from CSV/XML/JSON data prepared by the user. It is not affiliated with X Corp., Twitter, or any export tool.' },
        { heading: 'User responsibility', body: 'You are responsible for how you obtain, store, and use imported data. Please respect the terms of X, any export tools you use, applicable laws, and third-party rights.' },
        { heading: 'Prohibited use', body: 'Do not use this app with unlawfully obtained data, for rights-infringing activity, or for illegal or abusive purposes.' },
        { heading: 'Disclaimer', body: 'The app does not guarantee operation, display accuracy, data completeness, or continued storage. Keep separate backups of important data.' },
        { heading: 'Changes', body: 'Features and these terms may be updated when necessary.' }
      ],
      privacySections: [
        { heading: 'Data processed', body: 'This app handles CSV/XML/JSON data selected or pasted by the user, bookmarks, display settings, and collection information.' },
        { heading: 'Storage location', body: 'Imported tweet data, settings, and bookmarks are saved in this browser’s local storage.' },
        { heading: 'External transmission', body: 'During normal use, imported file contents are not sent to this app’s server. If you open external links, the destination service’s policy applies.' },
        { heading: 'Deletion', body: 'Collections and bookmarks can be deleted in the app. Clearing browser site data will also remove saved data.' },
        { heading: 'Note', body: 'On shared or public devices, imported data may remain in the browser. Delete data after use when needed.' }
      ]
    },
    theme: { light: 'Light', dark: 'Dark', system: 'System' },
    font: { noto: 'Noto Sans + Inter', system: 'System default' },
    infoLabels: { target: 'Collection to show', collection: 'Collection', type: 'Type', posts: 'Posts', period: 'Period', source: 'Source', imported: 'Imported', format: 'Format' },
    infoActions: { addPost: 'Add tweet', exportCsv: 'Export CSV' },
    sourceEditor: {
      title: 'Source data',
      body: 'Edit the CSV/XML/JSON directly. Saving re-imports this collection and updates Home immediately.',
      generated: 'The original file text was not saved, so this viewer shows a generated XPorter-style CSV from the current posts.',
      loadGenerated: 'Open CSV editor',
      largeGenerated: 'This data is large, so the CSV editor is generated only when needed.',
      save: 'Save changes',
      reset: 'Reset to imported file',
      fullscreen: 'Edit fullscreen',
      closeFullscreen: 'Close fullscreen',
      saved: 'Source data saved',
      resetDone: 'Reset to the imported file',
      error: 'Could not parse the source data'
    },
    addPost: {
      title: 'Add tweet',
      text: 'Text',
      textPlaceholder: 'Enter tweet text',
      postUrl: 'Post URL',
      postUrlPlaceholder: 'https://x.com/user/status/...',
      createdAt: 'Created at',
      type: 'Type',
      language: 'Language',
      mediaUrls: 'Media URLs',
      mediaHelp: 'Use new lines or commas for multiple URLs',
      replyCount: 'Replies',
      repostCount: 'Retweets',
      likeCount: 'Likes',
      quoteCount: 'Quotes',
      bookmarkCount: 'Bookmarks',
      viewCount: 'Views',
      save: 'Add'
    },
    filter: { title: 'Filter', mediaOnly: 'Posts with media only', apply: 'Apply' },
    detail: { title: 'Post', back: 'Back', origin: (title: string) => `${title} archive`, open: 'Open in X', views: (count: number, locale: string) => `${numberText(count, locale)} views` },
    empty: {
      title: 'Import an archive',
      body: 'Add a CSV, XML, or X API JSON file to browse posts in an X-style view.',
      action: 'Add data'
    },
    toast: {
      bookmarkRemoved: 'Bookmark removed',
      bookmarkSaved: 'Saved to bookmarks',
      importDone: (count: number, warnings: number, locale: string) => `${numberText(count, locale)} posts imported${warnings ? ` (${numberText(warnings, locale)} warnings)` : ''}`,
      bookmarksCleared: 'Bookmarks deleted',
      collectionDeleted: 'Collection deleted',
      profilePhotoUpdated: 'Profile updated',
      profilePhotoFailed: 'Could not update profile',
      postAdded: 'Tweet added',
      csvExported: 'CSV exported'
    }
  }
}
type Copy = typeof messages.ja

function App() {
  const savedSettings = load<SettingsState>(settingsKey, {})
  const [collections, setCollections] = useState<Collection[]>(() => load(collectionsKey, []))
  const [activeId, setActiveId] = useState<string | null>(() => load<string | null>('x-archive-active', null))
  const [bookmarks, setBookmarks] = useState<string[]>(() => load(bookmarksKey, []))
  const [view, setView] = useState<View>(() => load<View>('x-archive-view', 'timeline'))
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedSearchFilters>(emptyAdvancedFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  const [confirmingClearBookmarks, setConfirmingClearBookmarks] = useState(false)
  const [renamingCollection, setRenamingCollection] = useState<Collection | null>(null)
  const [deletingCollection, setDeletingCollection] = useState<Collection | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [mediaOnly, setMediaOnly] = useState(false)
  const [detail, setDetail] = useState<Post | null>(null)
  const [detailCollectionId, setDetailCollectionId] = useState<string | null>(null)
  const [mediaViewer, setMediaViewer] = useState<MediaViewerState | null>(null)
  const [infoCollectionId, setInfoCollectionId] = useState('')
  const [addingPostCollection, setAddingPostCollection] = useState<Collection | null>(null)
  const [toast, setToast] = useState('')
  const [theme, setTheme] = useState<Theme>(() => savedSettings.theme || 'system')
  const [language, setLanguage] = useState<LanguageSetting>(() => savedSettings.language || 'auto')
  const [font, setFont] = useState<FontSetting>(() => resolveFont(savedSettings.font))
  const detailHydrated = useRef(false)
  const active = collections.find(c => c.id === activeId) ?? collections[0]
  const detailCollection = collections.find(c => c.id === detailCollectionId) ?? active
  const infoCollection = collections.find(c => c.id === infoCollectionId) ?? active
  const appLanguage = useMemo(() => resolveLanguage(language), [language])
  const locale = localeOf(appLanguage)
  const copy = messages[appLanguage]

  useEffect(() => {
    const loader = document.getElementById('app-startup-loader')
    if (!loader) return
    loader.classList.add('is-hidden')
    const timer = window.setTimeout(() => loader.remove(), 180)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!collections.length && view === 'info') setView('import')
  }, [collections.length, view])

  useEffect(() => {
    const saved = saveCollections(collections)
    if (saved === 'without-source') setToast('データが大きいため、元ファイル全文は保存せずに追加しました')
    if (saved === 'compact') setToast('データが大きいため、軽量形式で保存しました')
    if (saved === 'failed') setToast('データが大きすぎるため、このブラウザに保存できませんでした')
  }, [collections])
  useEffect(() => { saveJson(bookmarksKey, bookmarks) }, [bookmarks])
  useEffect(() => { saveJson('x-archive-active', active?.id ?? null) }, [active])
  useEffect(() => { saveJson('x-archive-view', view) }, [view])
  useEffect(() => {
    if (!detailHydrated.current) return
    if (detail && detailCollectionId) saveJson(detailStateKey, { collectionId: detailCollectionId, postId: detail.id })
    else localStorage.removeItem(detailStateKey)
  }, [detail, detailCollectionId])
  useEffect(() => {
    if (detailHydrated.current || detail || mediaViewer) return
    if (!collections.length) {
      detailHydrated.current = true
      localStorage.removeItem(detailStateKey)
      return
    }
    const saved = load<{ collectionId?: string; postId?: string } | null>(detailStateKey, null)
    if (!saved?.postId) {
      detailHydrated.current = true
      return
    }
    const collection = collections.find(item => item.id === saved.collectionId) ?? collections.find(item => item.posts.some(post => post.id === saved.postId))
    const post = collection?.posts.find(item => item.id === saved.postId)
    if (!collection || !post) {
      localStorage.removeItem(detailStateKey)
      detailHydrated.current = true
      return
    }
    setActiveId(collection.id)
    setView('timeline')
    setDetailCollectionId(collection.id)
    setDetail(post)
    detailHydrated.current = true
  }, [collections, detail, mediaViewer])
  useEffect(() => {
    saveJson(settingsKey, { theme, language, font })
    const resolvedTheme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
    document.documentElement.dataset.font = font
    document.documentElement.lang = appLanguage
  }, [theme, language, font, appLanguage])
  useEffect(() => {
    if (!detail && !mediaViewer) return
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll
    }
  }, [detail, mediaViewer])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2200); return () => clearTimeout(timer) }, [toast])

  const closeDetail = useCallback(() => {
    localStorage.removeItem(detailStateKey)
    setDetail(null)
    setDetailCollectionId(null)
  }, [])
  const openDetail = useCallback((post: Post, collection?: Collection) => {
    const collectionId = collection?.id ?? active?.id ?? null
    if (collectionId) setDetailCollectionId(collectionId)
    setDetail(post)
  }, [active?.id])
  const select = (collection: Collection) => { setActiveId(collection.id); setView('timeline'); closeDetail(); setQuery(''); setSearchDraft(''); setAdvancedSearchOpen(false); setDrawer(false); scrollPageTop() }
  const toggleBookmark = useCallback((post: Post) => {
    const saved = bookmarks.includes(post.id)
    setBookmarks(saved ? bookmarks.filter(x => x !== post.id) : [...bookmarks, post.id])
    setToast(saved ? copy.toast.bookmarkRemoved : copy.toast.bookmarkSaved)
  }, [bookmarks, copy.toast])
  const copyToClipboard = useCallback(async (value: string, successMessage: string) => {
    setToast(await writeClipboard(value) ? successMessage : copy.postMenu.copyFailed)
  }, [copy.postMenu.copyFailed])
  const updateProfile = useCallback((collection: Collection, profile: Profile) => {
    try {
      setCollections(prev => prev.map(item => {
        if (item.id !== collection.id) return item
        const displayName = profile.displayName?.trim()
        return {
          ...item,
          title: displayName || item.title,
          query: displayName && item.query === item.title ? displayName : item.query,
          accountProfile: { ...(item.accountProfile || {}), ...profile, displayName: displayName || profile.displayName }
        }
      }))
      setToast(copy.toast.profilePhotoUpdated)
    } catch {
      setToast(copy.toast.profilePhotoFailed)
    }
  }, [copy.toast.profilePhotoFailed, copy.toast.profilePhotoUpdated])
  const addManualPost = useCallback((collection: Collection, draft: ManualPostDraft) => {
    const post = createManualPost(collection, draft)
    setCollections(prev => prev.map(item => item.id === collection.id ? { ...item, posts: [post, ...item.posts].sort((a, b) => dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt)) } : item))
    setAddingPostCollection(null)
    setToast(copy.toast.postAdded)
  }, [copy.toast.postAdded])
  const exportCollectionCsv = useCallback((collection: Collection) => {
    downloadTextFile(`${safeFileName(collectionDisplayTitle(collection))}-xporter.csv`, collectionToXporterCsv(collection))
    setToast(copy.toast.csvExported)
  }, [copy.toast.csvExported])
  const saveCollectionSource = useCallback(async (collection: Collection, sourceText: string, reset = false) => {
    const file = new File([sourceText], sourceFileName(collection), { type: collection.sourceFormat === 'XML' ? 'text/xml' : collection.sourceFormat === 'JSON' ? 'application/json' : 'text/csv' })
    const result = await importText(sourceText, file.name)
    const parsed = result.collection
    const nextPosts = parsed.posts
    const keepSourceText = sourceText.length <= storedSourceTextLimit && nextPosts.length <= largeCollectionPostLimit
    setCollections(prev => prev.map(item => item.id === collection.id ? {
      ...item,
      posts: keepSourceText ? nextPosts : nextPosts.map(({ raw, ...post }) => post),
      accountProfile: parsed.accountProfile ? { ...(item.accountProfile || {}), ...parsed.accountProfile } : item.accountProfile,
      sourceFormat: parsed.sourceFormat,
      sourceText: keepSourceText ? sourceText : undefined,
      originalSourceText: keepSourceText ? item.originalSourceText ?? item.sourceText ?? collectionToXporterCsv(item) : undefined,
      sourcePeriod: parsed.sourcePeriod
    } : item))
    const validPostIds = new Set(nextPosts.map(post => post.id))
    if (detailCollectionId === collection.id && detail && !validPostIds.has(detail.id)) closeDetail()
    setMediaViewer(prev => prev && prev.collection?.id === collection.id && !validPostIds.has(prev.post.id) ? null : prev)
    setToast(reset ? copy.sourceEditor.resetDone : copy.sourceEditor.saved)
  }, [closeDetail, copy.sourceEditor.resetDone, copy.sourceEditor.saved, detail, detailCollectionId])
  const startRenameCollection = useCallback((collection: Collection) => {
    setRenamingCollection(collection)
    setRenameDraft(collectionDisplayTitle(collection))
  }, [])
  const saveRenameCollection = useCallback(() => {
    if (!renamingCollection) return
    const title = renameDraft.trim()
    if (title && title !== renamingCollection.title) {
      setCollections(prev => prev.map(item => item.id === renamingCollection.id ? {
        ...item,
        title,
        query: item.query === item.title ? title : item.query,
        accountProfile: item.type === 'account' ? { ...(item.accountProfile || {}), displayName: title } : item.accountProfile
      } : item))
    }
    setRenamingCollection(null)
    setRenameDraft('')
  }, [renameDraft, renamingCollection])
  const deleteCollection = useCallback(() => {
    if (!deletingCollection) return
    const deletedPostIds = new Set(deletingCollection.posts.map(post => post.id))
    const nextCollections = collections.filter(item => item.id !== deletingCollection.id)
    setCollections(nextCollections)
    if (active?.id === deletingCollection.id) {
      const nextActive = nextCollections[0]
      setActiveId(nextActive?.id ?? null)
      if (!nextActive && view === 'timeline') setView('collections')
    }
    if (infoCollectionId === deletingCollection.id) setInfoCollectionId('')
    setBookmarks(prev => prev.filter(id => !deletedPostIds.has(id)))
    closeDetail()
    setMediaViewer(null)
    setDeletingCollection(null)
    setToast(copy.toast.collectionDeleted)
  }, [active?.id, closeDetail, collections, copy.toast.collectionDeleted, deletingCollection, infoCollectionId, view])
  const beginImport = async (file: File, choice?: CollectionType, title?: string) => {
    const sourceText = await file.text()
    const result = await importText(sourceText, file.name)
    const chosenType = choice ?? result.collection.type
    const chosenTitle = title?.trim() || (chosenType === 'account' ? result.collection.accountProfile?.displayName : '') || result.collection.title
    const collectionBase = { ...result.collection, type: chosenType, title: chosenTitle, query: chosenTitle || result.collection.query, accountProfile: chosenType === 'account' ? { ...(result.collection.accountProfile || {}), displayName: chosenTitle } : result.collection.accountProfile }
    const collection = collectionWithStoredSource(collectionBase, sourceText)
    setCollections(prev => [collection, ...prev])
    setActiveId(collection.id)
    setView('timeline')
    scrollPageTop()
    setToast(copy.toast.importDone(collection.posts.length, result.warnings.length, locale))
  }
  const nav = (target: View) => { closeDetail(); setMediaViewer(null); setView(target); setDrawer(false); setSearching(false); setAdvancedSearchOpen(false); setQuery(''); setSearchDraft(''); scrollPageTop() }
  const clearBookmarks = () => {
    setBookmarks([])
    setConfirmingClearBookmarks(false)
    setToast(copy.toast.bookmarksCleared)
  }
  const allPosts = useMemo(() => collections.flatMap(c => c.posts.map(post => ({ post, collection: c }))), [collections])
  const bookmarkIdSet = useMemo(() => new Set(bookmarks), [bookmarks])
  const bookmarkedItems = useMemo(() => allPosts.filter(x => bookmarkIdSet.has(x.post.id)), [allPosts, bookmarkIdSet])
  const title = view === 'timeline' && active ? collectionDisplayTitle(active) : copy.titles[view as Exclude<View, 'timeline'>]
  const timelineHeader = view === 'timeline' && !!active
  const timelineHeaderTitle = timelineHeader ? (active.accountProfile?.displayName || active.posts.find(post => !isUnknownAuthorName(post.authorName))?.authorName || collectionDisplayTitle(active)) : title
  const hasSearchableData = allPosts.length > 0
  const searchableView = hasSearchableData && (view === 'timeline' || view === 'bookmarks')
  const closeMediaViewer = () => {
    const compactMediaViewer = window.matchMedia('(max-width: 900px)').matches
    if (mediaViewer && compactMediaViewer) {
      if (mediaViewer.collection) setActiveId(mediaViewer.collection.id)
      openDetail(mediaViewer.post, mediaViewer.collection ?? active)
    }
    setMediaViewer(null)
  }
  useBodyScrollLock(Boolean(mediaViewer))
  useDetailScrollbarHidden(Boolean(detail))

  return <div className="app-shell">
    <aside className="desktop-nav"><DrawerContent collections={collections} total={allPosts.length} currentView={view} copy={copy} locale={locale} onNav={nav} onSelect={select} activeId={active?.id} /></aside>
    <main className="phone-frame">
      {view !== 'import' && <Header title={timelineHeaderTitle || copy.appName} subtitle={timelineHeader ? copy.postCount(active.posts.length, locale) : undefined} profile={timelineHeader} copy={copy} searchable={searchableView} searching={searchableView && searching} query={searchDraft} onMenu={() => setDrawer(true)} onBack={() => nav('collections')} onSearch={() => { setSearchDraft(query); setSearching(true) }} onQuery={setSearchDraft} onSubmitSearch={() => setQuery(searchDraft.trim())} onAdvancedSearch={() => setAdvancedSearchOpen(true)} onCancel={() => { setSearching(false); setAdvancedSearchOpen(false); setQuery(''); setSearchDraft(''); setAdvancedFilters(emptyAdvancedFilters) }} />}
      {view === 'timeline' && active && <Timeline collection={active} copy={copy} locale={locale} query={query} advancedFilters={advancedFilters} mediaOnly={mediaOnly} bookmarks={bookmarks} onBookmark={toggleBookmark} onDetail={post => openDetail(post, active)} onMediaOpen={(post, collection, index) => setMediaViewer({ post, collection, index })} onCopy={copyToClipboard} onFilter={() => setFilterOpen(true)} onProfileEdit={updateProfile} />}
      {view === 'timeline' && !active && <EmptyState copy={copy} onImport={() => nav('import')} />}
      {view === 'collections' && <CollectionList collections={collections} copy={copy} locale={locale} onSelect={select} onRename={startRenameCollection} onDelete={setDeletingCollection} onImport={() => nav('import')} />}
      {view === 'bookmarks' && <Bookmarks items={bookmarkedItems} copy={copy} locale={locale} query={query} bookmarks={bookmarks} onBookmark={toggleBookmark} onDetail={openDetail} onMediaOpen={(post, collection, index) => setMediaViewer({ post, collection, index })} onCopy={copyToClipboard} />}
      {view === 'import' && <ImportView copy={copy} onImport={beginImport} onBack={active ? () => nav('timeline') : undefined} onMenu={() => setDrawer(true)} />}
      {view === 'settings' && <SettingsView theme={theme} language={language} font={font} appLanguage={appLanguage} copy={copy} setTheme={setTheme} setLanguage={setLanguage} setFont={setFont} onClearBookmarks={() => setConfirmingClearBookmarks(true)} />}
      {view === 'info' && infoCollection && <InfoView collections={collections} collection={infoCollection} copy={copy} locale={locale} onSelect={setInfoCollectionId} onAddPost={setAddingPostCollection} onExportCsv={exportCollectionCsv} onSaveSource={saveCollectionSource} />}
      {detail && <PostDetail post={detail} collection={detailCollection} copy={copy} locale={locale} bookmarked={bookmarks.includes(detail.id)} onBack={closeDetail} onBookmark={toggleBookmark} onDetail={post => openDetail(post, detailCollection)} onMediaOpen={(post, index) => setMediaViewer({ post, collection: detailCollection, index })} onCopy={copyToClipboard} />}
    </main>
    {advancedSearchOpen && <AdvancedSearchDialog copy={copy} filters={advancedFilters} setFilters={setAdvancedFilters} onClose={() => setAdvancedSearchOpen(false)} onSearch={() => { setQuery(searchDraft.trim()); setAdvancedSearchOpen(false) }} />}
    {drawer && <><Scrim onClick={() => setDrawer(false)} /><aside className="drawer"><DrawerContent collections={collections} total={allPosts.length} currentView={view} copy={copy} locale={locale} onNav={nav} onSelect={select} activeId={active?.id} /></aside></>}
    {filterOpen && <FilterSheet copy={copy} mediaOnly={mediaOnly} setMediaOnly={setMediaOnly} onClose={() => setFilterOpen(false)} />}
    {addingPostCollection && <AddPostDialog collection={addingPostCollection} copy={copy} appLanguage={appLanguage} onSave={addManualPost} onCancel={() => setAddingPostCollection(null)} />}
    {renamingCollection && <RenameCollectionDialog copy={copy} value={renameDraft} onChange={setRenameDraft} onSave={saveRenameCollection} onCancel={() => { setRenamingCollection(null); setRenameDraft('') }} />}
    {deletingCollection && <ConfirmDialog title={copy.confirm.deleteCollectionTitle} body={copy.confirm.deleteCollectionBody(deletingCollection.title)} confirmLabel={copy.confirm.deleteAction} cancelLabel={copy.confirm.cancelAction} onConfirm={deleteCollection} onCancel={() => setDeletingCollection(null)} />}
    {confirmingClearBookmarks && <ConfirmDialog title={copy.confirm.deleteBookmarksTitle} body={copy.confirm.deleteBookmarksBody} confirmLabel={copy.confirm.deleteAction} cancelLabel={copy.confirm.cancelAction} onConfirm={clearBookmarks} onCancel={() => setConfirmingClearBookmarks(false)} />}
    {mediaViewer && <MediaViewer state={mediaViewer} copy={copy} locale={locale} bookmarked={bookmarks.includes(mediaViewer.post.id)} onClose={closeMediaViewer} onBookmark={toggleBookmark} onCopy={copyToClipboard} onNavigate={index => setMediaViewer(prev => prev ? { ...prev, index } : prev)} />}
    {toast && <div className="toast">{toast}</div>}
  </div>
}

function Header({ title, subtitle, profile, copy, searchable, searching, query, onMenu, onBack, onSearch, onQuery, onSubmitSearch, onAdvancedSearch, onCancel }: { title: string; subtitle?: string; profile?: boolean; copy: Copy; searchable?: boolean; searching: boolean; query: string; onMenu: () => void; onBack?: () => void; onSearch: () => void; onQuery: (v: string) => void; onSubmitSearch: () => void; onAdvancedSearch: () => void; onCancel: () => void }) {
  if (searching) return <header className="header search-header"><button className="icon-button" onClick={onCancel} aria-label={copy.cancel}><X size={21} /></button><form className="search-field" onSubmit={e => { e.preventDefault(); onSubmitSearch() }}><button type="submit" aria-label={copy.search}><Search size={18} /></button><input autoFocus value={query} onChange={e => onQuery(e.target.value)} placeholder={`${title}${copy.searchSuffix}`} /></form><button className="icon-button" onClick={onAdvancedSearch} aria-label={copy.advancedSearch.title}><Ellipsis size={20} /></button></header>
  const searchButton = searchable ? <button className="icon-button" onClick={onSearch} aria-label={copy.search}><Search /></button> : <span aria-hidden="true" />
  if (profile) return <header className="header app-header profile-app-header"><button className="icon-button" onClick={onBack || onMenu} aria-label={copy.detail.back}><BackIcon /></button><span className="profile-header-title"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>{searchButton}</header>
  return <header className="header app-header"><button className="icon-button" onClick={onMenu} aria-label={copy.menu}><Menu /></button><strong className="header-title">{title === copy.appName ? <img className="header-logo" src={appLogoPath} alt={copy.appName} /> : title}</strong>{searchButton}</header>
}

function NavIcon({ name, active }: { name: NavIconName; active: boolean }) {
  return <span className={`nav-icon nav-icon-${name}${active ? ' active' : ''}`} aria-hidden="true"><img src={`${buttonIconBase}${name}${active ? '_ac' : ''}.svg`} alt="" /></span>
}

function CollectionTypeIcon({ type }: { type: CollectionType }) {
  const iconName = type === 'account' ? 'user' : type
  return <img className="collection-type-icon" src={`${sidebarCollectionIconBase}${iconName}.svg`} alt="" aria-hidden="true" />
}

function CollectionAvatarIcon({ collection }: { collection: Collection }) {
  const avatarUrl = collection.type === 'account' ? profileAvatarSrc(collection.accountProfile) : ''
  if (avatarUrl) return <img className="collection-avatar-icon" src={avatarUrl} alt="" aria-hidden="true" onError={e => useDefaultProfileIcon(e.currentTarget)} />
  return <CollectionTypeIcon type={collection.type} />
}

function PostActionIcon({ name }: { name: 'reply' | 'retweet' | 'like' | 'impression' }) {
  return <img className="post-action-icon" src={`${postIconBase}${name}.svg`} alt="" aria-hidden="true" />
}

function PostBookmarkIcon({ marked }: { marked: boolean }) {
  return <span className={`post-image-icon bookmark-image-icon ${marked ? 'marked-icon' : ''}`} aria-hidden="true"><img className="icon-default" src={`${postIconBase}bookmark${marked ? '_mk' : ''}.svg`} alt="" />{!marked && <img className="icon-hover" src={`${postIconBase}bookmark_ho.svg`} alt="" />}</span>
}

function PostShareIcon() {
  return <span className="post-image-icon share-image-icon" aria-hidden="true"><img className="icon-default" src={`${postIconBase}share.svg`} alt="" /><img className="icon-hover" src={`${postIconBase}share_ho.svg`} alt="" /></span>
}

function MediaGrid({ media, copy, className = '', onMediaOpen }: { media: Media[]; copy: Copy; className?: string; onMediaOpen?: (index: number) => void }) {
  const items = displayMediaItems(media)
  return <div className={`media-grid ${className}`.trim()}>{items.slice(0, 4).map((m, i) => <MediaItem key={`${m.url}-${i}`} media={m} copy={copy} index={i} onMediaOpen={onMediaOpen} />)}</div>
}
const videoMimeType = (url: string) => /\.webm(?:[?#].*)?$/i.test(url) ? 'video/webm' : /\.mov(?:[?#].*)?$/i.test(url) ? 'video/quicktime' : /\.m3u8(?:[?#].*)?$/i.test(url) ? 'application/x-mpegURL' : 'video/mp4'
function MediaItem({ media, copy, index, onMediaOpen }: { media: Media; copy: Copy; index: number; onMediaOpen?: (index: number) => void }) {
  const [videoFailed, setVideoFailed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const imageFallback = <span className="media-fallback-content"><Image size={28} strokeWidth={1.8} /><span>メディアを表示できません</span></span>
  if (isVideoMedia(media) && videoFailed) {
    const content = media.posterUrl ? <img src={media.posterUrl} alt={copy.mediaAlt} /> : <span className="video-fallback-text">{copy.detail.open}</span>
    return onMediaOpen
      ? <button type="button" className="media-item media-open-button video-fallback" onClick={e => { e.stopPropagation(); onMediaOpen(index) }}>{content}</button>
      : <a className="media-item video-fallback" href={media.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{content}</a>
  }
  if (isVideoMedia(media)) return <span className="media-item video-media" onClick={e => e.stopPropagation()}><video poster={media.posterUrl} controls preload="auto" playsInline onError={() => setVideoFailed(true)}><source src={media.url} type={videoMimeType(media.url)} /><a href={media.url} target="_blank" rel="noreferrer">{copy.detail.open}</a></video></span>
  if (imageFailed && onMediaOpen) return <button type="button" className="media-item media-open-button media-fallback" onClick={e => { e.stopPropagation(); onMediaOpen(index) }}>{imageFallback}</button>
  if (imageFailed) return <a className="media-item media-fallback" href={media.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{imageFallback}</a>
  if (onMediaOpen) return <button type="button" className="media-item media-open-button" onClick={e => { e.stopPropagation(); onMediaOpen(index) }}><img src={media.url} alt={copy.mediaAlt} onError={() => setImageFailed(true)} /></button>
  return <a className="media-item" href={media.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}><img src={media.url} alt={copy.mediaAlt} onError={() => setImageFailed(true)} /></a>
}

function MediaViewer({ state, copy, locale, bookmarked, onClose, onBookmark, onCopy, onNavigate }: { state: MediaViewerState; copy: Copy; locale: string; bookmarked: boolean; onClose: () => void; onBookmark: (p: Post) => void; onCopy: (value: string, message: string) => void; onNavigate: (index: number) => void }) {
  const media = displayMediaItems(state.post.media || [])
  const index = Math.min(Math.max(state.index, 0), Math.max(media.length - 1, 0))
  const current = media[index]
  const [viewerVideoFailed, setViewerVideoFailed] = useState(false)
  const username = state.post.username || state.collection?.accountProfile?.username
  const authorName = displayAuthorName(state.post, copy, state.collection?.accountProfile?.displayName || state.collection?.title, state.collection?.accountProfile?.username)
  const avatarUrl = profileAvatarSrc(state.collection?.accountProfile, state.post.authorAvatarUrl)
  const url = postCanonicalUrl(state.post, state.collection?.accountProfile?.username)
  const count = (n?: number) => compactNonZero(n, locale)
  const replyingTo = replyTargetUsername(state.post)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
      if (event.key === 'ArrowRight' && index < media.length - 1) onNavigate(index + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, media.length, onClose, onNavigate])
  useEffect(() => setViewerVideoFailed(false), [current?.url])
  if (!current) return null
  return <div className="media-viewer-layer" role="dialog" aria-modal="true">
    <section className="media-viewer-stage">
      <button className="media-viewer-close" onClick={onClose} aria-label={copy.cancel}><X size={24} /></button>
      {index > 0 && <button className="media-viewer-nav prev" onClick={() => onNavigate(index - 1)} aria-label={copy.detail.back}><ChevronLeft size={30} /></button>}
      {isVideoMedia(current)
        ? viewerVideoFailed
          ? current.posterUrl
            ? <img className="media-viewer-media" src={current.posterUrl} alt={copy.mediaAlt} />
            : <a className="media-viewer-fallback" href={current.url} target="_blank" rel="noreferrer">{copy.detail.open}</a>
          : <video className="media-viewer-media" poster={current.posterUrl} controls autoPlay playsInline onError={() => setViewerVideoFailed(true)}><source src={current.url} type={videoMimeType(current.url)} /></video>
        : <img className="media-viewer-media" src={current.url} alt={copy.mediaAlt} />}
      {index < media.length - 1 && <button className="media-viewer-nav next" onClick={() => onNavigate(index + 1)} aria-label={copy.detail.open}><ChevronLeft size={30} /></button>}
      <div className="media-viewer-bottom-actions">
        <span><PostActionIcon name="reply" /> {count(state.post.replyCount)}</span>
        <span><PostActionIcon name="retweet" /> {count(state.post.repostCount)}</span>
        <span><PostActionIcon name="like" /> {count(state.post.likeCount)}</span>
        <span><PostActionIcon name="impression" /> {compact(state.post.viewCount, locale)}</span>
        <button onClick={() => onBookmark(state.post)} className={bookmarked ? 'marked' : ''} aria-label={copy.nav.bookmarks}><PostBookmarkIcon marked={bookmarked} /></button>
        {url && <PostShareMenu url={url} copy={copy} onCopy={onCopy} />}
      </div>
    </section>
    <aside className="media-viewer-side">
      <article className="media-viewer-post">
        <div className="detail-post-author">
          <div className="avatar"><img src={profileIconSrc(avatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /></div>
          <div className="detail-author-text"><b>{authorName}</b>{username && <span>@{username.replace(/^@/, '')}</span>}</div>
          <PostMoreMenu post={state.post} copy={copy} fallbackUsername={username} onCopy={onCopy} />
        </div>
        {replyingTo && <ReplyToNotice username={replyingTo} locale={locale} />}
        <p className="detail-post-text">{renderPostText(state.post.text, state.post.urls)}</p>
        <DetailMeta createdAt={state.post.createdAt} viewCount={state.post.viewCount} locale={locale} />
        <div className="media-viewer-side-actions">
          <span><PostActionIcon name="reply" /> {count(state.post.replyCount)}</span>
          <span><PostActionIcon name="retweet" /> {count(state.post.repostCount)}</span>
          <span><PostActionIcon name="like" /> {count(state.post.likeCount)}</span>
          <button onClick={() => onBookmark(state.post)} className={bookmarked ? 'marked' : ''} aria-label={copy.nav.bookmarks}><PostBookmarkIcon marked={bookmarked} /> {count(state.post.sourceBookmarkCount)}</button>
          {url && <PostShareMenu url={url} copy={copy} onCopy={onCopy} />}
        </div>
      </article>
    </aside>
  </div>
}

function QuotedPostCard({ post, copy, locale, avatarUrl, linkedPost, onDetail }: { post: EmbeddedPost; copy: Copy; locale: string; avatarUrl?: string; linkedPost?: Post; onDetail?: (post: Post) => void }) {
  const username = post.username?.replace(/^@/, '')
  const content = <><div className="quote-card-header"><div className="quote-avatar" onClick={e => { e.preventDefault(); e.stopPropagation() }}><img src={profileIconSrc(avatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /></div><b>{post.authorName || username || copy.unknownAuthor}</b>{username && <span>@{username}</span>}{post.createdAt && <span>· {dateText(post.createdAt, locale)}</span>}</div>{post.text && <p>{renderPostText(post.text)}</p>}{post.media?.length ? <MediaGrid media={post.media} copy={copy} className="quote-media-grid" /> : null}</>
  if (linkedPost && onDetail) return <div role="button" tabIndex={0} className="quote-card quote-card-button" onClick={e => { e.stopPropagation(); onDetail(linkedPost) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDetail(linkedPost) } }}>{content}</div>
  return post.postUrl ? <a className="quote-card" href={post.postUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{content}</a> : <div className="quote-card">{content}</div>
}

function ReplyParentPost({ post, copy, locale, avatarUrl }: { post: EmbeddedPost; copy: Copy; locale: string; avatarUrl?: string }) {
  const username = post.username?.replace(/^@/, '')
  const content = <><div className="reply-parent-avatar" onClick={e => { e.preventDefault(); e.stopPropagation() }}><img src={profileIconSrc(avatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /></div><div className="reply-parent-body"><div className="post-top"><b>{post.authorName || username || copy.unknownAuthor}</b>{username && <span>@{username}</span>}{post.createdAt && <span>· {dateText(post.createdAt, locale)}</span>}</div>{post.text && <p>{renderPostText(post.text)}</p>}{post.media?.length ? <MediaGrid media={post.media} copy={copy} className="reply-parent-media" /> : null}<div className="reply-parent-actions"><span><PostActionIcon name="reply" /> {compactNonZero(post.replyCount, locale)}</span><span><PostActionIcon name="retweet" /> {compactNonZero(post.repostCount, locale)}</span><span><PostActionIcon name="like" /> {compactNonZero(post.likeCount, locale)}</span><span><PostActionIcon name="impression" /> {compact(post.viewCount, locale)}</span></div></div></>
  return post.postUrl ? <a className="reply-parent-post" href={post.postUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{content}</a> : <div className="reply-parent-post">{content}</div>
}

function ReplyToNotice({ username, locale }: { username: string; locale: string }) {
  const handleName = username.replace(/^@/, '')
  if (!handleName) return null
  const isJa = locale.toLowerCase().startsWith('ja')
  return <div className="reply-to-notice">{isJa ? '返信先: ' : 'Replying to '}<span>@{handleName}</span>{isJa ? 'さん' : ''}</div>
}

function DetailMeta({ createdAt, viewCount, locale }: { createdAt: string; viewCount?: number; locale: string }) {
  const date = detailDateTimeText(createdAt, locale)
  const isJa = locale.toLowerCase().startsWith('ja')
  return <div className="detail-meta">
    {date && <span>{date}</span>}
    {date && viewCount !== undefined && <span aria-hidden="true"> · </span>}
    {viewCount !== undefined && <span><strong className="detail-views-count">{compact(viewCount, locale)}</strong>{isJa ? ' 件の表示' : ' views'}</span>}
  </div>
}

function BackIcon() {
  return <img className="back-icon" src={`${profileIconBase}arrow-left.svg`} alt="" aria-hidden="true" />
}

function TabCaret() {
  return <svg className="tab-caret" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><path d="M297.4 438.6C309.9 451.1 330.2 451.1 342.7 438.6L502.7 278.6C515.2 266.1 515.2 245.8 502.7 233.3C490.2 220.8 469.9 220.8 457.4 233.3L320 370.7L182.6 233.4C170.1 220.9 149.8 220.9 137.3 233.4C124.8 245.9 124.8 266.2 137.3 278.7L297.3 438.7z" /></svg>
}

function SortNextIcon() {
  return <svg className="sort-next" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><path d="M439.1 297.4C451.6 309.9 451.6 330.2 439.1 342.7L279.1 502.7C266.6 515.2 246.3 515.2 233.8 502.7C221.3 490.2 221.3 469.9 233.8 457.4L371.2 320L233.9 182.6C221.4 170.1 221.4 149.8 233.9 137.3C246.4 124.8 266.7 124.8 279.2 137.3L439.2 297.3z" /></svg>
}
function SortCheckIcon() {
  return <img className="sort-check" src={`${profileSortIconBase}check.svg`} alt="" aria-hidden="true" />
}

function DrawerContent({ collections, total, currentView, copy, locale, onNav, onSelect, activeId }: { collections: Collection[]; total: number; currentView: View; copy: Copy; locale: string; onNav: (v: View) => void; onSelect: (c: Collection) => void; activeId?: string }) {
  const hasCollections = collections.length > 0
  return <div className="drawer-inner"><div className="brand"><img className="brand-logo" src={appLogoPath} alt={copy.appName} /><span>{copy.brandCounts(total, collections.length, locale)}</span></div>
    <nav className="menu-nav"><button className={currentView === 'timeline' ? 'active' : ''} onClick={() => onNav('timeline')}><NavIcon name="home" active={currentView === 'timeline'} /> {copy.nav.home}</button><button className={currentView === 'bookmarks' ? 'active' : ''} onClick={() => onNav('bookmarks')}><NavIcon name="bookmark" active={currentView === 'bookmarks'} /> {copy.nav.bookmarks}</button><button className={currentView === 'collections' ? 'active' : ''} onClick={() => onNav('collections')}><NavIcon name="layout-grid" active={currentView === 'collections'} /> {copy.nav.collections}</button><button className={currentView === 'import' ? 'active' : ''} onClick={() => onNav('import')}><NavIcon name="file-import" active={currentView === 'import'} /> {copy.nav.import}</button></nav>
    {hasCollections && <div className="drawer-collections"><small>{copy.nav.collections.toUpperCase()}</small>{collections.slice(0, 6).map(c => <button className={c.id === activeId ? 'selected' : ''} key={c.id} onClick={() => onSelect(c)}><span><CollectionAvatarIcon collection={c} /></span><b>{collectionDisplayTitle(c)}</b><em>{numberText(c.posts.length, locale)}</em></button>)}</div>}
    <nav className="menu-nav bottom"><button className={currentView === 'settings' ? 'active' : ''} onClick={() => onNav('settings')}><NavIcon name="settings" active={currentView === 'settings'} /> {copy.nav.settings}</button>{hasCollections && <button className={currentView === 'info' ? 'active' : ''} onClick={() => onNav('info')}><NavIcon name="info-circle" active={currentView === 'info'} /> {copy.nav.info}</button>}</nav>
  </div>
}

function Timeline({ collection, copy, locale, query, advancedFilters, mediaOnly, bookmarks, onBookmark, onDetail, onMediaOpen, onCopy, onFilter, onProfileEdit }: { collection: Collection; copy: Copy; locale: string; query: string; advancedFilters: AdvancedSearchFilters; mediaOnly: boolean; bookmarks: string[]; onBookmark: (p: Post) => void; onDetail: (p: Post) => void; onMediaOpen: (post: Post, collection: Collection, index: number) => void; onCopy: (value: string, message: string) => void; onFilter: () => void; onProfileEdit: (collection: Collection, profile: Profile) => void }) {
  const [tab, setTab] = useState<TimelineTab>(() => savedTimelineTab(collection.id))
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [sortOpen, setSortOpen] = useState(false)
  const [sortSubmenuOpen, setSortSubmenuOpen] = useState(false)
  const [tabLoading, setTabLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(timelinePageSize)
  const tabTimer = useRef<number | null>(null)
  const deferredQuery = useDeferredValue(query)
  const advancedActive = hasAdvancedSearchFilters(advancedFilters)
  const searchMode = deferredQuery.trim().length > 0 || advancedActive
  const hasReposts = useMemo(() => collection.posts.some(post => post.type === 'repost'), [collection.posts])
  const searchKey = useMemo(() => searchMode ? JSON.stringify({ query: deferredQuery.trim(), advancedFilters }) : '', [searchMode, deferredQuery, advancedFilters])
  const previousSearchKey = useRef('')
  const wasSearchMode = useRef(false)
  useEffect(() => () => { if (tabTimer.current) window.clearTimeout(tabTimer.current) }, [])
  useEffect(() => {
    if (tabTimer.current) window.clearTimeout(tabTimer.current)
    setSortOpen(false)
    setSortSubmenuOpen(false)
    setTabLoading(false)
    setTab(savedTimelineTab(collection.id))
  }, [collection.id])
  useEffect(() => {
    if (searchMode) return
    const saved = load<Record<string, TimelineTab>>(timelineTabsKey, {})
    saveJson(timelineTabsKey, { ...saved, [collection.id]: tab })
  }, [collection.id, tab, searchMode])
  useEffect(() => {
    if (!hasReposts && tab === 'reposts') setTab('posts')
  }, [hasReposts, tab])
  useEffect(() => {
    if (searchMode) {
      if (previousSearchKey.current !== searchKey) {
        if (tabTimer.current) window.clearTimeout(tabTimer.current)
        setSortOpen(false)
        setSortSubmenuOpen(false)
        setTabLoading(false)
        setTab('posts')
        previousSearchKey.current = searchKey
      }
      wasSearchMode.current = true
      return
    }
    previousSearchKey.current = ''
    if (wasSearchMode.current) {
      setTab(savedTimelineTab(collection.id))
      wasSearchMode.current = false
    }
  }, [collection.id, searchKey, searchMode])
  const posts = useMemo(() => {
    const filtered = collection.posts.filter(post => {
      const haystack = postSearchText(post, collection.type)
      const matches = matchesSearch(haystack, deferredQuery)
      const typeMatch = searchMode ? (tab === 'media' ? !!post.media?.length && post.type !== 'repost' : true) : tab === 'replies' ? post.type === 'reply' : tab === 'reposts' ? post.type === 'repost' : tab === 'media' ? !!post.media?.length && post.type !== 'repost' : post.type !== 'reply' && post.type !== 'repost'
      return matches && matchesSearchCommands(post, deferredQuery) && typeMatch && (!searchMode || post.type !== 'repost') && (!advancedActive || matchesAdvancedSearch(post, advancedFilters)) && (!mediaOnly || !!post.media?.length)
    })
    return [...filtered].sort((a, b) => {
      if (searchMode && tab === 'posts') return trendingScore(b) - trendingScore(a) || dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt)
      if (searchMode && tab === 'replies') return dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt)
      return sortMode === 'popular' ? ((b.likeCount ?? 0) - (a.likeCount ?? 0)) || dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt) : dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt)
    })
  }, [collection, query, deferredQuery, advancedFilters, advancedActive, tab, mediaOnly, sortMode])
  useEffect(() => setVisibleCount(timelinePageSize), [collection.id, searchKey, tab, sortMode, mediaOnly, advancedActive])
  useEffect(() => {
    if (visibleCount >= posts.length) return
    const loadMore = () => {
      const distance = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
      if (distance < 900) setVisibleCount(count => Math.min(count + timelinePageSize, posts.length))
    }
    loadMore()
    window.addEventListener('scroll', loadMore, { passive: true })
    return () => window.removeEventListener('scroll', loadMore)
  }, [posts.length, visibleCount])
  const visiblePosts = useMemo(() => posts.slice(0, visibleCount), [posts, visibleCount])
  const account = collection.type === 'account'
  const tabs = account ? [['posts', copy.tabs.posts], ['replies', copy.tabs.replies], ...(hasReposts ? [['reposts', copy.tabs.reposts]] : []), ['media', copy.tabs.media]] : [['posts', copy.tabs.latest], ['replies', copy.tabs.popular], ['media', copy.tabs.media]]
  const searchTabs = [['posts', copy.searchTabs.top], ['replies', copy.searchTabs.latest], ['media', copy.searchTabs.media]]
  const bookmarkSet = useMemo(() => new Set(bookmarks), [bookmarks])
  const renderedPosts = useMemo(() => visiblePosts.map(post => <PostCard key={post.id} post={post} collection={collection} copy={copy} locale={locale} avatarUrl={profileAvatarSrc(collection.accountProfile, post.authorAvatarUrl)} fallbackDisplayName={collection.accountProfile?.displayName || collection.title} fallbackUsername={collection.accountProfile?.username} bookmarked={bookmarkSet.has(post.id)} onBookmark={onBookmark} onDetail={onDetail} onMediaOpen={(post, index) => onMediaOpen(post, collection, index)} onCopy={onCopy} />), [visiblePosts, copy, locale, collection, bookmarkSet, onBookmark, onDetail, onMediaOpen, onCopy])
  const withTimelineLoading = (action: () => void) => {
    if (tabTimer.current) window.clearTimeout(tabTimer.current)
    action()
    setTabLoading(true)
    tabTimer.current = window.setTimeout(() => {
      window.requestAnimationFrame(() => setTabLoading(false))
    }, 120)
  }
  const scrollTimelineTop = scrollPageTop
  const chooseTab = (next: TimelineTab) => {
    setSortOpen(false)
    setSortSubmenuOpen(false)
    if (next === tab) return
    withTimelineLoading(() => { setTab(next); scrollTimelineTop() })
  }
  const chooseSort = (mode: SortMode) => {
    setSortOpen(false)
    setSortSubmenuOpen(false)
    if (mode === sortMode && tab === 'posts') return
    withTimelineLoading(() => { setSortMode(mode); setTab('posts'); scrollTimelineTop() })
  }
  const togglePostsMenu = () => {
    setSortSubmenuOpen(false)
    setSortOpen(v => !v)
  }
  return <section className={`screen ${searchMode ? 'search-results-screen' : ''}`}>{!searchMode && <CollectionHero collection={collection} copy={copy} locale={locale} onProfileEdit={onProfileEdit} />}
    <div className="tab-area"><div className="tab-row">{searchMode ? searchTabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => chooseTab(key as TimelineTab)}>{label}</button>) : tabs.map(([key, label]) => <button key={key} className={`${tab === key ? 'active' : ''} ${key === 'posts' ? 'sort-tab' : ''}`} onClick={() => key === 'posts' ? (tab === 'posts' ? togglePostsMenu() : chooseTab('posts')) : chooseTab(key as typeof tab)}>{key === 'posts' && tab === 'posts' ? <span>{label}<TabCaret /></span> : label}</button>)}</div>
      {!searchMode && sortOpen && <><button className="sort-scrim" aria-label={copy.cancel} onClick={() => { setSortOpen(false); setSortSubmenuOpen(false) }} /><div className={`sort-menu ${sortSubmenuOpen ? 'sort-menu-blocked' : ''}`}><button className={tab === 'posts' ? 'selected' : ''} onClick={() => { setTab('posts'); setSortOpen(false); setSortSubmenuOpen(false); scrollTimelineTop() }}>{copy.tabs.posts}<SortCheckIcon /></button><button className={sortSubmenuOpen ? 'active-branch' : ''} onClick={() => setSortSubmenuOpen(true)}>{copy.tabs.sort}<SortNextIcon /></button></div>{sortSubmenuOpen && <div className="sort-menu sort-submenu"><button className={sortMode === 'newest' ? 'selected' : ''} onClick={() => chooseSort('newest')}><IconClockHour4 stroke={1.5} /> {copy.tabs.newest}<SortCheckIcon /></button><button className={sortMode === 'popular' ? 'selected' : ''} onClick={() => chooseSort('popular')}><IconHeart stroke={2} /> {copy.tabs.popular}<SortCheckIcon /></button></div>}</>}
    </div>
    {!searchMode && !account && <div className="results-line">{copy.postCount(collection.posts.length, locale)}<button onClick={onFilter} aria-label={copy.filter.title}><SlidersHorizontal size={18} /></button></div>}
    <div className="timeline">{tabLoading ? <div className="timeline-loading"><span /></div> : <>{renderedPosts}{visibleCount < posts.length && <div className="timeline-loading more-loading"><span /></div>}{posts.length === 0 && (searchMode ? <SearchEmpty query={deferredQuery} copy={copy} /> : <div className="no-posts">{copy.noPosts}</div>)}</>}</div>
  </section>
}

function SearchEmpty({ query, copy }: { query: string; copy: Copy }) {
  return <div className="search-empty"><h2>{copy.searchEmpty.title(query)}</h2><p>{copy.searchEmpty.body}</p></div>
}

const profileExternalUrl = (collection: Collection) => {
  const username = (collection.accountProfile?.username || collection.posts.find(post => post.username)?.username || '').trim().replace(/^@/, '')
  if (/^[A-Za-z0-9_]{1,15}$/.test(username)) return `https://x.com/${username}`
  const authorId = collection.posts.find(post => post.authorId)?.authorId?.trim()
  return authorId && /^\d+$/.test(authorId) ? `https://x.com/i/user/${authorId}` : ''
}

function CollectionHero({ collection, copy, locale, onProfileEdit }: { collection: Collection; copy: Copy; locale: string; onProfileEdit: (collection: Collection, profile: Profile) => void }) {
  const [editing, setEditing] = useState(false)
  if (collection.type !== 'account') return <div className="search-hero"><h1>{collection.title}</h1><p>{copy.postCount(collection.posts.length, locale)}</p></div>
  const p = collection.accountProfile
  const username = p?.username || collection.posts.find(post => post.username)?.username || (/^@[\w_]+$/.test(collection.title) ? collection.title : '')
  const hasMeta = !!(p?.website || p?.location || p?.joinedAt)
  const profileUrl = profileExternalUrl(collection)
  const avatar = <img src={profileIconSrc(profileAvatarSrc(p))} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} />
  return <div className="profile"><div className="profile-cover" style={p?.headerImageUrl ? { backgroundImage: `url(${p.headerImageUrl})` } : undefined} />{profileUrl ? <a className="profile-avatar profile-avatar-link" href={profileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{avatar}</a> : <div className="profile-avatar">{avatar}</div>}<button className="profile-edit-button" onClick={() => setEditing(true)}>{copy.profile.edit}</button><h1>{p?.displayName || collection.posts.find(post => !isUnknownAuthorName(post.authorName))?.authorName || collection.title}</h1>{username && <p className="handle">@{username.replace(/^@/, '')}</p>}{p?.bio && <p className="bio">{p.bio}</p>}{hasMeta && <div className="profile-meta">{p?.website && <span>🔗 {p.website.replace(/^https?:\/\//, '')}</span>}{p?.location && <span>⌖ {p.location}</span>}{p?.joinedAt && <span>▣ {copy.joined(p.joinedAt)}</span>}</div>}{(p?.followingCount !== undefined || p?.followersCount !== undefined) && <div className="follow">{p?.followingCount !== undefined && <span className="follow-item"><b>{numberText(p.followingCount, locale)}</b> {copy.following}</span>}{p?.followersCount !== undefined && <span className="follow-item"><b>{numberText(p.followersCount, locale)}</b> {copy.followers}</span>}</div>}{editing && <ProfileEditDialog collection={collection} copy={copy} onSave={profile => { onProfileEdit(collection, profile); setEditing(false) }} onCancel={() => setEditing(false)} />}</div>
}

function ProfileEditDialog({ collection, copy, onSave, onCancel }: { collection: Collection; copy: Copy; onSave: (profile: Profile) => void; onCancel: () => void }) {
  const profile = collection.accountProfile
  const fallbackName = profile?.displayName || collection.posts.find(post => !isUnknownAuthorName(post.authorName))?.authorName || collection.title
  const [draft, setDraft] = useState<ProfileEditDraft>({
    displayName: fallbackName,
    bio: profile?.bio || '',
    customAvatarUrl: profileAvatarSrc(profile) || '',
    headerImageUrl: profile?.headerImageUrl || ''
  })
  const [error, setError] = useState('')
  const [editingMedia, setEditingMedia] = useState<{ key: ProfileMediaEditTarget; url: string } | null>(null)
  const [urlTarget, setUrlTarget] = useState<ProfileMediaEditTarget | null>(null)
  const { closing, close } = useAnimatedClose(onCancel)
  useBodyScrollLock()
  const update = (key: keyof ProfileEditDraft, value: string) => setDraft(prev => ({ ...prev, [key]: value }))
  const openImageUrl = (key: ProfileMediaEditTarget) => {
    setError('')
    setUrlTarget(key)
  }
  const chooseImageUrl = (url: string) => {
    const trimmed = url.trim()
    if (!urlTarget || !isHttpUrl(trimmed)) {
      setError(copy.profile.imageFailed)
      return
    }
    setEditingMedia({ key: urlTarget, url: trimmed })
    setUrlTarget(null)
  }
  const applyMedia = (url: string) => {
    if (!editingMedia) return
    update(editingMedia.key, url)
    setEditingMedia(null)
  }
  const save = () => onSave({
    displayName: draft.displayName.trim() || undefined,
    bio: draft.bio.trim() || undefined,
    customAvatarUrl: draft.customAvatarUrl || undefined,
    headerImageUrl: draft.headerImageUrl || undefined
  })
  return <div className={`profile-edit-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="profile-edit-backdrop" aria-label={copy.cancel} onClick={close} /><section className="profile-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
    <header><button className="icon-button" onClick={close} aria-label={copy.cancel}><X size={22} /></button><h2 id="profile-edit-title">{copy.profile.edit}</h2><button className="profile-save-button" onClick={save}>{copy.profile.save}</button></header>
    <div className="profile-edit-cover" style={draft.headerImageUrl ? { backgroundImage: `url(${draft.headerImageUrl})` } : undefined}>
      <button type="button" className="profile-edit-image-action" onClick={() => openImageUrl('headerImageUrl')} aria-label={copy.profile.editImage}><IconCameraPlus stroke={2} size={22} /></button>
      {draft.headerImageUrl && <button type="button" className="profile-edit-image-action" onClick={() => update('headerImageUrl', '')} aria-label={copy.profile.removeImage}><X size={22} /></button>}
    </div>
    <button type="button" className="profile-edit-avatar" onClick={() => openImageUrl('customAvatarUrl')} aria-label={copy.profile.changePhoto}><img src={profileIconSrc(draft.customAvatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /><span><IconCameraPlus stroke={2} size={24} /></span></button>
    {error && <p className="profile-edit-error">{error}</p>}
    <div className="profile-edit-fields">
      <label><span>{copy.profile.name}</span><input value={draft.displayName} onChange={e => update('displayName', e.target.value)} /></label>
      <label><span>{copy.profile.bio}</span><textarea value={draft.bio} onChange={e => update('bio', e.target.value)} /></label>
    </div>
    {urlTarget && <ImageUrlDialog copy={copy} initialValue={urlTarget === 'customAvatarUrl' ? draft.customAvatarUrl : draft.headerImageUrl} onCancel={() => setUrlTarget(null)} onNext={chooseImageUrl} />}
    {editingMedia && <MediaEditDialog copy={copy} target={editingMedia.key} url={editingMedia.url} onBack={() => setEditingMedia(null)} onApply={applyMedia} />}
  </section></div>
}

function ImageUrlDialog({ copy, initialValue, onCancel, onNext }: { copy: Copy; initialValue: string; onCancel: () => void; onNext: (url: string) => void }) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')
  const { closing, close } = useAnimatedClose(onCancel)
  const trimmed = value.trim()
  const valid = isHttpUrl(trimmed)
  const submit = () => {
    if (!valid) {
      setError(copy.profile.imageFailed)
      return
    }
    setError('')
    onNext(trimmed)
  }
  return <div className={`image-url-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="image-url-backdrop" aria-label={copy.cancel} onClick={close} /><form className="image-url-dialog" role="dialog" aria-modal="true" aria-labelledby="image-url-title" onSubmit={e => { e.preventDefault(); submit() }}>
    <h2 id="image-url-title">{copy.profile.imageUrl}</h2>
    <label><span>{copy.profile.imageUrl}</span><input autoFocus inputMode="url" value={value} onChange={e => { setValue(e.target.value); setError('') }} placeholder={copy.profile.imageUrlPlaceholder} /></label>
    {error && <p className="image-url-error">{error}</p>}
    <div className="image-url-actions"><button type="button" className="confirm-cancel" onClick={close}>{copy.cancel}</button><button type="submit" className="rename-save" disabled={!trimmed}>{copy.profile.next}</button></div>
  </form></div>
}

function MediaEditDialog({ copy, target, url, onBack, onApply }: { copy: Copy; target: ProfileMediaEditTarget; url: string; onBack: () => void; onApply: (url: string) => void }) {
  const [scale, setScale] = useState(1)
  const [corsEnabled, setCorsEnabled] = useState(true)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [imageAspect, setImageAspect] = useState(1)
  const imageRef = useRef<HTMLImageElement>(null)
  const cropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null)
  const { closing, close } = useAnimatedClose(onBack)
  const isBanner = target === 'headerImageUrl'
  const outputWidth = isBanner ? 1500 : 512
  const outputHeight = isBanner ? 500 : 512
  const cropAspect = outputWidth / outputHeight
  const clampOffset = useCallback((next: { x: number; y: number }, nextScale = scale) => {
    const crop = cropRef.current
    if (!crop) return next
    const rect = crop.getBoundingClientRect()
    const baseWidth = imageAspect > cropAspect ? rect.height * imageAspect : rect.width
    const baseHeight = imageAspect > cropAspect ? rect.height : rect.width / imageAspect
    const maxX = Math.max(0, (baseWidth * nextScale - rect.width) / 2)
    const maxY = Math.max(0, (baseHeight * nextScale - rect.height) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y))
    }
  }, [cropAspect, imageAspect, scale])
  const updateScale = (nextScale: number) => {
    setScale(nextScale)
    setOffset(current => clampOffset(current, nextScale))
  }
  const zoomByWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.08 : 0.08
    updateScale(Math.min(3, Math.max(1, Number((scale + delta).toFixed(2)))))
  }
  const apply = () => {
    const image = imageRef.current
    if (!image?.naturalWidth || !image.naturalHeight) {
      onApply(url)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (!context) {
      onApply(url)
      return
    }
    const baseScale = Math.max(outputWidth / image.naturalWidth, outputHeight / image.naturalHeight)
    const drawWidth = image.naturalWidth * baseScale * scale
    const drawHeight = image.naturalHeight * baseScale * scale
    const cropRect = cropRef.current?.getBoundingClientRect()
    const drawOffsetX = cropRect?.width ? offset.x * outputWidth / cropRect.width : 0
    const drawOffsetY = cropRect?.height ? offset.y * outputHeight / cropRect.height : 0
    try {
      context.drawImage(image, (outputWidth - drawWidth) / 2 + drawOffsetX, (outputHeight - drawHeight) / 2 + drawOffsetY, drawWidth, drawHeight)
      onApply(canvas.toDataURL('image/png'))
    } catch {
      onApply(url)
    }
  }
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setCorsEnabled(true)
  }, [target, url])
  const dialog = <div className={`media-edit-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="media-edit-backdrop" aria-label={copy.cancel} onClick={close} /><section className="media-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="media-edit-title">
    <header><button className="icon-button" onClick={close} aria-label={copy.detail.back}><BackIcon /></button><h2 id="media-edit-title">{copy.profile.mediaEdit}</h2><button className="profile-save-button" onClick={apply}>{copy.profile.apply}</button></header>
    <div className="media-edit-stage"><div ref={cropRef} className={`media-edit-crop ${isBanner ? 'media-edit-crop-banner' : ''} ${dragging ? 'is-dragging' : ''}`} onWheel={zoomByWheel}><img ref={imageRef} className={imageAspect > cropAspect ? 'media-edit-fit-wide' : 'media-edit-fit-tall'} crossOrigin={corsEnabled ? 'anonymous' : undefined} src={url} alt="" draggable={false} style={{ left: `calc(50% + ${offset.x}px)`, top: `calc(50% + ${offset.y}px)`, transform: `translate(-50%, -50%) scale(${scale})` }} onLoad={event => setImageAspect(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))} onError={() => setCorsEnabled(false)} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: offset.x, offsetY: offset.y }; setDragging(true) }} onPointerMove={event => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; setOffset(clampOffset({ x: drag.offsetX + event.clientX - drag.startX, y: drag.offsetY + event.clientY - drag.startY })) }} onPointerUp={event => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; setDragging(false) }} onPointerCancel={() => { dragRef.current = null; setDragging(false) }} /></div></div>
    <div className="media-edit-controls">
      <label><span>{copy.profile.imageSize}</span><input type="range" min="1" max="3" step="0.01" value={scale} onChange={event => updateScale(Number(event.target.value))} /></label>
    </div>
  </section></div>
  return createPortal(dialog, document.body)
}

function PostMoreMenu({ post, copy, fallbackUsername, onCopy }: { post: Post; copy: Copy; fallbackUsername?: string; onCopy: (value: string, message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const postData = JSON.stringify(post, null, 2)
  const close = () => setOpen(false)
  return <div className="post-menu-wrap" onClick={e => e.stopPropagation()}>
    <button className="more" onClick={() => setOpen(v => !v)} aria-label="more"><Ellipsis size={18} /></button>
    {open && <><button className="post-menu-scrim" aria-label={copy.cancel} onClick={close} /><div className="post-menu" role="menu">
      <button role="menuitem" onClick={() => { onCopy(post.text, copy.postMenu.copiedText); close() }}><CopyIcon size={19} /> {copy.postMenu.copyText}</button>
      <button role="menuitem" onClick={() => { setDataOpen(true); close() }}><FileText size={19} /> {copy.postMenu.viewData}</button>
    </div></>}
    {dataOpen && <PostDataDialog copy={copy} data={postData} onCopy={() => onCopy(postData, copy.postMenu.copiedData)} onClose={() => setDataOpen(false)} />}
  </div>
}

function PostShareMenu({ url, copy, onCopy }: { url: string; copy: Copy; onCopy: (value: string, message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [openAbove, setOpenAbove] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  const toggle = () => {
    setOpen(current => {
      const next = !current
      if (next) {
        const rect = buttonRef.current?.getBoundingClientRect()
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight
        setOpenAbove(Boolean(rect && rect.bottom + 112 > viewportHeight))
      }
      return next
    })
  }
  return <span className="share-menu-wrap" onClick={e => e.stopPropagation()}>
    <button ref={buttonRef} className="share-action" onClick={toggle} aria-label={copy.detail.open}><PostShareIcon /></button>
    {open && <><button className="share-menu-scrim" aria-label={copy.cancel} onClick={close} /><div className={`share-menu ${openAbove ? 'share-menu-above' : ''}`} role="menu">
      <a role="menuitem" href={url} target="_blank" rel="noreferrer" onClick={close}><ExternalLink size={19} /> {copy.postMenu.openUrl}</a>
      <button role="menuitem" onClick={() => { onCopy(url, copy.postMenu.copiedUrl); close() }}><CopyIcon size={19} /> {copy.postMenu.copyUrl}</button>
    </div></>}
  </span>
}

function PostDataDialog({ copy, data, onCopy, onClose }: { copy: Copy; data: string; onCopy: () => void; onClose: () => void }) {
  const { closing, close } = useAnimatedClose(onClose)
  return <div className={`post-data-layer ${closing ? 'modal-exiting' : ''}`} role="presentation" onClick={e => e.stopPropagation()}><button className="post-data-backdrop" aria-label={copy.cancel} onClick={close} /><section className="post-data-dialog" role="dialog" aria-modal="true" aria-labelledby="post-data-title"><header><button className="icon-button" onClick={close} aria-label={copy.cancel}><X size={22} /></button><h2 id="post-data-title">{copy.postMenu.dataTitle}</h2><button className="post-data-copy" onClick={onCopy}>{copy.postMenu.copyData}</button></header><pre>{data}</pre></section></div>
}

function ArticleCard({ post }: { post: Post }) {
  const article = postArticleInfo(post)
  const hero = articleHeroMedia(post)
  const title = article?.title || article?.url || ''
  const body = articleExcerpt(article?.body || postTextWithoutArticleUrl(post))
  if (!title && !body && !hero) return null
  return <div className="article-card">
    {hero && <div className="article-card-image"><img src={hero.url} alt="" /><span>X 記事</span></div>}
    <div className="article-card-body">
      {title && <h3>{title}</h3>}
      {body && <p>{body}</p>}
    </div>
  </div>
}

function PostCard({ post, collection, copy, locale, avatarUrl, fallbackDisplayName, fallbackUsername, bookmarked, onBookmark, onDetail, onMediaOpen, onCopy }: { post: Post; collection?: Collection; copy: Copy; locale: string; avatarUrl?: string; fallbackDisplayName?: string; fallbackUsername?: string; bookmarked: boolean; onBookmark: (p: Post) => void; onDetail: (p: Post) => void; onMediaOpen: (post: Post, index: number) => void; onCopy: (value: string, message: string) => void }) {
  const username = post.username || fallbackUsername
  const authorName = displayAuthorName(post, copy, fallbackDisplayName, fallbackUsername)
  const replyingTo = replyTargetUsername(post)
  const parentAvatarUrl = relatedPostAvatarUrl(post.repliedPost, post, avatarUrl, fallbackUsername)
  const quoteAvatarUrl = relatedPostAvatarUrl(post.quotedPost, post, avatarUrl, fallbackUsername)
  const quotedLinkedPost = findQuotedPostInCollection(post.quotedPost, collection, post, fallbackUsername)
  const article = postArticleInfo(post)
  const visibleText = article ? postTextWithoutArticleUrl(post) : post.text
  const visibleUrls = article ? urlsWithoutArticleUrl(post) : post.urls
  const replyMentionPrefix = replyingTo ? `@${replyingTo.replace(/^@/, '').toLowerCase()}` : ''
  const textHasReplyMention = Boolean(replyMentionPrefix && visibleText.trimStart().toLowerCase().startsWith(replyMentionPrefix))
  const showReplyNotice = Boolean(replyingTo && !textHasReplyMention)
  const currentPost = <div className="reply-child-row"><div className="avatar" onClick={e => e.stopPropagation()}><img src={profileIconSrc(avatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /></div><div className="post-body"><div className="post-top"><b>{authorName}</b>{username && <span>@{username.replace(/^@/, '')}</span>}<span>· {dateText(post.createdAt, locale)}</span><PostMoreMenu post={post} copy={copy} fallbackUsername={username} onCopy={onCopy} /></div>{showReplyNotice && <ReplyToNotice username={replyingTo!} locale={locale} />}{visibleText && <p>{renderPostText(visibleText, visibleUrls)}</p>}{post.hashtags?.length ? <div className="hashtags">{post.hashtags.map(h => <span key={h}>#{h}</span>)}</div> : null}{article ? <ArticleCard post={post} /> : post.media?.length ? <MediaGrid media={post.media} copy={copy} onMediaOpen={index => onMediaOpen(post, index)} /> : null}{post.quotedPost && <QuotedPostCard post={post.quotedPost} copy={copy} locale={locale} avatarUrl={quoteAvatarUrl} linkedPost={quotedLinkedPost} onDetail={onDetail} />}<div className="post-actions"><span><PostActionIcon name="reply" /> {compactNonZero(post.replyCount, locale)}</span><span><PostActionIcon name="retweet" /> {compactNonZero(post.repostCount, locale)}</span><span><PostActionIcon name="like" /> {compactNonZero(post.likeCount, locale)}</span><span><PostActionIcon name="impression" /> {compact(post.viewCount, locale)}</span><button onClick={e => { e.stopPropagation(); onBookmark(post) }} className={bookmarked ? 'marked' : ''} aria-label={copy.nav.bookmarks}><PostBookmarkIcon marked={bookmarked} /></button></div></div></div>
  return <article className={`post ${post.repliedPost ? 'thread-post' : ''}`} onClick={() => onDetail(post)}>{post.repliedPost && <ReplyParentPost post={post.repliedPost} copy={copy} locale={locale} avatarUrl={parentAvatarUrl} />}{currentPost}</article>
}

function CollectionList({ collections, copy, locale, onSelect, onRename, onDelete, onImport }: { collections: Collection[]; copy: Copy; locale: string; onSelect: (c: Collection) => void; onRename: (c: Collection) => void; onDelete: (c: Collection) => void; onImport: () => void }) { return <section className="screen list-screen">{collections.length ? (['account', 'keyword', 'hashtag'] as CollectionType[]).map(type => { const group = collections.filter(c => c.type === type); return group.length ? <div className="collection-group" key={type}><small>{copy.labels[type].toUpperCase()}</small>{group.map(c => <div key={c.id} className="collection-row"><button className="collection-main" onClick={() => onSelect(c)}><div className="collection-icon"><CollectionAvatarIcon collection={c} /></div><span><b>{collectionDisplayTitle(c)}</b><em>{copy.postCount(c.posts.length, locale)}</em></span><ChevronLeft size={18} className="arrow" /></button><div className="collection-actions"><button className="collection-rename" onClick={() => onRename(c)}>{copy.renameCollection}</button><button className="collection-delete" onClick={() => onDelete(c)}>{copy.settings.delete}</button></div></div>)}</div> : null }) : <EmptyState copy={copy} onImport={onImport} />}</section> }
function Bookmarks({ items, copy, locale, query, bookmarks, onBookmark, onDetail, onMediaOpen, onCopy }: { items: { post: Post; collection: Collection }[]; copy: Copy; locale: string; query: string; bookmarks: string[]; onBookmark: (p: Post) => void; onDetail: (p: Post, collection: Collection) => void; onMediaOpen: (post: Post, collection: Collection, index: number) => void; onCopy: (value: string, message: string) => void }) {
  const [visibleCount, setVisibleCount] = useState(timelinePageSize)
  const deferredQuery = useDeferredValue(query)
  const bookmarkSet = useMemo(() => new Set(bookmarks), [bookmarks])
  const filtered = useMemo(() => items.filter(x => matchesSearch(postSearchText(x.post, x.collection.type, x.collection.accountProfile?.username), deferredQuery) && matchesSearchCommands(x.post, deferredQuery)), [items, deferredQuery])
  useEffect(() => setVisibleCount(timelinePageSize), [deferredQuery, items])
  useEffect(() => {
    if (visibleCount >= filtered.length) return
    const loadMore = () => {
      const distance = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
      if (distance < 900) setVisibleCount(count => Math.min(count + timelinePageSize, filtered.length))
    }
    loadMore()
    window.addEventListener('scroll', loadMore, { passive: true })
    return () => window.removeEventListener('scroll', loadMore)
  }, [filtered.length, visibleCount])
  return <section className="screen"><div className="bookmark-count">{copy.postCount(filtered.length, locale)}</div>{filtered.slice(0, visibleCount).map(({ post, collection }) => <PostCard key={post.id} post={post} collection={collection} copy={copy} locale={locale} avatarUrl={profileAvatarSrc(collection.accountProfile, post.authorAvatarUrl)} fallbackDisplayName={collection.accountProfile?.displayName || collection.title} fallbackUsername={collection.accountProfile?.username} bookmarked={bookmarkSet.has(post.id)} onBookmark={onBookmark} onDetail={post => onDetail(post, collection)} onMediaOpen={(post, index) => onMediaOpen(post, collection, index)} onCopy={onCopy} />)}{visibleCount < filtered.length && <div className="timeline-loading more-loading"><span /></div>}{!filtered.length && <div className="no-posts">{copy.savedEmpty}</div>}</section>
}

function ImportView({ copy, onImport, onBack, onMenu }: { copy: Copy; onImport: (f: File, choice?: CollectionType, title?: string) => Promise<void>; onBack?: () => void; onMenu?: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<CollectionType>('account')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pick = (f?: File) => { if (f) { setFile(f); setError('') } }
  const submit = async () => {
    if (!file) return
    setLoading(true)
    try { await onImport(file, kind, title) }
    catch (e) { setError(e instanceof Error ? e.message : copy.import.failure) }
    finally { setLoading(false) }
  }
  const leftAction = onBack || onMenu
  return <section className="import-screen" aria-busy={loading}>{loading && <div className="import-loading-layer" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><b>{copy.import.loading}</b></div>}<header className="header"><button className="icon-button" onClick={leftAction} disabled={!leftAction} aria-label={onBack ? copy.detail.back : copy.menu}>{onBack ? <ChevronLeft /> : <Menu />}</button><strong className="header-title">{copy.titles.import}</strong><span /></header><div className="import-content"><div className="import-intro"><div className="import-icon"><FileUp /></div><h1>{copy.import.title}</h1><p>{copy.import.body}</p></div><label className="drop-zone"><input type="file" accept=".csv,.xml,.json,text/csv,text/xml,application/json" onChange={e => pick(e.target.files?.[0])} />{file ? <><b>{file.name}</b><span>{(file.size / 1024).toFixed(1)} KB · {copy.import.changeFile}</span></> : <><strong>＋</strong><b>{copy.import.chooseFile}</b><span>CSV / XML / JSON</span></>}</label><div className="download-tools" aria-label={copy.import.downloadToolsTitle}><span>{copy.import.downloadToolsTitle}</span><div><a href="/downloads/fetch_x_api.py" download>{copy.import.downloadPython}</a></div></div>{file && <div className="import-options"><label>{copy.import.kind}<select value={kind} onChange={e => setKind(e.target.value as CollectionType)}><option value="account">{copy.labels.account}</option><option value="keyword">{copy.labels.keyword}</option><option value="hashtag">{copy.labels.hashtag}</option></select></label><label>{copy.import.titleLabel}<input value={title} onChange={e => setTitle(e.target.value)} placeholder={copy.import.titlePlaceholder} /></label></div>}{error && <p className="error">{error}</p>}<button className="primary-button" disabled={!file || loading} onClick={submit}>{loading ? copy.import.loading : copy.import.submit}</button><p className="privacy">{copy.import.privacy}</p><details className="import-sources"><summary>{copy.import.sourcesTitle}</summary><p>{copy.import.sourcesLead}</p><ul className="import-source-list"><li><a href="https://developer.x.com/en/docs/x-api" target="_blank" rel="noreferrer">{copy.import.sourceOfficialTitle}</a><em>{copy.import.sourceOfficialBody}</em></li><li><a href="https://github.com/Lemelson/xporter-extension" target="_blank" rel="noreferrer">{copy.import.sourceXporterTitle}</a><em>{copy.import.sourceXporterBody}</em></li><li><b>{copy.import.sourceManualTitle}</b><em>{copy.import.sourceManualBody}</em></li></ul></details></div></section>
}

function SettingsView({ theme, language, font, appLanguage, copy, setTheme, setLanguage, setFont, onClearBookmarks }: { theme: Theme; language: LanguageSetting; font: FontSetting; appLanguage: AppLanguage; copy: Copy; setTheme: (t: Theme) => void; setLanguage: (t: LanguageSetting) => void; setFont: (t: FontSetting) => void; onClearBookmarks: () => void }) {
  const [legalOpen, setLegalOpen] = useState<'terms' | 'privacy' | null>(null)
  return <section className="screen settings-screen"><small>{copy.settings.appearance}</small><div className="setting-card"><span><Sun size={19} /> {copy.settings.displayMode}</span><select value={theme} onChange={e => setTheme(e.target.value as Theme)}><option value="light">{copy.theme.light}</option><option value="dark">{copy.theme.dark}</option><option value="system">{copy.theme.system}</option></select></div><div className="setting-card"><span><Languages size={19} /> {copy.settings.language}</span><select value={language} onChange={e => setLanguage(e.target.value as LanguageSetting)}><option value="auto">{copy.settings.autoRegion} ({messages[appLanguage].languageName})</option><option value="ja">{messages.ja.languageName}</option><option value="en">{messages.en.languageName}</option></select></div><div className="setting-card"><span><IconLetterCase stroke={2} size={19} /> {copy.settings.font}</span><select value={font} onChange={e => setFont(e.target.value as FontSetting)}><option value="noto">{copy.font.noto}</option><option value="system">{copy.font.system}</option></select></div><small>{copy.settings.legal}</small><div className="setting-card"><span><FileText size={19} /> {copy.settings.terms}</span><button className="text-button" onClick={() => setLegalOpen('terms')}>{copy.legal.open}</button></div><div className="setting-card"><span><FileText size={19} /> {copy.settings.privacyPolicy}</span><button className="text-button" onClick={() => setLegalOpen('privacy')}>{copy.legal.open}</button></div><small>{copy.settings.localData}</small><div className="setting-card"><span><Bookmark size={19} /> {copy.nav.bookmarks}</span><button className="danger-button" onClick={onClearBookmarks}>{copy.settings.delete}</button></div><p className="settings-note">{copy.settings.note}</p>{legalOpen === 'terms' && <LegalDialog title={copy.legal.termsTitle} sections={copy.legal.termsSections} closeLabel={copy.legal.close} onClose={() => setLegalOpen(null)} />}{legalOpen === 'privacy' && <LegalDialog title={copy.legal.privacyTitle} sections={copy.legal.privacySections} closeLabel={copy.legal.close} onClose={() => setLegalOpen(null)} />}</section>
}
function LegalDialog({ title, sections, closeLabel, onClose }: { title: string; sections: { heading: string; body: string }[]; closeLabel: string; onClose: () => void }) {
  const { closing, close } = useAnimatedClose(onClose)
  return <div className={`confirm-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="confirm-backdrop" aria-label={closeLabel} onClick={close} /><section className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title"><header><h2 id="legal-title">{title}</h2><button className="icon-button" onClick={close} aria-label={closeLabel}><X size={22} /></button></header><div className="legal-content">{sections.map(section => <section key={section.heading}><h3>{section.heading}</h3><p>{section.body}</p></section>)}</div><button className="primary-button" onClick={close}>{closeLabel}</button></section></div>
}
function InfoView({ collections, collection, copy, locale, onSelect, onAddPost, onExportCsv, onSaveSource }: { collections: Collection[]; collection: Collection; copy: Copy; locale: string; onSelect: (collectionId: string) => void; onAddPost: (collection: Collection) => void; onExportCsv: (collection: Collection) => void; onSaveSource: (collection: Collection, sourceText: string, reset?: boolean) => Promise<void> }) {
  const dates = useMemo(() => collection.posts.map(p => p.createdAt).filter(Boolean).sort((a, b) => dateTimestamp(a) - dateTimestamp(b)), [collection.posts])
  const lazyGeneratedSource = !collection.sourceText && isLargeCollection(collection)
  const [sourceDraft, setSourceDraft] = useState(() => lazyGeneratedSource ? '' : editableSourceText(collection))
  const [sourceLoaded, setSourceLoaded] = useState(() => !lazyGeneratedSource)
  const [sourceError, setSourceError] = useState('')
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourceFullscreen, setSourceFullscreen] = useState(false)
  const hasStoredSource = !!collection.sourceText
  useEffect(() => {
    const lazy = !collection.sourceText && isLargeCollection(collection)
    setSourceLoaded(!lazy)
    setSourceDraft(lazy ? '' : editableSourceText(collection))
    setSourceError('')
  }, [collection.id, collection.sourceText, collection.posts])
  useEffect(() => {
    if (!sourceFullscreen) return
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousBodyOverflow }
  }, [sourceFullscreen])
  const saveSource = async (nextText = sourceDraft, reset = false) => {
    setSourceSaving(true)
    setSourceError('')
    try {
      await onSaveSource(collection, nextText, reset)
      setSourceDraft(nextText)
      return true
    } catch (error) {
      setSourceError(`${copy.sourceEditor.error}${error instanceof Error ? `: ${error.message}` : ''}`)
      return false
    } finally {
      setSourceSaving(false)
    }
  }
  const resetSource = () => {
    const initial = originalSourceText(collection)
    void saveSource(initial, true)
  }
  const loadSourceEditor = () => {
    setSourceDraft(editableSourceText(collection))
    setSourceLoaded(true)
  }
  return <section className="screen info-screen">
    <label className="info-selector"><span>{copy.infoLabels.target}</span><select value={collection.id} onChange={e => onSelect(e.target.value)}>{collections.map(item => <option key={item.id} value={item.id}>{collectionDisplayTitle(item)}（{numberText(item.posts.length, locale)}）</option>)}</select></label>
    <InfoRow label={copy.infoLabels.collection} value={collectionDisplayTitle(collection)} />
    <InfoRow label={copy.infoLabels.type} value={copy.labels[collection.type]} />
    <InfoRow label={copy.infoLabels.posts} value={numberText(collection.posts.length, locale)} />
    <InfoRow label={copy.infoLabels.period} value={dates.length ? `${absoluteDateText(dates[0], locale)} 〜 ${absoluteDateText(dates.at(-1)!, locale)}` : '—'} />
    <InfoRow label={copy.infoLabels.source} value={collection.sourceName} />
    <InfoRow label={copy.infoLabels.imported} value={dateText(collection.importedAt, locale)} />
    <InfoRow label={copy.infoLabels.format} value={collection.sourceFormat} />
    <div className="info-actions">
      <button className="primary-button" onClick={() => onAddPost(collection)}>{copy.infoActions.addPost}</button>
      <button className="secondary-button" onClick={() => onExportCsv(collection)}>{copy.infoActions.exportCsv}</button>
    </div>
    <section className="source-editor">
      <div className="source-editor-head"><h2>{copy.sourceEditor.title}</h2>{sourceLoaded && <button className="text-button" onClick={() => setSourceFullscreen(true)}>{copy.sourceEditor.fullscreen}</button>}</div>
      <p>{copy.sourceEditor.body}</p>
      {!hasStoredSource && <p className="source-editor-note">{copy.sourceEditor.generated}</p>}
      {!sourceLoaded ? <div className="source-editor-lazy"><p>{copy.sourceEditor.largeGenerated}</p><button className="secondary-button" onClick={loadSourceEditor}>{copy.sourceEditor.loadGenerated}</button></div> : <>
        <textarea spellCheck={false} value={sourceDraft} onChange={e => setSourceDraft(e.target.value)} />
        {sourceError && <p className="source-editor-error">{sourceError}</p>}
        <div className="source-editor-actions">
          <button className="secondary-button" disabled={sourceSaving} onClick={resetSource}>{copy.sourceEditor.reset}</button>
          <button className="primary-button" disabled={sourceSaving || !sourceDraft.trim()} onClick={() => void saveSource()}>{copy.sourceEditor.save}</button>
        </div>
      </>}
    </section>
    {sourceFullscreen && sourceLoaded && <SourceEditorFullscreen copy={copy} format={collection.sourceFormat} value={sourceDraft} error={sourceError} saving={sourceSaving} onChange={setSourceDraft} onClose={() => setSourceFullscreen(false)} onReset={resetSource} onSave={nextValue => saveSource(nextValue)} />}
  </section>
}

function CsvTableEditor({ copy, value, onChange }: { copy: Copy; value: string; onChange: (value: string) => void }) {
  const [table, setTable] = useState<CsvTableData | null>(null)
  const [visibleRows, setVisibleRows] = useState(100)
  const [windowStart, setWindowStart] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeSearchResult, setActiveSearchResult] = useState(0)
  const [deletingRowIndex, setDeletingRowIndex] = useState<number | null>(null)
  const initialValue = useRef(value)
  const findInputRef = useRef<HTMLInputElement>(null)
  const cellRefs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>())
  useEffect(() => {
    let parseFrame = 0
    const initialFrame = window.requestAnimationFrame(() => {
      parseFrame = window.requestAnimationFrame(() => setTable(csvTextToTable(initialValue.current)))
    })
    return () => {
      window.cancelAnimationFrame(initialFrame)
      window.cancelAnimationFrame(parseFrame)
    }
  }, [])
  const columnKind = (header: string) => /本文|text|tweet|body|content/i.test(header) ? 'text' : /url|リンク|メディア|media|image|video/i.test(header) ? 'url' : /日付|date|time|日時/i.test(header) ? 'date' : /数|count|いいね|返信|リポスト|表示|bookmark|like|view|reply|retweet/i.test(header) ? 'number' : 'default'
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase()
  const searchResults = useMemo<CsvSearchResult[]>(() => {
    if (!normalizedSearchTerm || !table) return []
    const matches: CsvSearchResult[] = []
    table.headers.forEach((header, columnIndex) => {
      if (header.toLocaleLowerCase().includes(normalizedSearchTerm)) matches.push({ key: `header-${columnIndex}`, rowIndex: -1, columnIndex, header: true })
    })
    table.rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      if ((cell ?? '').toLocaleLowerCase().includes(normalizedSearchTerm)) matches.push({ key: `cell-${rowIndex}-${columnIndex}`, rowIndex, columnIndex, header: false })
    }))
    return matches
  }, [normalizedSearchTerm, table])
  const searchResultKeys = useMemo(() => new Set(searchResults.map(result => result.key)), [searchResults])
  const activeSearchKey = searchResults[activeSearchResult]?.key
  const scrollToSearchResult = useCallback((index: number) => {
    const result = searchResults[index]
    if (!result || !table) return
    if (!result.header && (result.rowIndex < windowStart || result.rowIndex >= windowStart + visibleRows)) {
      const nextStart = Math.max(0, Math.min(result.rowIndex - 25, Math.max(0, table.rows.length - 100)))
      setWindowStart(nextStart)
      setVisibleRows(Math.min(100, table.rows.length - nextStart))
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      cellRefs.current.get(result.key)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }))
  }, [searchResults, table, visibleRows, windowStart])
  const navigateSearch = (offset: number) => {
    if (!searchResults.length) return
    const next = (activeSearchResult + offset + searchResults.length) % searchResults.length
    setActiveSearchResult(next)
    scrollToSearchResult(next)
  }
  const openSearch = useCallback(() => {
    setSearchOpen(true)
    window.requestAnimationFrame(() => findInputRef.current?.focus())
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])
  useEffect(() => {
    setActiveSearchResult(0)
    if (searchResults.length) scrollToSearchResult(0)
  }, [searchTerm, searchResults.length, scrollToSearchResult])
  if (!table) return <div className="csv-table-loading" aria-label="Loading CSV table"><span /></div>
  const commit = (next: CsvTableData) => {
    setTable(next)
    onChange(csvTableToText(next))
  }
  const updateHeader = (index: number, value: string) => commit({ ...table, headers: table.headers.map((header, i) => i === index ? value : header) })
  const updateCell = (rowIndex: number, columnIndex: number, value: string) => commit({ ...table, rows: table.rows.map((row, i) => i === rowIndex ? row.map((cell, j) => j === columnIndex ? value : cell) : row) })
  const addRow = () => {
    const next = { ...table, rows: [...table.rows, table.headers.map(() => '')] }
    const nextStart = Math.max(0, next.rows.length - 100)
    setWindowStart(nextStart)
    setVisibleRows(Math.min(100, next.rows.length - nextStart))
    commit(next)
  }
  const deleteRow = (rowIndex: number) => {
    commit({ ...table, rows: table.rows.filter((_, i) => i !== rowIndex) })
    setDeletingRowIndex(null)
  }
  const addColumn = () => {
    const nextIndex = table.headers.length + 1
    commit({
      headers: [...table.headers, `列${nextIndex}`],
      rows: table.rows.map(row => [...row, ''])
    })
  }
  const shownRows = table.rows.slice(windowStart, windowStart + visibleRows)
  return <div className="csv-table-editor">
    {searchOpen && <div className="csv-table-find" role="search" aria-label="CSVを検索">
      <Search size={18} aria-hidden="true" />
      <input ref={findInputRef} value={searchTerm} onChange={event => setSearchTerm(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1) }
        if (event.key === 'Escape') { setSearchOpen(false); setSearchTerm('') }
      }} placeholder="内容を検索" />
      <span>{normalizedSearchTerm ? `${Math.min(activeSearchResult + 1, searchResults.length)}/${searchResults.length}` : '0/0'}</span>
      <button type="button" onClick={() => navigateSearch(-1)} disabled={!searchResults.length} aria-label="前の検索結果"><ChevronUp size={18} /></button>
      <button type="button" onClick={() => navigateSearch(1)} disabled={!searchResults.length} aria-label="次の検索結果"><ChevronDown size={18} /></button>
      <button type="button" onClick={() => { setSearchOpen(false); setSearchTerm('') }} aria-label="検索を閉じる"><X size={18} /></button>
    </div>}
    <div className="csv-table-toolbar">
      <span>{numberText(table.rows.length, 'ja-JP')} 行 · {numberText(table.headers.length, 'ja-JP')} 列</span>
      <button type="button" className="csv-table-find-button" onClick={openSearch} aria-label="内容を検索"><Search size={17} />検索</button>
      <button type="button" className="secondary-button" onClick={addColumn}>列を追加</button>
      <button type="button" className="secondary-button" onClick={addRow}>行を追加</button>
    </div>
    <div className="csv-table-wrap">
      <table className="csv-table">
        <thead>
          <tr>
            <th className="csv-row-number">#</th>
            {table.headers.map((header, columnIndex) => {
              const key = `header-${columnIndex}`
              const matchClass = searchResultKeys.has(key) ? ` csv-search-match${activeSearchKey === key ? ' csv-search-active' : ''}` : ''
              return <th className={`csv-col-${columnKind(header)}${matchClass}`} key={key}><input ref={node => { if (node) cellRefs.current.set(key, node); else cellRefs.current.delete(key) }} value={header} onChange={e => updateHeader(columnIndex, e.target.value)} aria-label={`列${columnIndex + 1}`} /></th>
            })}
            <th className="csv-row-actions" aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {shownRows.map((row, rowIndex) => <tr key={`row-${windowStart + rowIndex}`}>
            <th className="csv-row-number">{windowStart + rowIndex + 1}</th>
            {table.headers.map((header, columnIndex) => {
              const key = `cell-${windowStart + rowIndex}-${columnIndex}`
              const matchClass = searchResultKeys.has(key) ? ` csv-search-match${activeSearchKey === key ? ' csv-search-active' : ''}` : ''
              return <td className={`csv-col-${columnKind(header)}${matchClass}`} key={`${windowStart + rowIndex}-${columnIndex}`}><textarea ref={node => { if (node) cellRefs.current.set(key, node); else cellRefs.current.delete(key) }} value={row[columnIndex] ?? ''} onChange={e => updateCell(windowStart + rowIndex, columnIndex, e.target.value)} /></td>
            })}
            <td className="csv-row-actions"><button type="button" onClick={() => setDeletingRowIndex(windowStart + rowIndex)} aria-label={`${windowStart + rowIndex + 1}行目を削除`}>削除</button></td>
          </tr>)}
          {!table.rows.length && <tr><td className="csv-table-empty" colSpan={table.headers.length + 2}>行がありません。行を追加してください。</td></tr>}
        </tbody>
      </table>
      {(windowStart > 0 || windowStart + visibleRows < table.rows.length) && <div className="csv-table-more">
        {windowStart > 0 && <button type="button" className="secondary-button" onClick={() => {
          const nextStart = Math.max(0, windowStart - 200)
          setWindowStart(nextStart)
          setVisibleRows(Math.min(100, table.rows.length - nextStart))
        }}>前の200行を表示</button>}
        {windowStart + visibleRows < table.rows.length && <button type="button" className="secondary-button" onClick={() => setVisibleRows(rows => Math.min(rows + 200, table.rows.length - windowStart))}>さらに200行を表示</button>}
      </div>}
    </div>
    {deletingRowIndex !== null && <ConfirmDialog title={copy.confirm.deleteRowTitle} body={copy.confirm.deleteRowBody(deletingRowIndex + 1)} confirmLabel={copy.confirm.deleteAction} cancelLabel={copy.confirm.cancelAction} onConfirm={() => deleteRow(deletingRowIndex)} onCancel={() => setDeletingRowIndex(null)} />}
  </div>
}

function SourceEditorFullscreen({ copy, format, value, error, saving, onChange, onClose, onReset, onSave }: { copy: Copy; format: Collection['sourceFormat']; value: string; error: string; saving: boolean; onChange: (value: string) => void; onClose: () => void; onReset: () => void; onSave: (value: string) => Promise<boolean> }) {
  const isCsv = format === 'CSV'
  const latestValue = useRef(value)
  useEffect(() => { latestValue.current = value }, [value])
  const updateValue = (nextValue: string) => {
    latestValue.current = nextValue
    onChange(nextValue)
  }
  const saveAndClose = async () => {
    const saved = await onSave(latestValue.current)
    if (saved) onClose()
  }
  return <div className="source-fullscreen-layer" role="dialog" aria-modal="true" aria-labelledby="source-fullscreen-title">
    <header className="source-fullscreen-header"><button className="icon-button" onClick={onClose} aria-label={copy.sourceEditor.closeFullscreen}><X size={22} /></button><h2 id="source-fullscreen-title">{copy.sourceEditor.title}</h2><button className="profile-save-button" disabled={saving || !value.trim()} onClick={() => void saveAndClose()}>{saving ? copy.import.loading : copy.sourceEditor.save}</button></header>
    {isCsv ? <CsvTableEditor copy={copy} value={value} onChange={updateValue} /> : <textarea spellCheck={false} value={value} onChange={e => updateValue(e.target.value)} autoFocus />}
    <footer className="source-fullscreen-footer">{error && <p className="source-editor-error">{error}</p>}<button className="secondary-button" disabled={saving} onClick={onReset}>{copy.sourceEditor.reset}</button></footer>
  </div>
}
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="info-row"><small>{label}</small><span>{value}</span></div> }
function Scrim({ onClick }: { onClick: () => void }) {
  return <div className="scrim" role="presentation" onClick={onClick} />
}
function FilterSheet({ copy, mediaOnly, setMediaOnly, onClose }: { copy: Copy; mediaOnly: boolean; setMediaOnly: (v: boolean) => void; onClose: () => void }) { return <><Scrim onClick={onClose} /><section className="sheet"><div className="sheet-handle" /><div className="sheet-title"><h2>{copy.filter.title}</h2><button onClick={onClose}><X /></button></div><label className="check-row"><span><Image size={20} /> {copy.filter.mediaOnly}</span><input type="checkbox" checked={mediaOnly} onChange={e => setMediaOnly(e.target.checked)} /></label><button className="primary-button" onClick={onClose}>{copy.filter.apply}</button></section></> }
function AdvancedSearchDialog({ copy, filters, setFilters, onClose, onSearch }: { copy: Copy; filters: AdvancedSearchFilters; setFilters: (filters: AdvancedSearchFilters) => void; onClose: () => void; onSearch: () => void }) {
  const update = (key: keyof AdvancedSearchFilters, value: string) => setFilters({ ...filters, [key]: value })
  const { closing, close } = useAnimatedClose(onClose)
  return <div className={`advanced-layer ${closing ? 'modal-exiting' : ''}`}><button className="advanced-backdrop" aria-label={copy.cancel} onClick={close} /><section className="advanced-dialog" role="dialog" aria-modal="true" aria-labelledby="advanced-title"><header className="advanced-header"><button className="icon-button" onClick={close} aria-label={copy.cancel}><X size={22} /></button><h2 id="advanced-title">{copy.advancedSearch.title}</h2><button className="advanced-search-button" onClick={onSearch}>{copy.search}</button></header><div className="advanced-content"><h3>{copy.advancedSearch.engagement}</h3><AdvancedNumberField value={filters.minReplies} onChange={v => update('minReplies', v)} placeholder={copy.advancedSearch.minReplies} help={copy.advancedSearch.exampleReplies} /><AdvancedNumberField value={filters.minLikes} onChange={v => update('minLikes', v)} placeholder={copy.advancedSearch.minLikes} help={copy.advancedSearch.exampleLikes} /><AdvancedNumberField value={filters.minReposts} onChange={v => update('minReposts', v)} placeholder={copy.advancedSearch.minReposts} help={copy.advancedSearch.exampleReposts} /><h3>{copy.advancedSearch.dates}</h3><label className="advanced-date-field"><span>{copy.advancedSearch.since}</span><input type="date" value={filters.since} onChange={e => update('since', e.target.value)} /></label><label className="advanced-date-field"><span>{copy.advancedSearch.until}</span><input type="date" value={filters.until} onChange={e => update('until', e.target.value)} /></label><button className="advanced-clear" onClick={() => setFilters(emptyAdvancedFilters)}>{copy.advancedSearch.clear}</button></div></section></div>
}
function AdvancedNumberField({ value, onChange, placeholder, help }: { value: string; onChange: (value: string) => void; placeholder: string; help: string }) {
  return <label className="advanced-number-field"><input type="number" min="0" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /><small>{help}</small></label>
}
function AddPostDialog({ collection, copy, appLanguage, onSave, onCancel }: { collection: Collection; copy: Copy; appLanguage: AppLanguage; onSave: (collection: Collection, draft: ManualPostDraft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<ManualPostDraft>({
    text: '',
    postUrl: '',
    createdAt: toLocalDateTimeInputValue(),
    type: 'tweet',
    language: appLanguage,
    mediaUrls: '',
    replyCount: '',
    repostCount: '',
    likeCount: '',
    quoteCount: '',
    bookmarkCount: '',
    viewCount: ''
  })
  const update = (key: keyof ManualPostDraft, value: string) => setDraft(prev => ({ ...prev, [key]: value }))
  const typeLabels = appLanguage === 'ja'
    ? { tweet: 'ツイート', reply: '返信', quote: '引用', repost: 'リツイート' }
    : { tweet: 'Tweet', reply: 'Reply', quote: 'Quote', repost: 'Retweet' }
  const { closing, close } = useAnimatedClose(onCancel)
  return <div className={`confirm-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="confirm-backdrop" aria-label={copy.cancel} onClick={close} /><form className="post-form-dialog" role="dialog" aria-modal="true" aria-labelledby="add-post-title" onSubmit={e => { e.preventDefault(); if (draft.text.trim()) onSave(collection, draft) }}>
    <header><h2 id="add-post-title">{copy.addPost.title}</h2><button type="button" className="icon-button" onClick={close} aria-label={copy.cancel}><X size={22} /></button></header>
    <label className="post-form-full"><span>{copy.addPost.text}</span><textarea value={draft.text} onChange={e => update('text', e.target.value)} placeholder={copy.addPost.textPlaceholder} /></label>
    <label className="post-form-full"><span>{copy.addPost.postUrl}</span><input value={draft.postUrl} onChange={e => update('postUrl', e.target.value)} placeholder={copy.addPost.postUrlPlaceholder} /></label>
    <div className="post-form-grid">
      <label><span>{copy.addPost.createdAt}</span><input type="datetime-local" value={draft.createdAt} onChange={e => update('createdAt', e.target.value)} /></label>
      <label><span>{copy.addPost.type}</span><select value={draft.type} onChange={e => update('type', e.target.value as PostType)}><option value="tweet">{typeLabels.tweet}</option><option value="reply">{typeLabels.reply}</option><option value="quote">{typeLabels.quote}</option><option value="repost">{typeLabels.repost}</option></select></label>
      <label><span>{copy.addPost.language}</span><input value={draft.language} onChange={e => update('language', e.target.value)} placeholder="ja" /></label>
      <label><span>{copy.addPost.viewCount}</span><input type="number" min="0" inputMode="numeric" value={draft.viewCount} onChange={e => update('viewCount', e.target.value)} /></label>
      <label><span>{copy.addPost.replyCount}</span><input type="number" min="0" inputMode="numeric" value={draft.replyCount} onChange={e => update('replyCount', e.target.value)} /></label>
      <label><span>{copy.addPost.repostCount}</span><input type="number" min="0" inputMode="numeric" value={draft.repostCount} onChange={e => update('repostCount', e.target.value)} /></label>
      <label><span>{copy.addPost.likeCount}</span><input type="number" min="0" inputMode="numeric" value={draft.likeCount} onChange={e => update('likeCount', e.target.value)} /></label>
      <label><span>{copy.addPost.quoteCount}</span><input type="number" min="0" inputMode="numeric" value={draft.quoteCount} onChange={e => update('quoteCount', e.target.value)} /></label>
      <label><span>{copy.addPost.bookmarkCount}</span><input type="number" min="0" inputMode="numeric" value={draft.bookmarkCount} onChange={e => update('bookmarkCount', e.target.value)} /></label>
    </div>
    <label className="post-form-full"><span>{copy.addPost.mediaUrls}</span><textarea className="media-url-textarea" value={draft.mediaUrls} onChange={e => update('mediaUrls', e.target.value)} placeholder="https://pbs.twimg.com/media/..." /><small>{copy.addPost.mediaHelp}</small></label>
    <div className="post-form-actions"><button type="button" className="confirm-cancel" onClick={close}>{copy.cancel}</button><button type="submit" className="rename-save" disabled={!draft.text.trim()}>{copy.addPost.save}</button></div>
  </form></div>
}
function RenameCollectionDialog({ copy, value, onChange, onSave, onCancel }: { copy: Copy; value: string; onChange: (value: string) => void; onSave: () => void; onCancel: () => void }) {
  const { closing, close } = useAnimatedClose(onCancel)
  return <div className={`confirm-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="confirm-backdrop" aria-label={copy.cancel} onClick={close} /><form className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" onSubmit={e => { e.preventDefault(); onSave() }}><h2 id="rename-title">{copy.renameCollection}</h2><label><span>{copy.renameCollectionPrompt}</span><input value={value} onChange={e => onChange(e.target.value)} /></label><div className="rename-actions"><button type="button" className="confirm-cancel" onClick={close}>{copy.cancel}</button><button type="submit" className="rename-save" disabled={!value.trim()}>{copy.renameCollection}</button></div></form></div>
}
function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const { closing, close } = useAnimatedClose(onCancel)
  return <div className={`confirm-layer ${closing ? 'modal-exiting' : ''}`} role="presentation"><button className="confirm-backdrop" aria-label={cancelLabel} onClick={close} /><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{body}</p><div className="confirm-actions"><button className="confirm-delete" onClick={onConfirm}>{confirmLabel}</button><button className="confirm-cancel" onClick={close}>{cancelLabel}</button></div></section></div>
}
function PostDetail({ post, collection, copy, locale, bookmarked, onBack, onBookmark, onDetail, onMediaOpen, onCopy }: { post: Post; collection?: Collection; copy: Copy; locale: string; bookmarked: boolean; onBack: () => void; onBookmark: (p: Post) => void; onDetail: (p: Post) => void; onMediaOpen: (post: Post, index: number) => void; onCopy: (value: string, message: string) => void }) {
  const article = postArticleInfo(post)
  const isArticle = !!article
  return <div className={`detail ${isArticle ? 'article-detail' : ''}`}><header className="header detail-header"><button className="icon-button detail-back" onClick={onBack} aria-label={copy.detail.back}><BackIcon /></button><strong className="header-title">{isArticle ? '記事' : copy.detail.title}</strong>{isArticle && article?.url ? <a className="icon-button" href={article.url} target="_blank" rel="noreferrer" aria-label={copy.postMenu.openUrl}><ExternalLink size={20} /></a> : <span />}</header><div className="detail-content">
    {isArticle
      ? <ArticleDetailPost post={post} collection={collection} copy={copy} locale={locale} avatarUrl={profileAvatarSrc(collection?.accountProfile, post.authorAvatarUrl)} fallbackDisplayName={collection?.accountProfile?.displayName || collection?.title} fallbackUsername={collection?.accountProfile?.username} bookmarked={bookmarked} onBookmark={onBookmark} onCopy={onCopy} />
      : <DetailPost post={post} collection={collection} copy={copy} locale={locale} avatarUrl={profileAvatarSrc(collection?.accountProfile, post.authorAvatarUrl)} fallbackDisplayName={collection?.accountProfile?.displayName || collection?.title} fallbackUsername={collection?.accountProfile?.username} bookmarked={bookmarked} onBookmark={onBookmark} onDetail={onDetail} onMediaOpen={onMediaOpen} onCopy={onCopy} />}
  </div></div>
}

function ArticleDetailPost({ post, collection, copy, locale, avatarUrl, fallbackDisplayName, fallbackUsername, bookmarked, onBookmark, onCopy }: { post: Post; collection?: Collection; copy: Copy; locale: string; avatarUrl?: string; fallbackDisplayName?: string; fallbackUsername?: string; bookmarked: boolean; onBookmark: (p: Post) => void; onCopy: (value: string, message: string) => void }) {
  const username = post.username || fallbackUsername
  const authorName = displayAuthorName(post, copy, fallbackDisplayName, fallbackUsername)
  const article = postArticleInfo(post)
  const hero = articleHeroMedia(post)
  const title = article?.title || postTextWithoutArticleUrl(post)
  const paragraphs = articleParagraphs(article?.body)
  const url = postCanonicalUrl(post, fallbackUsername)
  const count = (n?: number) => compactNonZero(n, locale)
  return <article className="article-detail-post">
    <div className="article-detail-author">
      <div className="avatar"><img src={profileIconSrc(avatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /></div>
      <div><b>{authorName}</b>{username && <span>@{username.replace(/^@/, '')}</span>}</div>
      <PostMoreMenu post={post} copy={copy} fallbackUsername={username} onCopy={onCopy} />
    </div>
    {hero && <img className="article-detail-hero" src={hero.url} alt="" />}
    <h1>{title}</h1>
    <div className="detail-actions article-detail-actions">
      <span><PostActionIcon name="reply" /> {count(post.replyCount)}</span>
      <span><PostActionIcon name="retweet" /> {count(post.repostCount)}</span>
      <span><PostActionIcon name="like" /> {count(post.likeCount)}</span>
      <span><PostActionIcon name="impression" /> {compact(post.viewCount, locale)}</span>
      <button onClick={() => onBookmark(post)} className={bookmarked ? 'marked' : ''} aria-label={copy.nav.bookmarks}><PostBookmarkIcon marked={bookmarked} /></button>
      {url && <PostShareMenu url={url} copy={copy} onCopy={onCopy} />}
    </div>
    {paragraphs.length ? <div className="article-body">{paragraphs.map((paragraph, index) => <p key={index}>{renderPostText(paragraph, urlsWithoutArticleUrl(post))}</p>)}</div> : <p className="article-body">{renderPostText(postTextWithoutArticleUrl(post), urlsWithoutArticleUrl(post))}</p>}
  </article>
}
function DetailPost({ post, collection, copy, locale, avatarUrl, fallbackDisplayName, fallbackUsername, bookmarked, onBookmark, onDetail, onMediaOpen, onCopy }: { post: Post; collection?: Collection; copy: Copy; locale: string; avatarUrl?: string; fallbackDisplayName?: string; fallbackUsername?: string; bookmarked: boolean; onBookmark: (p: Post) => void; onDetail: (p: Post) => void; onMediaOpen: (post: Post, index: number) => void; onCopy: (value: string, message: string) => void }) {
  const username = post.username || fallbackUsername
  const count = (n?: number) => compactNonZero(n, locale)
  const url = postCanonicalUrl(post, fallbackUsername)
  const authorName = displayAuthorName(post, copy, fallbackDisplayName, fallbackUsername)
  const replyingTo = replyTargetUsername(post)
  const parentAvatarUrl = relatedPostAvatarUrl(post.repliedPost, post, avatarUrl, fallbackUsername)
  const quoteAvatarUrl = relatedPostAvatarUrl(post.quotedPost, post, avatarUrl, fallbackUsername)
  const quotedLinkedPost = findQuotedPostInCollection(post.quotedPost, collection, post, fallbackUsername)
  return <article className="detail-post">
    {post.repliedPost && <div className="detail-reply-parent"><ReplyParentPost post={post.repliedPost} copy={copy} locale={locale} avatarUrl={parentAvatarUrl} /></div>}
    <div className="detail-post-author">
      <div className="avatar"><img src={profileIconSrc(avatarUrl)} alt="" onError={e => useDefaultProfileIcon(e.currentTarget)} /></div>
      <div className="detail-author-text"><b>{authorName}</b>{username && <span>@{username.replace(/^@/, '')}</span>}</div>
<PostMoreMenu post={post} copy={copy} fallbackUsername={username} onCopy={onCopy} />
    </div>
    {replyingTo && <ReplyToNotice username={replyingTo} locale={locale} />}
    <p className="detail-post-text">{renderPostText(post.text, post.urls)}</p>
    {post.hashtags?.length ? <div className="hashtags">{post.hashtags.map(h => <span key={h}>#{h}</span>)}</div> : null}
    {post.media?.length ? <MediaGrid media={post.media} copy={copy} onMediaOpen={index => onMediaOpen(post, index)} /> : null}
    {post.quotedPost && <QuotedPostCard post={post.quotedPost} copy={copy} locale={locale} avatarUrl={quoteAvatarUrl} linkedPost={quotedLinkedPost} onDetail={onDetail} />}
    <DetailMeta createdAt={post.createdAt} viewCount={post.viewCount} locale={locale} />
    <div className="detail-actions">
      <span><PostActionIcon name="reply" /> {count(post.replyCount)}</span>
      <span><PostActionIcon name="retweet" /> {count(post.repostCount)}</span>
      <span><PostActionIcon name="like" /> {count(post.likeCount)}</span>
      <button onClick={() => onBookmark(post)} className={bookmarked ? 'marked' : ''} aria-label={copy.nav.bookmarks}><PostBookmarkIcon marked={bookmarked} /></button>
      {url && <PostShareMenu url={url} copy={copy} onCopy={onCopy} />}
    </div>
  </article>
}
function EmptyState({ copy, onImport }: { copy: Copy; onImport: () => void }) { return <div className="empty"><div className="empty-icon"><FileUp /></div><h2>{copy.empty.title}</h2><p>{copy.empty.body}</p><button className="primary-button" onClick={onImport}>{copy.empty.action}</button></div> }

createRoot(document.getElementById('root')!).render(<App />)
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${publicBase}sw.js`).catch(() => undefined)

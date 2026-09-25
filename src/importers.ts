import Papa from 'papaparse'
import { createId } from './id'
import type { Collection, CollectionType, EmbeddedPost, ImportResult, Media, Post, PostType, Profile } from './types'

type Row = Record<string, string>
const text = (row: Row, key: string) => (row[key] ?? '').trim()
const id = (value: string) => value.trim().replace(/^'/, '')
const contentText = (row: Row, key: string) => text(row, key).replace(/^'(?=@)/, '')
const number = (value: string): number | undefined => {
  const normalized = value.replace(/[,_\s]/g, '')
  if (!normalized) return undefined
  const result = Number(normalized)
  return Number.isFinite(result) ? result : undefined
}
const values = (value: string) => value.split(/[|,\n]/).map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
const cleanMediaUrl = (value: string) => value
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/&amp;/gi, '&')
  .replace(/\\([_()*[\]{}])/g, '$1')
const mediaValues = (value: string) => values(value).map(cleanMediaUrl).filter(Boolean)
const normalizeDate = (value: string) => {
  const raw = value.trim()
  if (!raw) return ''
  const jp = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (jp) return `${jp[1]}-${jp[2].padStart(2, '0')}-${jp[3].padStart(2, '0')}T${(jp[4] || '00').padStart(2, '0')}:${jp[5] || '00'}:${jp[6] || '00'}`
  const slash = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (slash) return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}T${(slash[4] || '00').padStart(2, '0')}:${slash[5] || '00'}:${slash[6] || '00'}`
  return raw.includes('T') ? raw : raw.replace(/^([\d-]+)\s+/, '$1T')
}
const dateTimestamp = (value: string) => {
  const parsed = Date.parse(normalizeDate(value))
  return Number.isNaN(parsed) ? 0 : parsed
}
const asPostType = (value: string): PostType => {
  const v = value.toLowerCase()
  if (v.includes('reply')) return 'reply'
  if (v.includes('quote')) return 'quote'
  if (v.includes('repost') || v.includes('retweet')) return 'repost'
  if (v === 'tweet' || v === 'post') return 'tweet'
  return 'unknown'
}
const typeFromText = (value: string): PostType => /^\s*RT\s+@[\w_]+/i.test(value) ? 'repost' : 'tweet'
const resolvedPostType = (typeValue: string, textValue: string): PostType => {
  const explicit = asPostType(typeValue)
  return explicit === 'unknown' ? typeFromText(textValue) : explicit
}
const parseParams = (input: string) => {
  const get = (keys: string[]) => keys.map(k => new RegExp(`['\"]?${k.replace(/[()]/g, '\\$&')}['\"]?\\s*:\\s*['\"]([^'\"]*)`, 'i').exec(input)?.[1]).find(Boolean)
  return { from: get(['Dates\\(From\\)']), to: get(['Dates\\(To\\)']), account: get(['Titter Account URLs', 'Twitter Account URLs']) }
}
const inferType = (rows: Row[], source: SourceKind): CollectionType => {
  const query = source === 'octoparse' ? text(rows[0] ?? {}, 'input_params') : ''
  const account = source === 'octoparse' ? parseParams(query).account : ''
  if (account) return 'account'
  const handleKey = source === 'octoparse' ? 'User_Handle' : source === 'twsearchexport' ? 'Handle' : source === 'twibot' ? 'handle' : source === 'twispo' ? '@' : source === 'xporter' ? '投稿者ユーザー名' : 'username'
  const handles = new Set(rows.map(r => handle(text(r, handleKey))).filter(Boolean))
  return handles.size <= 1 ? 'account' : 'keyword'
}
const first = (rows: Row[], key: string) => rows.map(r => text(r, key)).find(Boolean)
const firstOf = (rows: Row[], keys: string[]) => keys.map(key => first(rows, key)).find(Boolean)
const avatarKeys = ['Profile_Image_URL', 'Profile_Image', 'Avatar_URL', 'Avatar', 'User_Profile_Image_URL', 'profile_image_url', 'profile_image', 'avatar_url']
const usernameKeys = ['User_Handle', 'Username', 'User_Name_ID', 'Screen_Name', 'screen_name', 'username', 'user_screen_name', 'user_name']
const authorNameKeys = ['User_Name', 'Name', 'Display_Name', 'display_name', 'name']
const followerKeys = ['Follower_Count', 'Followers_Count', 'Followers', 'followers_count', 'followers']
const followingKeys = ['Following_Count', 'Following', 'following_count', 'following']
type SourceKind = 'octoparse' | 'twexportly' | 'twsearchexport' | 'twibot' | 'twispo' | 'xporter'
const handle = (value: string) => value.trim().replace(/^@/, '')
const statusIdFromUrl = (value: string) => /\/status\/(\d+)/.exec(value)?.[1] ?? ''
const mediaKind = (value: string) => /video|動画|mp4|mov|webm|m3u8/i.test(value) ? 'video' : 'image'
const mediaFrom = (urlValue: string, typeValue = ''): Media[] => {
  const typeFromValue = typeValue ? mediaKind(typeValue) : ''
  return mediaValues(urlValue).map(url => ({ url, type: mediaTypeFromUrl(url) || typeFromValue || undefined }))
}
const formatUrl = (row: Row) => {
  const original = text(row, 'Tweet_URL')
  if (!/x\.com\/\/status\//.test(original)) return original
  const account = text(row, 'Account_URL').replace(/\/$/, '').split('/').filter(Boolean).pop()
  return account ? `https://x.com/${account}/status/${id(text(row, 'Tweet_ID'))}` : original
}
const twSearchPostUrl = (row: Row) => {
  const original = text(row, 'TweetURL')
  if (original) return original
  const postId = id(text(row, 'ID'))
  const username = handle(text(row, 'Handle'))
  return postId && username ? `https://x.com/${username}/status/${postId}` : ''
}
function fromOctoparse(row: Row): Post {
  const postId = id(text(row, 'Tweet_ID'))
  const tweetText = contentText(row, 'Tweet_Content')
  return {
    id: postId, text: tweetText, createdAt: normalizeDate(text(row, 'Posted_Time')),
    authorId: id(text(row, 'UserID')), authorName: text(row, 'User_Name'),
    username: text(row, 'User_Handle') || text(row, 'Account_URL').split('/').filter(Boolean).pop(),
    authorAvatarUrl: avatarKeys.map(key => text(row, key)).find(Boolean),
    postUrl: formatUrl(row), replyCount: number(text(row, 'Replies_Count')), repostCount: number(text(row, 'Reposts_Count')),
    likeCount: number(text(row, 'Likes_Count')), viewCount: number(text(row, 'Views_Count')),
    quoteCount: number(text(row, 'Quote_Count')), sourceBookmarkCount: number(text(row, 'Bookmark_Count')),
    type: text(row, 'Is_Quote_Status').toLowerCase() === 'true' ? 'quote' : typeFromText(tweetText), raw: row
  }
}
function fromTwExportly(row: Row): Post {
  const mediaUrls = mediaValues(text(row, 'media_urls'))
  const media: Media[] = mediaUrls.map(url => ({ url, type: text(row, 'media_type') || undefined }))
  const tweetText = contentText(row, 'text')
  return {
    id: id(text(row, 'tweet_id')), text: tweetText, createdAt: normalizeDate(text(row, 'created_at')),
    authorName: authorNameKeys.map(key => text(row, key)).find(Boolean),
    username: usernameKeys.map(key => text(row, key)).find(Boolean),
    authorAvatarUrl: avatarKeys.map(key => text(row, key)).find(Boolean),
    language: text(row, 'language'), type: resolvedPostType(text(row, 'type'), tweetText), hashtags: values(text(row, 'hashtags')).map(v => v.replace(/^#/, '')),
    urls: values(text(row, 'urls')), media: media.length ? media : undefined, client: text(row, 'client'),
    replyCount: number(text(row, 'reply_count')), repostCount: number(text(row, 'retweet_count')),
    likeCount: number(text(row, 'favorite_count')), viewCount: number(text(row, 'view_count')),
    sourceBookmarkCount: number(text(row, 'bookmark_count')), raw: row
  }
}
function fromTwSearchExport(row: Row): Post {
  const imageMedia: Media[] = mediaValues(text(row, 'AllImageURL')).map(url => ({ url, type: 'image' }))
  const videoMedia: Media[] = mediaValues(text(row, 'VideoURL')).map(url => ({ url, type: 'video' }))
  const media = [...imageMedia, ...videoMedia]
  const tweetText = contentText(row, 'TweetText')
  return {
    id: id(text(row, 'ID')), text: tweetText, createdAt: normalizeDate(text(row, 'TweetCreateTime')),
    authorName: text(row, 'Name'), username: handle(text(row, 'Handle')), authorAvatarUrl: text(row, 'AvatarURL'),
    postUrl: twSearchPostUrl(row), hashtags: values(text(row, 'Hashtags')).map(v => v.replace(/^#/, '')),
    urls: values(text(row, 'TweetURL')), media: media.length ? media : undefined, type: typeFromText(tweetText),
    replyCount: number(text(row, 'ReplyCount')), repostCount: number(text(row, 'RetweetCount')),
    likeCount: number(text(row, 'LikeCount')), viewCount: number(text(row, 'Views')),
    quoteCount: number(text(row, 'QuoteCount')), sourceBookmarkCount: number(text(row, 'BookmarkCount')),
    raw: row
  }
}
const mediaTypeFromUrl = (url: string) => /\.(m3u8|mov|mp4|webm)(?:[?#].*)?$/i.test(url) ? 'video' : /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url) ? 'image' : ''
type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)
const jsonString = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
const jsonNumber = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' ? number(value) : undefined
const jsonArray = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter(isObject) : isObject(value) ? [value] : []
const jsonObjectArray = (object: JsonObject, key: string) => jsonArray(object[key])
const xApiMetrics = (tweet: JsonObject) => isObject(tweet.public_metrics) ? tweet.public_metrics : {}
const xApiEntities = (tweet: JsonObject) => isObject(tweet.entities) ? tweet.entities : {}
const xApiMediaFromObject = (media: JsonObject): Media | undefined => {
  const variants = jsonArray(media.variants)
  const videoVariant = variants
    .map(variant => ({ url: jsonString(variant.url), bitrate: jsonNumber(variant.bitrate) ?? 0, contentType: jsonString(variant.content_type) }))
    .filter(variant => variant.url && /mp4|video/i.test(variant.contentType || variant.url))
    .sort((a, b) => b.bitrate - a.bitrate)[0]
  const url = cleanMediaUrl(videoVariant?.url || jsonString(media.url) || jsonString(media.preview_image_url))
  if (!url) return undefined
  const explicitType = jsonString(media.type)
  const type = videoVariant ? 'video' : explicitType === 'photo' ? 'image' : explicitType || mediaTypeFromUrl(url) || undefined
  return { url, type }
}
const xApiUserMaps = (root: JsonObject): Map<string, JsonObject> => {
  const includes = isObject(root.includes) ? root.includes : {}
  const users = jsonObjectArray(includes, 'users')
  return new Map(users.map((user): [string, JsonObject] => [jsonString(user.id), user]).filter(([key]) => key))
}
const xApiTweetMaps = (root: JsonObject): Map<string, JsonObject> => {
  const includes = isObject(root.includes) ? root.includes : {}
  const tweets = [...jsonArray(root.data), ...jsonObjectArray(root, 'tweets'), ...jsonObjectArray(root, 'statuses'), ...jsonObjectArray(includes, 'tweets')]
  return new Map(tweets.map((tweet): [string, JsonObject] => [jsonString(tweet.id), tweet]).filter(([key]) => key))
}
const xApiMediaMaps = (root: JsonObject): Map<string, JsonObject> => {
  const includes = isObject(root.includes) ? root.includes : {}
  const media = jsonObjectArray(includes, 'media')
  return new Map(media.map((item): [string, JsonObject] => [jsonString(item.media_key), item]).filter(([key]) => key))
}
const xApiReferenced = (tweet: JsonObject, type: string) => jsonArray(tweet.referenced_tweets).find(item => jsonString(item.type) === type)
const xApiPostType = (tweet: JsonObject): PostType => {
  if (xApiReferenced(tweet, 'retweeted')) return 'repost'
  if (xApiReferenced(tweet, 'replied_to')) return 'reply'
  if (xApiReferenced(tweet, 'quoted')) return 'quote'
  return 'tweet'
}
const xApiMedia = (tweet: JsonObject, mediaByKey: Map<string, JsonObject>) => {
  const attachments = isObject(tweet.attachments) ? tweet.attachments : {}
  const keys = Array.isArray(attachments.media_keys) ? attachments.media_keys.map(jsonString).filter(Boolean) : []
  const media = keys.map(key => mediaByKey.get(key)).filter(isObject).map(xApiMediaFromObject).filter(Boolean) as Media[]
  return media
}
const xApiUrls = (tweet: JsonObject) => {
  const entities = xApiEntities(tweet)
  return jsonObjectArray(entities, 'urls').map(url => jsonString(url.unwound_url) || jsonString(url.expanded_url) || jsonString(url.url)).filter(Boolean)
}
const xApiHashtags = (tweet: JsonObject) => {
  const entities = xApiEntities(tweet)
  return jsonObjectArray(entities, 'hashtags').map(tag => jsonString(tag.tag).replace(/^#/, '')).filter(Boolean)
}
const xApiEmbeddedPost = (tweet: JsonObject | undefined, usersById: Map<string, JsonObject>, mediaByKey: Map<string, JsonObject>): EmbeddedPost | undefined => {
  if (!tweet) return undefined
  const author = usersById.get(jsonString(tweet.author_id))
  const username = author ? handle(jsonString(author.username)) : ''
  const postId = jsonString(tweet.id)
  const media = xApiMedia(tweet, mediaByKey)
  const metrics = xApiMetrics(tweet)
  return {
    id: postId,
    text: jsonString(tweet.text),
    createdAt: normalizeDate(jsonString(tweet.created_at)),
    authorName: author ? jsonString(author.name) : '',
    username,
    postUrl: postId && username ? `https://x.com/${username}/status/${postId}` : '',
    type: xApiPostType(tweet),
    replyCount: jsonNumber(metrics.reply_count),
    repostCount: jsonNumber(metrics.retweet_count),
    likeCount: jsonNumber(metrics.like_count),
    viewCount: jsonNumber(metrics.impression_count),
    quoteCount: jsonNumber(metrics.quote_count),
    media: media.length ? media : undefined
  }
}
const xApiPost = (tweet: JsonObject, usersById: Map<string, JsonObject>, tweetsById: Map<string, JsonObject>, mediaByKey: Map<string, JsonObject>): Post => {
  const postId = jsonString(tweet.id)
  const author = usersById.get(jsonString(tweet.author_id))
  const username = author ? handle(jsonString(author.username)) : ''
  const media = xApiMedia(tweet, mediaByKey)
  const metrics = xApiMetrics(tweet)
  const repliedRef = xApiReferenced(tweet, 'replied_to')
  const quotedRef = xApiReferenced(tweet, 'quoted')
  const repliedTweet = repliedRef ? tweetsById.get(jsonString(repliedRef.id)) : undefined
  const quotedTweet = quotedRef ? tweetsById.get(jsonString(quotedRef.id)) : undefined
  return {
    id: postId,
    text: jsonString(tweet.text),
    createdAt: normalizeDate(jsonString(tweet.created_at)),
    authorId: jsonString(tweet.author_id),
    authorName: author ? jsonString(author.name) : '',
    username,
    authorAvatarUrl: author ? jsonString(author.profile_image_url) : '',
    postUrl: postId && username ? `https://x.com/${username}/status/${postId}` : '',
    language: jsonString(tweet.lang),
    type: xApiPostType(tweet),
    media: media.length ? media : undefined,
    hashtags: xApiHashtags(tweet),
    urls: xApiUrls(tweet),
    replyCount: jsonNumber(metrics.reply_count),
    repostCount: jsonNumber(metrics.retweet_count),
    likeCount: jsonNumber(metrics.like_count),
    viewCount: jsonNumber(metrics.impression_count),
    quoteCount: jsonNumber(metrics.quote_count),
    sourceBookmarkCount: jsonNumber(metrics.bookmark_count),
    replyToPostId: repliedRef ? jsonString(repliedRef.id) : undefined,
    repliedPost: xApiEmbeddedPost(repliedTweet, usersById, mediaByKey),
    quotedPost: xApiEmbeddedPost(quotedTweet, usersById, mediaByKey),
    raw: Object.fromEntries(Object.entries(tweet).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
  }
}
const buildXApiCollection = (json: unknown, filename: string): ImportResult => {
  const root: JsonObject = Array.isArray(json) ? { data: json } : isObject(json) ? json : {}
  const tweets = jsonArray(root.data).length ? jsonArray(root.data) : jsonObjectArray(root, 'tweets').length ? jsonObjectArray(root, 'tweets') : jsonObjectArray(root, 'statuses')
  if (!tweets.length) throw new Error('X APIのJSONからツイートを見つけられませんでした。')
  const usersById = xApiUserMaps(root)
  const tweetsById = xApiTweetMaps(root)
  const mediaByKey = xApiMediaMaps(root)
  const posts = tweets.map(tweet => xApiPost(tweet, usersById, tweetsById, mediaByKey)).filter(post => post.id && post.text).sort((a, b) => dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt))
  if (!posts.length) throw new Error('有効なツイートを読み込めませんでした。')
  const usernames = new Set(posts.map(post => handle(post.username || '')).filter(Boolean))
  const type: CollectionType = usernames.size <= 1 ? 'account' : 'keyword'
  const firstPost = posts[0]
  const firstUser = usersById.get(firstPost.authorId || '')
  const profile: Profile | undefined = type === 'account' ? {
    displayName: firstUser ? jsonString(firstUser.name) : firstPost.authorName,
    username: firstPost.username,
    avatarUrl: firstUser ? jsonString(firstUser.profile_image_url) : firstPost.authorAvatarUrl,
    bio: firstUser ? jsonString(firstUser.description) : '',
    location: firstUser ? jsonString(firstUser.location) : '',
    website: firstUser ? jsonString(firstUser.url) : '',
    joinedAt: firstUser ? normalizeDate(jsonString(firstUser.created_at)) : '',
    followersCount: firstUser && isObject(firstUser.public_metrics) ? jsonNumber(firstUser.public_metrics.followers_count) : undefined,
    followingCount: firstUser && isObject(firstUser.public_metrics) ? jsonNumber(firstUser.public_metrics.following_count) : undefined
  } : undefined
  const title = type === 'account' ? (profile?.displayName || (firstPost.username ? `@${firstPost.username}` : 'X API')) : 'X API'
  return {
    collection: {
      id: createId('collection'), type, title, query: firstPost.username || title, posts, accountProfile: profile,
      sourceName: filename, sourceFormat: 'JSON', importedAt: new Date().toISOString()
    },
    source: 'X API JSON',
    warnings: []
  }
}
function fromTwiBot(row: Row): Post {
  const mediaUrls = mediaValues(text(row, 'allMediaURL'))
  const videoUrls = mediaValues(text(row, 'videoURL'))
  const tweetText = contentText(row, 'tweetText')
  const media: Media[] = [
    ...mediaUrls.map(url => ({ url, type: mediaTypeFromUrl(url) })),
    ...videoUrls.map(url => ({ url, type: 'video' }))
  ]
  return {
    id: id(text(row, 'id')), text: tweetText, createdAt: normalizeDate(text(row, 'createdAt')),
    authorName: text(row, 'tweetAuthor'), username: handle(text(row, 'handle')), postUrl: text(row, 'tweetURL'),
    type: resolvedPostType(text(row, 'type'), tweetText), hashtags: values(text(row, 'hashtags')).map(v => v.replace(/^#/, '')),
    replyCount: number(text(row, 'replyCount')), repostCount: number(text(row, 'retweetCount')),
    likeCount: number(text(row, 'likeCount')), viewCount: number(text(row, 'views')),
    quoteCount: number(text(row, 'quoteCount')), sourceBookmarkCount: number(text(row, 'bookmarkCount')),
    media: media.length ? media : undefined, raw: row
  }
}
function fromTwispo(row: Row): Post {
  const postUrl = text(row, 'URL')
  const tweetText = contentText(row, 'テキスト')
  return {
    id: id(statusIdFromUrl(postUrl) || postUrl || `${text(row, '@')}-${text(row, '投稿日時')}-${tweetText}`),
    text: tweetText, createdAt: normalizeDate(text(row, '投稿日時')),
    authorName: text(row, '名前'), username: handle(text(row, '@')), postUrl,
    client: text(row, '投稿アプリ'), type: typeFromText(tweetText),
    replyCount: number(text(row, 'リプライ数')), repostCount: number(text(row, 'RT数')),
    likeCount: number(text(row, 'いいね数')), viewCount: number(text(row, 'imp')),
    quoteCount: number(text(row, '引用数')), raw: row
  }
}
const xporterEmbeddedPost = (row: Row, prefix: string): EmbeddedPost | undefined => {
  const postId = id(text(row, `${prefix}: ID`))
  const tweetText = contentText(row, `${prefix}: 本文`)
  const postUrl = text(row, `${prefix}: 投稿URL`)
  if (!postId && !tweetText && !postUrl) return undefined
  const media = mediaFrom(text(row, `${prefix}: メディアURL`), text(row, `${prefix}: メディア種類`))
  return {
    id: postId || statusIdFromUrl(postUrl), text: tweetText, createdAt: normalizeDate(text(row, `${prefix}: 日付`)),
    authorName: text(row, `${prefix}: 投稿者名`), username: handle(text(row, `${prefix}: 投稿者ユーザー名`)),
    postUrl, type: resolvedPostType(text(row, `${prefix}: 種類`), tweetText),
    replyCount: number(text(row, `${prefix}: 返信数`)), repostCount: number(text(row, `${prefix}: リポスト数`)),
    likeCount: number(text(row, `${prefix}: いいね数`)), viewCount: number(text(row, `${prefix}: 表示回数`)),
    quoteCount: number(text(row, `${prefix}: 引用数`)), media: media.length ? media : undefined
  }
}
function fromXPorter(row: Row): Post {
  const postUrl = text(row, '投稿URL')
  const tweetText = contentText(row, '本文')
  const media = mediaFrom(text(row, 'メディアURL'), text(row, 'メディア種類'))
  const articleTitle = text(row, '記事タイトル')
  const articleUrl = text(row, '記事URL')
  const articleBody = contentText(row, '記事本文')
  const article = articleTitle || articleUrl || articleBody ? { title: articleTitle, url: articleUrl, body: articleBody } : undefined
  const repliedPost = xporterEmbeddedPost(row, '返信先の投稿')
  const quotedPost = xporterEmbeddedPost(row, '引用された投稿')
  const replyToPostId = id(text(row, '返信先の投稿 ID'))
  const replyToUsername = handle(text(row, '返信先ユーザー名'))
  return {
    id: id(text(row, 'ID') || statusIdFromUrl(postUrl) || `${text(row, '投稿者ユーザー名')}-${text(row, '日付')}-${tweetText}`),
    text: tweetText, createdAt: normalizeDate(text(row, '日付')), postUrl,
    language: text(row, '言語'), type: quotedPost ? 'quote' : resolvedPostType(text(row, '種類'), tweetText),
    authorName: text(row, '投稿者名'), username: handle(text(row, '投稿者ユーザー名')),
    urls: values(text(row, 'リンク')), media: media.length ? media : undefined, article,
    replyCount: number(text(row, '返信数')), repostCount: number(text(row, 'リポスト数')),
    likeCount: number(text(row, 'いいね数')), viewCount: number(text(row, '表示回数')),
    quoteCount: number(text(row, '引用数')), sourceBookmarkCount: number(text(row, 'ブックマーク数')),
    quotedPost, repliedPost, replyToPostId, replyToUsername, raw: row
  }
}
const dedupeKey = (post: Post) => {
  if (post.id) return `id:${post.id}`
  if (post.postUrl) return `url:${post.postUrl}`
  return `content:${post.createdAt}|${post.username ?? ''}|${post.text}`.toLowerCase()
}
const compactPost = (post: Post) => Object.fromEntries(Object.entries(post).filter(([, value]) => value !== undefined && value !== '')) as Post
const mergeDuplicatePost = (existing: Post, incoming: Post): Post => ({
  ...compactPost(incoming),
  ...compactPost(existing),
  media: existing.media?.length ? existing.media : incoming.media,
  quotedPost: existing.quotedPost ?? incoming.quotedPost,
  repliedPost: existing.repliedPost ?? incoming.repliedPost,
  replyToPostId: existing.replyToPostId ?? incoming.replyToPostId,
  replyToUsername: existing.replyToUsername ?? incoming.replyToUsername,
  hashtags: existing.hashtags?.length ? existing.hashtags : incoming.hashtags,
  urls: existing.urls?.length ? existing.urls : incoming.urls,
  raw: { ...incoming.raw, ...existing.raw }
})
function buildCollection(rows: Row[], format: 'CSV' | 'XML' | 'JSON', filename: string, meta: { query?: string } = {}): ImportResult {
  if (!rows.length) throw new Error('ツイートデータが見つかりませんでした。')
  const octoparse = ['Tweet_ID', 'Tweet_Content', 'Posted_Time'].every(key => key in rows[0])
  const twexportly = ['tweet_id', 'text', 'created_at'].every(key => key in rows[0])
  const twsearchexport = ['ID', 'Name', 'Handle', 'TweetText', 'TweetCreateTime'].every(key => key in rows[0])
  const twibot = ['id', 'tweetText', 'tweetURL', 'type', 'tweetAuthor', 'handle', 'createdAt'].every(key => key in rows[0])
  const twispo = ['投稿日時', 'テキスト', 'URL', 'imp', '@', '名前'].every(key => key in rows[0])
  const xporter = ['ID', '本文', '投稿URL', '種類', '投稿者ユーザー名'].every(key => key in rows[0])
  if (!octoparse && !twexportly && !twsearchexport && !twibot && !twispo && !xporter) throw new Error('対応する取得形式を判定できませんでした。')
  const source: SourceKind = octoparse ? 'octoparse' : twsearchexport ? 'twsearchexport' : twibot ? 'twibot' : twispo ? 'twispo' : xporter ? 'xporter' : 'twexportly'
  const warnings: string[] = []
  const map = source === 'octoparse' ? fromOctoparse : source === 'twsearchexport' ? fromTwSearchExport : source === 'twibot' ? fromTwiBot : source === 'twispo' ? fromTwispo : source === 'xporter' ? fromXPorter : fromTwExportly
  const unique = new Map<string, Post>()
  rows.forEach((row, i) => {
    try { const post = map(row); if (!post.id || !post.text) { warnings.push(`${i + 1}行目: IDまたは本文がありません`); return }; const key = dedupeKey(post); const existing = unique.get(key); unique.set(key, existing ? mergeDuplicatePost(existing, post) : post) }
    catch { warnings.push(`${i + 1}行目を解析できませんでした`) }
  })
  const posts = [...unique.values()].sort((a, b) => dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt))
  if (!posts.length) throw new Error('有効なツイートを読み込めませんでした。')
  const params: { from?: string; to?: string; account?: string } = source === 'octoparse' ? parseParams(text(rows[0], 'input_params')) : {}
  const type = source === 'twibot' && meta.query?.startsWith('#') ? 'hashtag' : inferType(rows, source)
  const username = source === 'octoparse'
    ? handle(first(rows, 'User_Handle') || params.account?.split('/').filter(Boolean).pop() || '')
    : source === 'twsearchexport'
      ? handle(first(rows, 'Handle') || '')
      : source === 'twibot'
        ? handle(first(rows, 'handle') || '')
        : source === 'twispo'
          ? handle(first(rows, '@') || '')
          : source === 'xporter'
            ? handle(first(rows, '投稿者ユーザー名') || '')
            : handle(firstOf(rows, usernameKeys) || '')
  const profile: Profile | undefined = source === 'octoparse' ? {
    displayName: first(rows, 'User_Name'), username, avatarUrl: firstOf(rows, avatarKeys), bio: first(rows, 'Intro'), website: first(rows, 'Website'),
    location: first(rows, 'Location'), joinedAt: first(rows, 'Joined_Date'), followersCount: number(firstOf(rows, followerKeys) ?? ''), followingCount: number(firstOf(rows, followingKeys) ?? '')
  } : source === 'twsearchexport' && type === 'account' ? {
    displayName: first(rows, 'Name'), username, avatarUrl: first(rows, 'AvatarURL'), headerImageUrl: first(rows, 'ProfileBannerURL'),
    bio: first(rows, 'Bio'), website: first(rows, 'LinkInBio'), location: first(rows, 'Location'), joinedAt: first(rows, 'AccountCreateDate'),
    followersCount: number(first(rows, 'FollowersCount') ?? ''), followingCount: number(first(rows, 'FollowingCount') ?? '')
  } : source === 'twibot' && type === 'account' ? {
    displayName: first(rows, 'tweetAuthor'), username, location: first(rows, 'geo')
  } : source === 'twispo' && type === 'account' ? {
    displayName: first(rows, '名前'), username, bio: first(rows, '自己紹介'), joinedAt: first(rows, 'アカウント作成日'),
    followersCount: number(first(rows, 'フォロワー数') ?? ''), followingCount: number(first(rows, 'フォロー数') ?? '')
  } : source === 'xporter' && type === 'account' ? {
    displayName: first(rows, '投稿者名'), username, avatarUrl: first(rows, 'AvatarURL'), headerImageUrl: first(rows, 'ProfileBannerURL'),
    bio: first(rows, 'Bio'), website: first(rows, 'LinkInBio'), location: first(rows, 'Location'),
    followersCount: number(first(rows, 'FollowersCount') ?? ''), followingCount: number(first(rows, 'FollowingCount') ?? '')
  } : undefined
  const fallback = meta.query || (type === 'account' ? (username ? `@${username}` : '不明なアカウント') : '検索結果')
  const collection: Collection = {
    id: createId('collection'), type, title: fallback, query: username || fallback, posts, accountProfile: profile,
    sourceName: filename, sourceFormat: format, importedAt: new Date().toISOString(), sourcePeriod: { from: params.from, to: params.to }
  }
  const sourceLabel = source === 'octoparse' ? 'Octoparse Twitter Scraper' : source === 'twsearchexport' ? 'TwSearchExport' : source === 'twibot' ? 'TwiBot' : source === 'twispo' ? 'ついすぽ -Tweet Export-' : source === 'xporter' ? 'XPorter' : 'TwExportly'
  return { collection, source: sourceLabel, warnings }
}
export async function importText(content: string, filename: string): Promise<ImportResult> {
  const trimmed = content.trim()
  if (filename.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return buildXApiCollection(JSON.parse(trimmed), filename) }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('JSONの形式が正しくありません。')
      throw error
    }
  }
  if (filename.toLowerCase().endsWith('.xml')) {
    const doc = new DOMParser().parseFromString(content, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('XMLの形式が正しくありません。')
    const rows = [...doc.querySelectorAll('item')].map(item => Object.fromEntries([...item.children].map(el => [el.tagName, el.textContent ?? ''])))
    return buildCollection(rows, 'XML', filename)
  }
  const twibotHeader = /^id,tweetText,tweetURL,type,tweetAuthor,handle,/m.exec(content)
  const twibotQuery = /contains\s+hashtag\s+results\s+for\s+'([^']+)'/i.exec(content.slice(0, twibotHeader?.index ?? 0))?.[1]
  const csvContent = twibotHeader ? content.slice(twibotHeader.index) : content
  return new Promise((resolve, reject) => Papa.parse<Row>(csvContent, { header: true, skipEmptyLines: 'greedy', complete: result => {
    if (result.errors.length) reject(new Error(`CSVを解析できませんでした: ${result.errors[0].message}`))
    else { try { resolve(buildCollection(result.data, 'CSV', filename, { query: twibotQuery })) } catch (error) { reject(error) } }
  }, error: reject }))
}

export async function importFile(file: File): Promise<ImportResult> {
  return importText(await file.text(), file.name)
}

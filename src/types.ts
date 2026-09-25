export type CollectionType = 'account' | 'keyword' | 'hashtag'
export type PostType = 'tweet' | 'reply' | 'quote' | 'repost' | 'unknown'

export type Media = { type?: string; url: string; posterUrl?: string }
export type EmbeddedPost = {
  id?: string; text: string; createdAt?: string; authorName?: string; username?: string; postUrl?: string; type?: PostType
  media?: Media[]; replyCount?: number; repostCount?: number; likeCount?: number; viewCount?: number; quoteCount?: number
}
export type Post = {
  id: string; text: string; createdAt: string; authorId?: string; authorName?: string; username?: string
  authorAvatarUrl?: string; language?: string; type?: PostType; media?: Media[]; hashtags?: string[]; urls?: string[]
  article?: { title?: string; url?: string; body?: string }
  replyCount?: number; repostCount?: number; likeCount?: number; viewCount?: number; quoteCount?: number
  sourceBookmarkCount?: number; client?: string; postUrl?: string; quotedPost?: EmbeddedPost; repliedPost?: EmbeddedPost
  replyToPostId?: string; replyToUsername?: string; raw?: Record<string, string>
}
export type Profile = {
  displayName?: string; username?: string; avatarUrl?: string; customAvatarUrl?: string; headerImageUrl?: string; bio?: string
  location?: string; website?: string; joinedAt?: string; followersCount?: number; followingCount?: number
}
export type Collection = {
  id: string; type: CollectionType; title: string; query: string; posts: Post[]; accountProfile?: Profile
  sourceName: string; sourceFormat: 'CSV' | 'XML' | 'JSON'; importedAt: string; sourcePeriod?: { from?: string; to?: string }
  sourceText?: string; originalSourceText?: string
}
export type ImportResult = { collection: Collection; source: string; warnings: string[] }

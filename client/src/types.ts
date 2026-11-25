export interface Account {
  id: string;
  name: string;
  kind: 'owner' | 'home' | 'token';
  thumb?: string;
  parentId?: string;
  /** Owns the Plex server: can edit metadata, artwork and collections. */
  admin: boolean;
}

export interface Item {
  ratingKey: string;
  playlistItemID?: string;
  title: string;
  displayTitle: string;
  type: string;
  year?: number;
  library?: string;
  thumb?: string;
  duration?: number;
  viewCount?: number;
  addedAt?: number;
  originallyAvailableAt?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  leafCount?: number;
  viewedLeafCount?: number;
  childCount?: number;
  rating?: number;
  art?: string;
  librarySectionID?: string;
  grandparentKey?: string;
  parentKey?: string;
}

export interface Playlist {
  ratingKey: string;
  title: string;
  playlistType: string;
  smart: boolean;
  leafCount: number;
  duration?: number;
  thumb?: string;
  updatedAt?: number;
  addedAt?: number;
}

export interface Collection {
  ratingKey: string;
  title: string;
  smart: boolean;
  leafCount: number;
  thumb?: string;
  subtype?: string;
  collectionSort?: string;
  librarySectionID?: string;
  updatedAt?: number;
}

export interface Library {
  key: string;
  title: string;
  type: string;
}

export interface IndexedPlaylist extends Playlist {
  entries: { rk: string; pid: string; gk?: string; pk?: string }[];
}

export interface SearchHub {
  type: string;
  title: string;
  items: Item[];
}

export interface HomeUser {
  id: number;
  uuid: string;
  title: string;
  thumb?: string;
  admin: boolean;
  restricted: boolean;
  protected: boolean;
  addedAs?: string;
}

export interface ItemDetails extends Item {
  summary?: string;
  collections: string[];
  librarySectionID: string;
}

export interface LibraryPageResult {
  total: number;
  start: number;
  items: Item[];
}

export interface ArtOption {
  key: string;
  thumb?: string;
  selected: boolean;
  provider?: string;
}

export type ArtKind = 'poster' | 'art';

export interface MediaStream {
  streamType: number;
  codec?: string;
  displayTitle?: string;
  language?: string;
  selected: boolean;
}

export interface MediaPart {
  file?: string;
  size?: number;
  container?: string;
  duration?: number;
  exists?: boolean;
  accessible?: boolean;
  streams: MediaStream[];
}

export interface MediaInfo {
  id: string;
  videoResolution?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  videoFrameRate?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  bitrate?: number;
  duration?: number;
  editionTitle?: string;
  parts: MediaPart[];
}

export interface FullItem extends Item {
  librarySectionID: string;
  fields: Record<string, string>;
  tags: Record<string, string[]>;
  locked: string[];
  guid?: string;
  guids: string[];
  updatedAt?: number;
  lastViewedAt?: number;
  locations: string[];
  media: MediaInfo[];
}

export interface MatchResult {
  guid: string;
  name: string;
  year?: number;
  score?: number;
  thumb?: string;
  summary?: string;
  matched: boolean;
}

export interface WebImage {
  thumbnail: string;
  original: string;
  width?: number;
  height?: number;
  title?: string;
  source?: string;
  link?: string;
}

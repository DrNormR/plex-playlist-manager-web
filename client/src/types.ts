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
  /** Milliseconds into the item, when partly watched. */
  viewOffset?: number;
  lastViewedAt?: number;
}

export interface WatchedItem extends Item {
  viewedAt: number;
  deleted?: boolean;
}

export interface RecentLibrary {
  key: string;
  title: string;
  type: string;
  items: Item[];
  error?: string;
}

export interface StatsData {
  generatedAt: number;
  accounts: { id: number; name: string }[];
  libraries: { key: string; title: string; type: string }[];
  devices: { id: number; name: string }[];
  titles: { key: string; title: string; type: string; thumb?: string; lib: number }[];
  /** [viewedAt, title idx, account idx, minutes, library idx, device idx, estimated] */
  plays: [number, number, number, number, number, number, number][];
  unknownDuration: number;
}

export interface LibraryCompletion {
  key: string;
  title: string;
  type: string;
  unit: string;
  total: number;
  watched: number;
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
  /** Title and year guessed from the file or folder name. */
  fromName?: { name: string; title: string; year?: number };
  media: MediaInfo[];
}

export interface DateOptions {
  yearOnly: 'jan1' | 'keep';
  setTitle: boolean;
}

export interface DatePlan {
  ratingKey: string;
  title: string;
  show?: string;
  file?: string;
  year?: number;
  date?: string;
  addedAt?: number;
  parsed: { year: number; date?: string } | null;
  set: { year?: string; originallyAvailableAt?: string; title?: string };
}

export interface AutoDateRule extends DateOptions {
  acctId: string;
  sec: string;
  library: string;
  since: number;
  lastRun?: string;
  lastChanged?: number;
  totalChanged?: number;
  lastError?: string;
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

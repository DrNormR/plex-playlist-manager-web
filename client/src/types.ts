export interface Account {
  id: string;
  name: string;
  kind: 'owner' | 'home' | 'token';
  thumb?: string;
  parentId?: string;
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

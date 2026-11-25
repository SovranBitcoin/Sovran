export type NaggFeedEvent = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
};

export type NaggProfileInfo = {
  name: string;
  picture?: string;
};

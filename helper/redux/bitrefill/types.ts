export interface BitrefillEvent {
  event?: string;
  [key: string]: any;
}

export interface BitrefillState {
  events: BitrefillEvent[];
}

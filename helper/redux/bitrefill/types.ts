import { BitrefillEventType } from "app/MessagePage/EventsComponent";

export interface BitrefillEvent {
  event: BitrefillEventType;
  [key: string]: any;
}

export interface BitrefillState {
  events: BitrefillEvent[];
}

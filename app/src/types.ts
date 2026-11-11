/** Vad huvudknappen ska göra efter ett lugnt "försök igen"-meddelande. */
export type Retry = "again" | "search" | "pick";

export class FriendlyError extends Error {
  constructor(public title: string, public text: string, public retry: Retry = "again") { super(title); }
}

export type Found = { id: string; name: string };

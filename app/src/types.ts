export class FriendlyError extends Error {
  constructor(public title: string, public text: string) { super(title); }
}

export type Found = { id: string; name: string };

// A collab room id is a bearer credential: anyone who knows it can read and
// write that room's CRDT on the configured Yjs server (see docs/security.md,
// "Yjs collaboration token has no real auth"). It reaches this app from three
// places, only one of which we mint ourselves:
//
//   1. ensureCollabId() — uuidv4 on this device. Trusted.
//   2. a note's `collabId:` frontmatter, pulled from the vault repo. Whoever
//      can write the repo chooses it.
//   3. a `?collab=…` share link. Whoever sent the link chooses it.
//
// Shape validation is the cheap half of not trusting 2 and 3: a room id that
// is not a v4 UUID was not minted by any noteser client, so nothing is lost by
// refusing it, and an arbitrary string reaching the room name (or the
// serialized frontmatter) is not something to find out about later.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidCollabId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

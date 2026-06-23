// Height (px) of one rendered content line in a note/reply body. Single source
// of truth: `NoteContent` re-exports this for its own text rendering, and the
// reply skeleton sizes its content bars to the same value, so a rendered note
// and the skeleton it replaces never drift in height.
export const NOTE_CONTENT_LINE_HEIGHT = 24;

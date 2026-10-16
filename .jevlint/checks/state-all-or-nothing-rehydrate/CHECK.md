Where does a decode failure in one part of persisted state discard or reset the whole store?

Find rehydrate, merge, migrate and storage-read code whose failure branch returns the initial or
current state, {}, null or defaults for the entire store, including createMergeWithSchema and its
call sites. Correct shapes: a per-field .catch() or .default(), a tolerant array or record that
drops only bad entries, a version bump with a migrate that maps old data forward, or a failure
branch that refuses and surfaces an error. Decoders for network or clipboard input, and in-memory
or ephemeral caches, are not this question.

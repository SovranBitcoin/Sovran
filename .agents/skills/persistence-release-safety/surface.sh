#!/bin/sh
# Print the raw persistence surface of one revision: every line that names a durable key,
# database, file or storage library. Evidence for the persistence map; it interprets nothing.
# Usage: surface.sh <rev>     (run from the repository root)
set -euf # -f: the pathspecs below are for git, not for the shell to expand
REV="${1:?usage: surface.sh <rev>}"
git rev-parse --verify --quiet "$REV^{commit}" >/dev/null || { echo "unknown revision: $REV" >&2; exit 2; }

SRC="*.ts *.tsx *.js *.jsx *.mjs"
# shellcheck disable=SC2086
scan() { # title, extended regex
  echo "## $1"
  git grep -nE "$2" "$REV" -- $SRC \
    ':!*node_modules*' ':!*.test.*' ':!*__tests__*' ':!*__mocks__*' ':!docs/*' ':!site/*' ':!press/*' \
    2>/dev/null | sed "s|^$REV:||" || true
  echo
}

echo "# Persistence surface at $REV ($(git log -1 --format='%h %ad %s' --date=short "$REV"))"
echo
for f in app/app.json app.json; do
  if git cat-file -e "$REV:$f" 2>/dev/null; then
    echo "## Version ($f)"
    git show "$REV:$f" | grep -nE '"(version|buildNumber|versionCode|bundleIdentifier|package|runtimeVersion)"' || true
    echo
    break
  fi
done

echo "## Storage dependencies (declared)"
for f in package.json app/package.json wallet/package.json nostr/package.json; do
  git cat-file -e "$REV:$f" 2>/dev/null || continue
  git show "$REV:$f" | grep -nE '"(@react-native-async-storage/async-storage|expo-secure-store|expo-sqlite|expo-file-system|react-native-mmkv|redux-persist|zustand|react-native-keychain|@op-engineering/op-sqlite|@cashu/[a-z-]+|coco-cashu-[a-z-]+|@cashu/coco-[a-z-]+|@nostr-dev-kit/[a-z-]+|@tanstack/[a-z-]*persist[a-z-]*)"' \
    | sed "s|^|$f:|" || true
done
echo

# Names are only meaningful in files that persist something, so limit that scan to them.
PERSIST_FILES=$(git grep -lE "(zustand/middleware|redux-persist|persistConfig|defineStore|createJSONStorage|persistQueryClient|createAsyncStoragePersister|AsyncStorage|SecureStore)" "$REV" -- $SRC \
  ':!*node_modules*' ':!*.test.*' ':!*__tests__*' ':!*__mocks__*' 2>/dev/null | sed "s|^$REV:||" || true)
echo "## Persisted store names (in files that touch persistence)"
if [ -n "$PERSIST_FILES" ]; then
  # shellcheck disable=SC2086
  git grep -nE "(^|[^A-Za-z])(name|key|storageKey|persistKey|storeName|whitelist|blacklist): *(\\[|['\"\`][A-Za-z0-9_:.\$\{\}-]+['\"\`])" "$REV" -- $PERSIST_FILES 2>/dev/null | sed "s|^$REV:||" || true
fi
echo
scan "Persist versions and migrations" \
  "(^|[^A-Za-z])(version: *[0-9]+|migrate[:(]|createMigrate|partialize|onRehydrateStorage|skipHydration)"
scan "AsyncStorage calls" \
  "AsyncStorage\.(getItem|setItem|removeItem|mergeItem|multiGet|multiSet|multiRemove|multiMerge|getAllKeys|clear)\("
scan "SecureStore calls and options" \
  "(SecureStore\.[A-Za-z]+\(|(get|set|delete)ItemAsync\(|keychainService|keychainAccessible|requireAuthentication|WHEN_UNLOCKED|AFTER_FIRST_UNLOCK)"
scan "SQLite databases" \
  "(openDatabase(Sync|Async)?\(|deleteDatabase(Sync|Async)?\(|['\"\`][A-Za-z0-9_\$\{\}.-]+\.db['\"\`]|PRAGMA user_version|CREATE TABLE|ALTER TABLE|DROP TABLE)"
scan "MMKV" "(new MMKV\(|createMMKV\(|MMKV\.)"
scan "Files on disk" "(documentDirectory|cacheDirectory|Paths\.(document|cache)|writeAsStringAsync|moveAsync|deleteAsync)"
scan "Key and seed derivation (what the durable secrets mean)" \
  "(mnemonicToSeed|generateMnemonic|HDKey|derivePath|deriveChild|m/[0-9]+')"

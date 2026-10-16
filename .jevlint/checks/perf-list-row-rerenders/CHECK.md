Where does one item's change, or an unrelated store write, re-render every row of a long list?

Find FlashList and FlatList screens for feeds, notifications, transactions, mints, contacts and
messages, their keyExtractor and renderItem, and the store selectors each row reads. Concerns: no
stable key, or an index key on a list that reorders; a row subscribed to a whole collection or
store when it needs one entry; a parent passing a fresh object, array or callback that changes for
every row when one row's data changes; a long list rendered in a ScrollView. Per the
react-native-best-practices skill, do not flag missing useMemo or useCallback on their own: React
Compiler memoizes, and a concern needs a visible path from one change to all rows. Tests that
count row renders (app/features/feed/__tests__/engagementRowRenders.test.tsx) show the intended
shape.

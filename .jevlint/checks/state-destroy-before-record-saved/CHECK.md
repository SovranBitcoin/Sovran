Where is something irreversible done on the strength of a record whose save has not been confirmed?

Find deletions of wallet databases, files, secure keys and stored rows, and the record written
beforehand that says the deletion is intended or done (a forget-record, a marker, a rewritten
profile list). The concern is a setter that does not wait for its save, followed by the deletion:
if the save is dropped, the next launch finds a recorded thing missing. Correct shapes resolve
only once the value on disk has been read back, and fail before anything is deleted
(forgetWalletDatabases in app/shared/lib/cashu/walletDatabaseRecord.ts). Find the tests too.

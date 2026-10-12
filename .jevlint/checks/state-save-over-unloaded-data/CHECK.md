Where can durable state be written while the stored copy has not loaded, so defaults or a partial value replace what was saved?

Find writers that reach storage without going through a store's unreadable-data guard: direct
AsyncStorage or SecureStore writes, setters called before hydration finishes, and helpers that
rewrite a whole list or record (app/shared/lib/cashu/walletDatabaseRecord.ts is one). For each,
find what proves the existing value was read first and what happens when that read failed or was
rejected. Past instances: theme defaults persisted after a failed read, Routstr defaults saved
over a stored key after a rejected load, a forget-record written over a profile list that had not
loaded. Refusing to write, or holding the app on a retry screen, is correct.

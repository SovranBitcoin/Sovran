Where does module-level state hold one account's data without being cleared when the account changes?

Find Maps, Sets, singletons, caches, in-flight promise tables and module variables outside any
store that hold data belonging to an account: seeds and keys, balances, quotes, publish flights,
profile or mint data keyed without the account. Each must register a dispose function through
registerAccountScoped, or be a store declared through defineStore with a profile or session scope
(app/shared/lib/account/accountRegistry.ts). An in-process switch otherwise leaves the previous
account's memory live under the new account. State that is global to the installation, or keyed
by the owning account's identity, is correct.

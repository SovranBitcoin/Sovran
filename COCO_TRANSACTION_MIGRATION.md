# Coco Transaction Migration Guide

This document outlines the migration from Redux-based transaction management to Coco's built-in transaction system.

## Overview

We've migrated from manual Redux transaction state management to Coco's automatic transaction management through its event system and history API.

## Key Changes

### 1. Transaction Provider Migration

**Before (Redux-based):**

```typescript
// Old TransactionsProvider.tsx
const allTransactions = useSelector(memoizedGetTransactions({ id: profileId }));
// Manual state updates with updateTransaction()
```

**After (Coco-based):**

```typescript
// New CocoTransactionsProvider.tsx
const { history, loadMore, refresh, hasMore, isFetching } = usePaginatedHistory();
// Automatic state updates through Coco's event system
```

### 2. Transaction Status Checking

**Before:**

```typescript
// Manual Redux updates
updateTransaction({
  profileId,
  matcher: (t) => t.id === transactionId,
  updateFn: (t) => ({ ...t, paid: true, state: 'PAID' }),
});
```

**After:**

```typescript
// Coco handles this automatically through event subscriptions
manager.on('mint-quote:state-changed', (payload) => {
  // Coco automatically updates its internal state
  refresh(); // Just refresh the history to get latest data
});
```

### 3. Component Updates

**Before:**

```typescript
// Using Redux selectors
const transactions = useSelector(memoizedGetTransactions({ id: profileId }));
```

**After:**

```typescript
// Using Coco hooks
const { history: transactions } = usePaginatedHistory();
// or
const { transactions } = useCashu(); // This now uses Coco history internally
```

## Migration Steps Completed

✅ **Updated CocoTransactionsProvider** - Now uses `usePaginatedHistory()` instead of Redux
✅ **Updated TransactionMintRefresh** - Uses Coco's status checking APIs
✅ **Replaced Redux selectors** - `memoizedGetTransactions` replaced with Coco history
✅ **Removed updateTransaction** - No longer needed, Coco handles state automatically
✅ **Updated useCashu hook** - Now uses Coco history internally

## Benefits of the New System

1. **Automatic State Management**: Coco handles all transaction state updates automatically
2. **Real-time Updates**: Event-driven system provides instant updates
3. **Simplified Code**: No more manual Redux state management
4. **Better Performance**: Coco's optimized state management
5. **Type Safety**: Use Coco's built-in types instead of custom Redux types

## Event System

Coco provides these events for transaction monitoring:

- `mint-quote:state-changed` - Lightning invoice status changes
- `proofs:state-changed` - Ecash token status changes
- `melt-quote:paid` - Lightning payment completions
- `history:updated` - General history updates

## Usage Examples

### Basic Transaction List

```typescript
import { useTransactions } from 'providers/CocoTransactionsProvider';

const TransactionList = () => {
  const { history, loadMore, refresh, hasMore, isFetching } = useTransactions();

  return (
    <View>
      {history.map(transaction => (
        <TransactionItem key={transaction.id} transaction={transaction} />
      ))}
      {hasMore && <Button onPress={loadMore} title="Load More" />}
    </View>
  );
};
```

### Status Checking

```typescript
import { useManager } from 'coco-cashu-react';

const StatusChecker = () => {
  const manager = useManager();

  const checkLightningStatus = async (mintUrl: string, quoteId: string) => {
    await manager.subscription.awaitMintQuotePaid(mintUrl, quoteId);
    // Coco automatically updates the transaction state
  };

  const checkEcashStatus = async (mintUrl: string) => {
    const balances = await manager.wallet.getBalances();
    // Coco's proof watchers handle state updates automatically
  };
};
```

## Deprecated Functions

The following Redux functions are now deprecated:

- `updateTransaction()` - Use Coco's event system instead
- `memoizedGetTransactions()` - Use `usePaginatedHistory()` instead
- Manual transaction state management - Let Coco handle it automatically

## Next Steps

1. **Fix Type Mismatches**: Some components still have type mismatches between `HistoryEntry` and `TransactionBuilder`
2. **Update Remaining Components**: Migrate any remaining components that use the old system
3. **Remove Redux Transaction Code**: Clean up unused Redux transaction reducers and selectors
4. **Testing**: Test the new system with real transactions

## Example Component

See `components/coco/CocoTransactionExample.tsx` for a complete example of how to use the new system.

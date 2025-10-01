# Coco-Cashu Integration

This document describes the integration of the coco-cashu libraries into the Sovran app, replacing the complex Redux-based cashuClient.ts approach.

## Architecture Overview

The integration follows the coco-cashu best practices:

- **Manager-based architecture**: Single Manager instance orchestrates all Cashu operations
- **Repository pattern**: Data persistence through ExpoSqliteRepositories
- **React hooks**: Custom hooks wrap coco-cashu functionality for React Native
- **Event-driven**: Real-time updates through Coco's event system

## File Structure

```
helper/coco/
├── manager.ts           # Manager initialization and singleton
├── migration.ts         # Data migration from Redux to Coco
├── CocoProvider.tsx     # React provider for app integration
└── index.ts            # Exports

hooks/coco/
├── useCashuOperations.ts    # Core ecash send/receive operations
├── useLightningOperations.ts # Lightning invoice operations
├── useMintManagement.ts     # Mint management operations
└── index.ts                 # Exports

components/coco/
└── CocoTestComponent.tsx    # Example component showing usage
```

## Key Features

### 1. Manager Initialization

- Automatic database setup with ExpoSqliteRepositories
- Seed management using existing secure storage
- Event watchers for real-time updates

### 2. Data Migration

- Migrates existing Redux state to Coco repositories
- Handles mints, proofs, and counters migration
- Safe migration with error handling

### 3. Custom Hooks

#### useCashuOperations

```typescript
const { sendEcash, receiveEcash, isTokenSpendable } = useCashuOperations();
```

#### useLightningOperations

```typescript
const { requestLightningInvoice, payLightningInvoice } = useLightningOperations();
```

#### useMintManagement

```typescript
const { mints, addMint, getBalances } = useMintManagement();
```

## Usage Example

```typescript
import { useCashuOperations } from 'hooks/coco';

function MyComponent() {
  const { sendEcash, receiveEcash, isSending } = useCashuOperations();

  const handleSend = async () => {
    try {
      const token = await sendEcash('https://mint.example.com', 1000);
      console.log('Sent token:', token);
    } catch (error) {
      console.error('Send failed:', error);
    }
  };

  return (
    <TouchableOpacity onPress={handleSend} disabled={isSending}>
      <Text>{isSending ? 'Sending...' : 'Send 1000 sats'}</Text>
    </TouchableOpacity>
  );
}
```

## Migration Benefits

1. **Simplified Code**: Replaces 1562 lines of cashuClient.ts with clean hooks
2. **Better Error Handling**: Coco provides comprehensive error management
3. **Real-time Updates**: Event-driven architecture for live data
4. **Type Safety**: Full TypeScript support throughout
5. **Maintainability**: Follows established patterns and best practices

## Next Steps

1. **Phase 1**: ✅ Core architecture setup
2. **Phase 2**: Replace cashuClient usage in components
3. **Phase 3**: Remove Redux Cashu state management
4. **Phase 4**: Clean up old code and optimize

## Dependencies

- `coco-cashu-core`: Core Manager and APIs
- `coco-cashu-expo-sqlite`: SQLite persistence for React Native
- `coco-cashu-react`: React hooks and providers

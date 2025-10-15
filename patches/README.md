# Coco Cashu Core Patches

This directory contains patches for the `coco-cashu-core` package to make certain service properties public.

## Patch Details

**File**: `coco-cashu-core+1.0.0-rc10.patch` (37 lines)

**Purpose**: Makes the following service properties publicly accessible by adding getter methods:

- `CounterService.counterService` - Returns the CounterService instance
- `ProofService.counterService` - Returns the counterService property
- `ProofService.proofService` - Returns the ProofService instance  
- `MeltQuoteService.meltQuoteService` - Returns the MeltQuoteService instance

## How It Works

The patch adds getter methods to the service classes in the bundled JavaScript file (`node_modules/coco-cashu-core/dist/index.js`). This allows external code to access these properties that were previously private.

## Usage

The patch is automatically applied when you run `npm install` or `yarn install` due to the `postinstall` script in `package.json`.

To manually apply the patch:
```bash
npx patch-package
```

To create a new patch after modifying the library:
```bash
npx patch-package coco-cashu-core
```

## Original Issue

The TypeScript source code declares these properties as public, but the bundled JavaScript output doesn't expose them properly, making them inaccessible from external code.

## Files Modified

- `node_modules/coco-cashu-core/dist/index.js` - Main bundled file with getter methods added

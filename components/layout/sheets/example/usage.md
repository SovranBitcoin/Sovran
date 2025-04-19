# Creating a Sheet with Router

## Directory Structure

For each sheet, maintain the following structure:

```
/components/layout/sheets/[sheet-name]/
├── index.tsx                # Main sheet component
└── routes/
    ├── index.tsx            # Routes definition
    ├── routeA.tsx           # First route component
    ├── routeB.tsx           # Second route component
    └── ...                  # Additional route components
```

## Required Files

1. **Main Sheet Component**: `index.tsx` - Registers and configures the sheet
2. **Routes Definition**: `routes/index.tsx` - Defines available routes and types
3. **Route Components**: Individual components for each route in the sheet

# Step-by-Step Implementation

## Step 1: Define Routes

Create a `routes/index.tsx` file with the following structure:

```typescript
import {
  Route,
  SheetDefinition,
  RouteDefinition,
} from "react-native-actions-sheet";
import RouteA from "./routeA";
import RouteB from "./routeB";
// Import additional route components as needed

// Define a unique name for this sheet
export const sheetName = "your-sheet-name";

// Define all available routes for this sheet
export const routes: Route[] = [
  {
    name: "route-a",
    component: RouteA,
  },
  {
    name: "route-b",
    component: RouteB,
  },
  // Add more routes as needed
];

// Add TypeScript type definitions
declare module "react-native-actions-sheet" {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        "route-a": RouteDefinition;
        "route-b": RouteDefinition<{ data: string }>;  // Define parameters if needed
        // Define additional routes with their parameters
      };
    }>;
  }
}
```

## Step 2: Create Route Components

For each route, create a component file. Here's an example for `routeA.tsx`:

```typescript
import React from 'react';
import { View, Button } from 'react-native';
import { 
  RouteScreenProps, 
  useSheetRef, 
  useSheetRouteParams 
} from 'react-native-actions-sheet';

// Use the correct sheet name and route name in the type parameters
const RouteA = ({ router, payload }: RouteScreenProps<'your-sheet-name', 'route-a'>) => {
  // Access another sheet reference if needed
  const ref = useSheetRef('another-sheet-name');

  return (
    <View>
      <Button
        title="Navigate to Route B"
        onPress={() => {
          // Navigate to another route with optional parameters
          router.navigate('route-b', { data: 'some data' });
        }}
      />
      <Button
        title="Close Sheet with Data"
        onPress={() => {
          // Return data when hiding the sheet
          ref.current.hide({
            success: true,
            additionalData: 'any data you want to return'
          });
        }}
      />
    </View>
  );
};

export default RouteA;
```

For `routeB.tsx` with parameter handling:

```typescript
import React from 'react';
import { View, Button, Text } from 'react-native';
import { 
  useSheetRouter, 
  useSheetRouteParams 
} from 'react-native-actions-sheet';

const RouteB = ({ router }) => {
  // Get parameters passed from the previous route
  const params = useSheetRouteParams('your-sheet-name', 'route-b');
  
  // Always check if router exists to prevent runtime errors
  if (!router) {
    return null;
  }

  return (
    <View>
      <Text>Data from Route A: {JSON.stringify(params)}</Text>
      <Button
        title="Go Back"
        onPress={() => {
          router.goBack();
        }}
      />
    </View>
  );
};

export default RouteB;
```

## Step 3: Register the Sheet

Create the main sheet component in `index.tsx`:

```typescript
import React from "react";
import ActionSheet, { registerSheet } from "react-native-actions-sheet";
import { sheetName, routes } from "./routes";

function SheetWithRouter(props: any) {
  return (
    <ActionSheet
      // Enable back navigation with device back button
      enableRouterBackNavigation={true}
      // Pass the routes array defined in routes/index.tsx
      routes={routes}
      // Set the initial route to display
      initialRoute="route-a"
      // Configure styling as needed
      containerStyle={{ height: "90%" }}
      // Additional props as needed
      {...props}
    />
  );
}

// Register the sheet with its unique name
registerSheet(sheetName, SheetWithRouter);

// No need to export anything as the sheet is registered globally
```

## Step 4: Using the Sheet

To use the sheet in your application:

```typescript
import { SheetManager } from "react-native-actions-sheet";

// Inside your component:
const handleOpenSheet = () => {
  SheetManager.show('your-sheet-name', {
    // Handle data returned when sheet is closed
    onClose(data) {
      console.log('Sheet closed with data:', data);
      // Process returned data here
    },
    // Optional payload to pass to the initial route
    payload: {
      initialData: 'some value'
    }
  });
};
```

# Best Practices

1. **Naming Conventions**:
   - Use kebab-case for sheet and route names (`your-sheet-name`, `route-a`)
   - Use PascalCase for component names (`RouteA`, `SheetWithRouter`)

2. **Type Safety**:
   - Always define proper types in the `declare module` section
   - Use correct types for route parameters and return values

3. **Error Handling**:
   - Always check if `router` exists before using it
   - Implement fallbacks for missing parameters

4. **Structure**:
   - Keep route components focused on a single responsibility
   - Separate business logic from UI components

5. **Performance**:
   - Avoid heavy computations in route components
   - Use `React.memo` or similar optimizations for complex components

## Advanced Usage

### Passing Data Between Routes

Data can be passed between routes using the `navigate` method:

```typescript
// From route A to route B
router.navigate('route-b', { 
  data: 'value',
  complexObject: { key: 'value' }
});

// In route B, access the data
const params = useSheetRouteParams('your-sheet-name', 'route-b');
console.log(params.data); // 'value'
```

### Returning Data from Sheets

To return data when a sheet is closed:

```typescript
const ref = useSheetRef('your-sheet-name');

// Return data when closing
ref.current.hide({
  success: true,
  result: 'operation completed',
  data: { /* any data structure */ }
});

// In the component that opened the sheet
SheetManager.show('your-sheet-name', {
  onClose(data) {
    if (data && data.success) {
      // Process successful operation
      console.log(data.result);
    }
  }
});
```

### TypeScript Integration

For full TypeScript support, ensure you define the correct types:

```typescript
// In routes/index.tsx
declare module "react-native-actions-sheet" {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        "route-a": RouteDefinition<{}, { success: boolean, result: string }>;
        "route-b": RouteDefinition<{ data: string }>;
      };
    }>;
  }
}
```

This defines:
- Parameters for each route (after the route name in RouteDefinition)
- Return type for the entire sheet (the second generic parameter)

---

By following this documentation, you can create consistent and type-safe action sheets with routing capabilities in your React Native application. The structure provided ensures maintainability and scalability as your application grows.
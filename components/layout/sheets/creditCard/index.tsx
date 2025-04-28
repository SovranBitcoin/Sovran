import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { View, Text } from 'react-native';

function CreditCardSheet(props: any) {
  return (
    <ActionSheet
      // Enable back navigation with device back button
      enableRouterBackNavigation={true}
      // Pass the routes array defined in routes/index.tsx
      routes={routes}
      // Set the initial route to display
      initialRoute="main"
      // Configure styling - 50% height as requested
      containerStyle={{ height: '50%' }}
      // Additional props as needed
      {...props}
    />
  );
}

// Register the sheet with its unique name
registerSheet(sheetName, CreditCardSheet);

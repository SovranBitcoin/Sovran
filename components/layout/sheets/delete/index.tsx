import React from "react";
import ActionSheet, { registerSheet } from "react-native-actions-sheet";
import { sheetName, routes } from "./routes";
import { greys } from "helper/colors";
import { memoizedGetTheme } from "helper/redux/settings";
import { useSelector } from "react-redux";

function SheetWithRouter(props: any) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        backgroundColor: greys(theme)[1800],
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: "auto",
      }}
    />
  );
}

registerSheet(sheetName, SheetWithRouter);

import {
  Route,
  SheetDefinition,
  RouteDefinition,
} from "react-native-actions-sheet";
import RouteA from "./routeA";
import RouteB from "./routeB";

export const sheetName = "delete-router";

export const routes: Route[] = [
  {
    name: "route-a",
    component: RouteA,
  },
  {
    name: "route-b",
    component: RouteB,
  },
];

declare module "react-native-actions-sheet" {
  interface Sheets {
    [sheetName]: SheetDefinition<{
      routes: {
        "route-a": RouteDefinition;
        "route-b": RouteDefinition<{ data: string }>;
      };
    }>;
  }
}

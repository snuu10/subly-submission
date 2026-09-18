import { createContext, useContext, type ReactNode } from 'react';

const DashboardDragHandleContext = createContext<ReactNode>(null);
const DashboardWidgetMenuContext = createContext<ReactNode>(null);

export const DashboardDragHandleProvider = DashboardDragHandleContext.Provider;
export const DashboardWidgetMenuProvider = DashboardWidgetMenuContext.Provider;

export function useDashboardDragHandle(): ReactNode {
  return useContext(DashboardDragHandleContext);
}

export function useDashboardWidgetMenu(): ReactNode {
  return useContext(DashboardWidgetMenuContext);
}

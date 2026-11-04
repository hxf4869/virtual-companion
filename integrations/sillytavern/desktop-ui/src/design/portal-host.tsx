import React, { createContext, useContext, useMemo } from 'react';

export type PortalContainer =
  | HTMLElement
  | React.RefObject<HTMLElement | null>
  | null
  | undefined;

export interface PortalHostContextValue {
  /** Root container for top-level Base UI portals (undefined inside nested portals so Base UI uses parentPortalNode) */
  container?: PortalContainer;
  /** Dedicated host container for Toast viewport aligned with the main panel area */
  toastContainer?: PortalContainer;
}

const PortalHostContext = createContext<PortalHostContextValue>({});

export interface PortalHostProviderProps {
  container?: PortalContainer;
  toastContainer?: PortalContainer;
  children: React.ReactNode;
}

export function PortalHostProvider({
  container,
  toastContainer,
  children,
}: PortalHostProviderProps) {
  const value = useMemo<PortalHostContextValue>(
    () => ({
      container,
      toastContainer: toastContainer ?? container,
    }),
    [container, toastContainer],
  );
  return <PortalHostContext.Provider value={value}>{children}</PortalHostContext.Provider>;
}

/**
 * Clears the explicit root container for descendants inside a rendered Portal popup,
 * allowing nested Base UI Portals (e.g. Select/Menu/Popover inside Dialog) to pass
 * `container={undefined}` so Base UI's `FloatingPortal` automatically attaches to
 * `parentPortalNode` and preserves parent-child DOM hierarchy and focus scope.
 */
export function PortalNestedScope({ children }: { children: React.ReactNode }) {
  const parent = useContext(PortalHostContext);
  const value = useMemo<PortalHostContextValue>(
    () => ({
      container: undefined,
      toastContainer: parent.toastContainer,
    }),
    [parent.toastContainer],
  );
  return <PortalHostContext.Provider value={value}>{children}</PortalHostContext.Provider>;
}

export function usePortalContainer(): PortalContainer {
  return useContext(PortalHostContext).container;
}

export function useToastPortalContainer(): PortalContainer {
  return useContext(PortalHostContext).toastContainer;
}

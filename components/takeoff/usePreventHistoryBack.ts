'use client';

import { useEffect } from 'react';

export function usePreventHistoryBack(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const root = document.documentElement;
    const body = document.body;
    const prevRootOverscrollX = root.style.overscrollBehaviorX;
    const prevRootOverscrollY = root.style.overscrollBehaviorY;
    const prevRootOverflow = root.style.overflow;
    const prevRootOverflowX = root.style.overflowX;
    const prevRootOverflowY = root.style.overflowY;
    const prevBodyOverscrollX = body.style.overscrollBehaviorX;
    const prevBodyOverscrollY = body.style.overscrollBehaviorY;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverflowX = body.style.overflowX;
    const prevBodyOverflowY = body.style.overflowY;

    root.style.overscrollBehaviorX = 'none';
    root.style.overscrollBehaviorY = 'none';
    root.style.overflow = 'hidden';
    root.style.overflowX = 'hidden';
    root.style.overflowY = 'hidden';
    body.style.overscrollBehaviorX = 'none';
    body.style.overscrollBehaviorY = 'none';
    body.style.overflow = 'hidden';
    body.style.overflowX = 'hidden';
    body.style.overflowY = 'hidden';

    const guardState = {
      ...(window.history.state ?? {}),
      __takeoffHistoryGuard: true,
    };

    window.history.replaceState(guardState, '', window.location.href);
    window.history.pushState(
      {
        ...guardState,
        __takeoffHistorySentinel: Date.now(),
      },
      '',
      window.location.href,
    );

    const handlePopState = () => {
      window.dispatchEvent(
        new CustomEvent('takeoff-gesture-debug', {
          detail: {
            timestamp: Date.now(),
            source: 'history',
            action: 'popstate-blocked',
            href: window.location.href,
          },
        }),
      );
      window.history.go(1);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      root.style.overscrollBehaviorX = prevRootOverscrollX;
      root.style.overscrollBehaviorY = prevRootOverscrollY;
      root.style.overflow = prevRootOverflow;
      root.style.overflowX = prevRootOverflowX;
      root.style.overflowY = prevRootOverflowY;
      body.style.overscrollBehaviorX = prevBodyOverscrollX;
      body.style.overscrollBehaviorY = prevBodyOverscrollY;
      body.style.overflow = prevBodyOverflow;
      body.style.overflowX = prevBodyOverflowX;
      body.style.overflowY = prevBodyOverflowY;
      window.removeEventListener('popstate', handlePopState);
    };
  }, [enabled]);
}

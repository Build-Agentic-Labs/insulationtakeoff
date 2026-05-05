'use client';

import { useEffect } from 'react';

interface UseBlueprintPageHotkeysOptions {
  activePageIndex: number;
  selectedPages: number[];
  setActivePage: (pageIndex: number) => void;
  disabled?: boolean;
  onBeforeNavigate?: () => void;
}

export function useBlueprintPageHotkeys({
  activePageIndex,
  selectedPages,
  setActivePage,
  disabled = false,
  onBeforeNavigate,
}: UseBlueprintPageHotkeysOptions) {
  useEffect(() => {
    if (selectedPages.length < 2 || disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      const currentPagePosition = selectedPages.indexOf(activePageIndex);
      if (currentPagePosition === -1) return;

      const nextPagePosition =
        event.key === 'ArrowLeft'
          ? Math.max(0, currentPagePosition - 1)
          : Math.min(selectedPages.length - 1, currentPagePosition + 1);

      if (nextPagePosition === currentPagePosition) return;

      event.preventDefault();
      onBeforeNavigate?.();
      setActivePage(selectedPages[nextPagePosition]);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePageIndex, disabled, onBeforeNavigate, selectedPages, setActivePage]);
}

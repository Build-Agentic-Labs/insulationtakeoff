import { create } from 'zustand';
import type {
  TakeoffSession,
  TakeoffRegion,
  RegionStatus,
  VisionRegionSuggestion,
  RegionAnalysisResult,
  PageScore,
  BBox,
  WallType,
} from '@/lib/types/takeoff';

interface TakeoffState {
  // Session
  session: TakeoffSession | null;
  currentStep: 'page-selection' | 'workspace' | 'summary';

  // Page selection
  pageScores: PageScore[];
  selectedPages: number[];
  previewPageIndex: number;

  // Workspace
  activePageIndex: number;
  activeRegionId: string | null;
  modalRegionId: string | null;
  isDrawing: boolean;
  tool: 'pointer' | 'rectangle';

  // Vision cache
  visionCache: Record<number, VisionRegionSuggestion[]>;
  visionLoading: Record<number, boolean>;

  // Actions — session
  setSession: (session: TakeoffSession) => void;
  setStep: (step: TakeoffState['currentStep']) => void;

  // Actions — page selection
  setPageScores: (scores: PageScore[]) => void;
  togglePage: (pageIndex: number) => void;
  setPreviewPage: (pageIndex: number) => void;
  confirmPageSelection: () => void;

  // Actions — workspace
  setActivePage: (pageIndex: number) => void;
  setTool: (tool: 'pointer' | 'rectangle') => void;
  setDrawing: (drawing: boolean) => void;

  // Actions — regions
  addRegion: (region: TakeoffRegion) => void;
  updateRegionStatus: (regionId: string, status: RegionStatus) => void;
  confirmRegion: (regionId: string, data: {
    wall_length_lf: number;
    wall_height_ft: number;
    gross_sf: number;
    net_sf: number;
    openings: TakeoffRegion['openings'];
  }) => void;
  rejectRegion: (regionId: string) => void;
  openModal: (regionId: string) => void;
  closeModal: () => void;

  // Actions — vision
  setVisionResults: (pageIndex: number, regions: VisionRegionSuggestion[]) => void;
  setVisionLoading: (pageIndex: number, loading: boolean) => void;

  // Computed
  getRegionsForPage: (pageIndex: number) => TakeoffRegion[];
  getConfirmedRegions: () => TakeoffRegion[];
  getRunningTotal: () => { gross_sf: number; net_sf: number; region_count: number; confirmed_count: number };
}

export const useTakeoffStore = create<TakeoffState>((set, get) => ({
  session: null,
  currentStep: 'page-selection',
  pageScores: [],
  selectedPages: [],
  previewPageIndex: 0,
  activePageIndex: 0,
  activeRegionId: null,
  modalRegionId: null,
  isDrawing: false,
  tool: 'pointer',
  visionCache: {},
  visionLoading: {},

  setSession: (session) => set({ session }),
  setStep: (step) => set({ currentStep: step }),

  setPageScores: (scores) => set({
    pageScores: scores,
    selectedPages: scores.filter((s) => s.ai_selected).map((s) => s.page_index),
    previewPageIndex: scores.find((s) => s.ai_selected)?.page_index ?? 0,
  }),

  togglePage: (pageIndex) => set((state) => {
    const selected = state.selectedPages.includes(pageIndex)
      ? state.selectedPages.filter((p) => p !== pageIndex)
      : [...state.selectedPages, pageIndex].sort((a, b) => a - b);
    return { selectedPages: selected };
  }),

  setPreviewPage: (pageIndex) => set({ previewPageIndex: pageIndex }),

  confirmPageSelection: () => set((state) => ({
    currentStep: 'workspace',
    activePageIndex: state.selectedPages[0] ?? 0,
  })),

  setActivePage: (pageIndex) => set({ activePageIndex: pageIndex }),
  setTool: (tool) => set({ tool }),
  setDrawing: (drawing) => set({ isDrawing: drawing }),

  addRegion: (region) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: [...state.session.regions, region],
      },
    };
  }),

  updateRegionStatus: (regionId, status) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: state.session.regions.map((r) =>
          r.id === regionId ? { ...r, status } : r
        ),
      },
    };
  }),

  confirmRegion: (regionId, data) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: state.session.regions.map((r) =>
          r.id === regionId
            ? {
                ...r,
                status: 'confirmed' as const,
                wall_length_lf: data.wall_length_lf,
                wall_height_ft: data.wall_height_ft,
                gross_sf: data.gross_sf,
                net_sf: data.net_sf,
                openings: data.openings,
                confirmed_at: new Date().toISOString(),
              }
            : r
        ),
      },
      modalRegionId: null,
    };
  }),

  rejectRegion: (regionId) => set((state) => {
    if (!state.session) return state;
    return {
      session: {
        ...state.session,
        regions: state.session.regions.map((r) =>
          r.id === regionId ? { ...r, status: 'rejected' as const } : r
        ),
      },
      modalRegionId: null,
    };
  }),

  openModal: (regionId) => set({ modalRegionId: regionId }),
  closeModal: () => set({ modalRegionId: null }),

  setVisionResults: (pageIndex, regions) => set((state) => ({
    visionCache: { ...state.visionCache, [pageIndex]: regions },
    visionLoading: { ...state.visionLoading, [pageIndex]: false },
  })),

  setVisionLoading: (pageIndex, loading) => set((state) => ({
    visionLoading: { ...state.visionLoading, [pageIndex]: loading },
  })),

  getRegionsForPage: (pageIndex) => {
    const session = get().session;
    if (!session) return [];
    return session.regions.filter((r) => r.page_index === pageIndex && r.status !== 'rejected');
  },

  getConfirmedRegions: () => {
    const session = get().session;
    if (!session) return [];
    return session.regions.filter((r) => r.status === 'confirmed');
  },

  getRunningTotal: () => {
    const confirmed = get().getConfirmedRegions();
    return {
      gross_sf: confirmed.reduce((sum, r) => sum + (r.gross_sf ?? 0), 0),
      net_sf: confirmed.reduce((sum, r) => sum + (r.net_sf ?? 0), 0),
      region_count: get().session?.regions.filter((r) => r.status !== 'rejected').length ?? 0,
      confirmed_count: confirmed.length,
    };
  },
}));

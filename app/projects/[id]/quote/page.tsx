"use client";

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatSqft } from '@/lib/calculations/pricing';
import { FileText, Download, Loader2, AlertCircle, Settings, Plus, Trash2, Check } from 'lucide-react';

// ─── Interfaces ─────────────────────────────────────────────

interface Room {
  id: string;
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
}

interface InsulationProduct {
  id: string;
  name: string;
  type: 'batt' | 'blown_in';
  rValue: number;
  pricePerSqft: number;
  thickness: string;
  description: string;
  applicableAreas: string[];
}

interface InsulationArea {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rValue: number | null;
  sqft: number;
  pricePerSqft: number;
  isCustom?: boolean;
  selectedProductId?: string | null;
}

// ─── Product Catalog ────────────────────────────────────────

const INSULATION_CATALOG: InsulationProduct[] = [
  // Batt products
  {
    id: 'batt-r13',
    name: 'R-13 Batt',
    type: 'batt',
    rValue: 13,
    pricePerSqft: 0.90,
    thickness: '3.5"',
    description: 'Fiberglass batt for 2×4 walls',
    applicableAreas: ['exterior_walls', 'garage_walls'],
  },
  {
    id: 'batt-r15',
    name: 'R-15 Batt',
    type: 'batt',
    rValue: 15,
    pricePerSqft: 1.10,
    thickness: '3.5"',
    description: 'Mineral wool batt for 2×4 walls',
    applicableAreas: ['exterior_walls', 'garage_walls'],
  },
  {
    id: 'batt-r19',
    name: 'R-19 Batt',
    type: 'batt',
    rValue: 19,
    pricePerSqft: 1.30,
    thickness: '6.25"',
    description: 'Fiberglass batt for 2×6 walls & floors',
    applicableAreas: ['exterior_walls', 'garage_walls', 'crawlspace_floor'],
  },
  {
    id: 'batt-r21',
    name: 'R-21 Batt',
    type: 'batt',
    rValue: 21,
    pricePerSqft: 1.50,
    thickness: '5.5"',
    description: 'High-density batt for 2×6 walls',
    applicableAreas: ['exterior_walls', 'garage_walls'],
  },
  // Blown-in products
  {
    id: 'blown-r30',
    name: 'R-30 Blown-In',
    type: 'blown_in',
    rValue: 30,
    pricePerSqft: 1.25,
    thickness: '10–11"',
    description: 'Blown fiberglass/cellulose for attics',
    applicableAreas: ['attic_ceiling', 'crawlspace_floor'],
  },
  {
    id: 'blown-r38',
    name: 'R-38 Blown-In',
    type: 'blown_in',
    rValue: 38,
    pricePerSqft: 1.50,
    thickness: '13–14"',
    description: 'Blown fiberglass/cellulose for attics',
    applicableAreas: ['attic_ceiling'],
  },
  {
    id: 'blown-r49',
    name: 'R-49 Blown-In',
    type: 'blown_in',
    rValue: 49,
    pricePerSqft: 1.85,
    thickness: '17–18"',
    description: 'Blown insulation for cold climate attics',
    applicableAreas: ['attic_ceiling'],
  },
  {
    id: 'blown-r60',
    name: 'R-60 Blown-In',
    type: 'blown_in',
    rValue: 60,
    pricePerSqft: 2.20,
    thickness: '20–22"',
    description: 'Maximum attic coverage',
    applicableAreas: ['attic_ceiling'],
  },
];

interface GlobalPricing {
  wall_per_sqft: number;
  attic_per_sqft: number;
  garage_wall_per_sqft: number;
  floor_per_sqft: number;
}

const DEFAULT_PRICING: GlobalPricing = {
  wall_per_sqft: 1.50,
  attic_per_sqft: 1.25,
  garage_wall_per_sqft: 1.75,
  floor_per_sqft: 2.00,
};

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<any>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [globalPricing, setGlobalPricing] = useState<GlobalPricing>(DEFAULT_PRICING);
  const [quote, setQuote] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-project insulation areas configuration
  const [insulationAreas, setInsulationAreas] = useState<InsulationArea[]>([]);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      // Load project
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      setProject(projectData);

      // Load rooms
      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .eq('project_id', id);

      const loadedRooms = roomsData || [];
      setRooms(loadedRooms);

      // Load global pricing settings
      const { data: pricingData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pricing')
        .single();

      const pricing = (pricingData?.value || DEFAULT_PRICING) as GlobalPricing;
      setGlobalPricing(pricing);

      // Calculate available areas based on extracted data
      initializeInsulationAreas(loadedRooms, pricing);

      // Load existing quote
      const { data: quoteData } = await supabase
        .from('quotes')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (quoteData) {
        setQuote(quoteData);
        // Restore configuration from existing quote
        if (quoteData.line_items && Array.isArray(quoteData.line_items)) {
          restoreFromQuote(quoteData.line_items, loadedRooms, pricing);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const initializeInsulationAreas = (loadedRooms: Room[], pricing: GlobalPricing) => {
    const areas: InsulationArea[] = [];

    // Calculate living area totals
    const livingRooms = loadedRooms.filter((r) => r.type === 'living');
    const totalLivingArea = livingRooms.reduce((sum, r) => sum + (r.area_sqft || 0), 0);

    // Calculate wall area if we have perimeter data
    let livingWallArea = 0;
    for (const room of livingRooms) {
      if (room.perimeter_ft && room.height_ft) {
        livingWallArea += room.perimeter_ft * room.height_ft;
      }
    }

    // Attic/Ceiling - use attic rooms or fall back to living area
    const atticRooms = loadedRooms.filter((r) => r.type === 'attic');
    const totalAtticArea = atticRooms.reduce((sum, r) => sum + (r.area_sqft || 0), 0);
    const ceilingArea = totalAtticArea > 0 ? totalAtticArea : totalLivingArea;

    if (ceilingArea > 0) {
      areas.push({
        id: 'attic_ceiling',
        name: 'Attic/Ceiling Insulation',
        description: `${formatSqft(ceilingArea)} sq ft of ceiling area`,
        enabled: true,
        rValue: null,
        sqft: ceilingArea,
        pricePerSqft: pricing.attic_per_sqft,
      });
    }

    // Exterior Walls
    if (livingWallArea > 0) {
      areas.push({
        id: 'exterior_walls',
        name: 'Exterior Walls',
        description: `${formatSqft(livingWallArea)} sq ft of wall area`,
        enabled: true,
        rValue: null,
        sqft: livingWallArea,
        pricePerSqft: pricing.wall_per_sqft,
      });
    } else if (totalLivingArea > 0) {
      // Estimate wall area: assume 9ft ceiling and sqrt(area)*4 for perimeter
      const estimatedPerimeter = Math.sqrt(totalLivingArea) * 4;
      const estimatedWallArea = estimatedPerimeter * 9;
      areas.push({
        id: 'exterior_walls',
        name: 'Exterior Walls (Estimated)',
        description: `~${formatSqft(Math.round(estimatedWallArea))} sq ft estimated wall area`,
        enabled: false,
        rValue: null,
        sqft: Math.round(estimatedWallArea),
        pricePerSqft: pricing.wall_per_sqft,
      });
    }

    // Garage Walls
    const garageRooms = loadedRooms.filter((r) => r.type === 'garage');
    const totalGarageArea = garageRooms.reduce((sum, r) => sum + (r.area_sqft || 0), 0);

    let garageWallArea = 0;
    for (const room of garageRooms) {
      if (room.perimeter_ft && room.height_ft) {
        garageWallArea += room.perimeter_ft * room.height_ft;
      }
    }

    if (garageWallArea > 0) {
      areas.push({
        id: 'garage_walls',
        name: 'Garage Walls',
        description: `${formatSqft(garageWallArea)} sq ft of garage wall area`,
        enabled: false,
        rValue: null,
        sqft: garageWallArea,
        pricePerSqft: pricing.garage_wall_per_sqft,
      });
    } else if (totalGarageArea > 0) {
      // Estimate: assume 10ft ceiling and sqrt(area)*4 for perimeter
      const estimatedPerimeter = Math.sqrt(totalGarageArea) * 4;
      const estimatedWallArea = estimatedPerimeter * 10;
      areas.push({
        id: 'garage_walls',
        name: 'Garage Walls (Estimated)',
        description: `~${formatSqft(Math.round(estimatedWallArea))} sq ft estimated`,
        enabled: false,
        rValue: null,
        sqft: Math.round(estimatedWallArea),
        pricePerSqft: pricing.garage_wall_per_sqft,
      });
    }

    // Crawlspace/Floor
    const crawlspaceRooms = loadedRooms.filter((r) => r.type === 'crawlspace');
    const totalCrawlspaceArea = crawlspaceRooms.reduce((sum, r) => sum + (r.area_sqft || 0), 0);

    if (totalCrawlspaceArea > 0) {
      areas.push({
        id: 'crawlspace_floor',
        name: 'Crawlspace/Floor Insulation',
        description: `${formatSqft(totalCrawlspaceArea)} sq ft of floor area`,
        enabled: false,
        rValue: null,
        sqft: totalCrawlspaceArea,
        pricePerSqft: pricing.floor_per_sqft,
      });
    } else if (totalLivingArea > 0) {
      // Option to add floor insulation based on living area
      areas.push({
        id: 'crawlspace_floor',
        name: 'Floor Insulation',
        description: `${formatSqft(totalLivingArea)} sq ft (based on living area)`,
        enabled: false,
        rValue: null,
        sqft: totalLivingArea,
        pricePerSqft: pricing.floor_per_sqft,
      });
    }

    setInsulationAreas(areas);
  };

  const restoreFromQuote = (lineItems: any[], loadedRooms: Room[], pricing: GlobalPricing) => {
    // First initialize with current room data
    initializeInsulationAreas(loadedRooms, pricing);

    // Then update with saved quote values
    setInsulationAreas(prev => {
      const updatedAreas = prev.map(area => {
        const savedItem = lineItems.find((item: any) => item.id === area.id);
        if (savedItem) {
          // Try to match a product by R-value and price
          const matchedProduct = INSULATION_CATALOG.find(
            p => p.applicableAreas.includes(area.id) &&
                 p.rValue === savedItem.rValue &&
                 p.pricePerSqft === savedItem.pricePerSqft
          );
          return {
            ...area,
            enabled: true,
            rValue: savedItem.rValue,
            sqft: savedItem.sqft || area.sqft,
            pricePerSqft: savedItem.pricePerSqft ?? area.pricePerSqft,
            selectedProductId: savedItem.selectedProductId || matchedProduct?.id || null,
          };
        }
        return area;
      });

      // Add any custom items from the saved quote
      const customItems = lineItems.filter((item: any) => item.isCustom);
      const customAreas: InsulationArea[] = customItems.map((item: any) => ({
        id: item.id,
        name: item.area || item.name,
        description: 'Custom line item',
        enabled: true,
        rValue: item.rValue,
        sqft: item.sqft,
        pricePerSqft: item.pricePerSqft,
        isCustom: true,
      }));

      return [...updatedAreas, ...customAreas];
    });
  };

  const toggleArea = (areaId: string) => {
    setInsulationAreas(prev =>
      prev.map(area =>
        area.id === areaId ? { ...area, enabled: !area.enabled } : area
      )
    );
  };

  const updateRValue = (areaId: string, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setInsulationAreas(prev =>
      prev.map(area =>
        area.id === areaId ? { ...area, rValue: numValue } : area
      )
    );
  };

  const updateSqft = (areaId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setInsulationAreas(prev =>
      prev.map(area =>
        area.id === areaId ? { ...area, sqft: numValue } : area
      )
    );
  };

  const updateName = (areaId: string, value: string) => {
    setInsulationAreas(prev =>
      prev.map(area =>
        area.id === areaId ? { ...area, name: value } : area
      )
    );
  };

  const updatePricePerSqft = (areaId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setInsulationAreas(prev =>
      prev.map(area =>
        area.id === areaId ? { ...area, pricePerSqft: numValue } : area
      )
    );
  };

  const selectProduct = (areaId: string, productId: string) => {
    const product = INSULATION_CATALOG.find(p => p.id === productId);
    if (!product) return;
    setInsulationAreas(prev =>
      prev.map(area =>
        area.id === areaId
          ? {
              ...area,
              selectedProductId: area.selectedProductId === productId ? null : productId,
              rValue: area.selectedProductId === productId ? null : product.rValue,
              pricePerSqft: area.selectedProductId === productId ? area.pricePerSqft : product.pricePerSqft,
            }
          : area
      )
    );
  };

  const getApplicableProducts = (areaId: string): InsulationProduct[] => {
    return INSULATION_CATALOG.filter(p => p.applicableAreas.includes(areaId));
  };

  const addCustomLineItem = () => {
    const newItem: InsulationArea = {
      id: `custom_${Date.now()}`,
      name: '',
      description: 'Custom line item',
      enabled: true,
      rValue: null,
      sqft: 0,
      pricePerSqft: 1.50,
      isCustom: true,
    };
    setInsulationAreas(prev => [...prev, newItem]);
  };

  const removeCustomLineItem = (areaId: string) => {
    setInsulationAreas(prev => prev.filter(area => area.id !== areaId));
  };

  const getEnabledAreas = () => insulationAreas.filter(a => a.enabled);

  const getValidationErrors = () => {
    const errors: string[] = [];
    const enabledAreas = getEnabledAreas();

    for (const area of enabledAreas) {
      if (!area.name || area.name.trim() === '') {
        errors.push(`Line item name is required`);
      }
      if (area.rValue === null || area.rValue <= 0) {
        errors.push(`${area.name || 'Unnamed item'}: R-value is required`);
      }
      if (area.sqft <= 0) {
        errors.push(`${area.name || 'Unnamed item'}: Square footage must be greater than 0`);
      }
    }

    if (enabledAreas.length === 0) {
      errors.push('Please select at least one insulation area');
    }

    return errors;
  };

  const calculateTotal = () => {
    const enabledAreas = getEnabledAreas();
    const totalCost = enabledAreas.reduce((sum, area) => sum + (area.sqft * area.pricePerSqft), 0);
    const totalSqft = enabledAreas.reduce((sum, area) => sum + area.sqft, 0);
    return { totalCost, totalSqft };
  };

  const handleGenerateQuote = async () => {
    const errors = getValidationErrors();
    if (errors.length > 0) {
      setError(errors.join(', '));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const enabledAreas = getEnabledAreas();
      const lineItems = enabledAreas.map(area => ({
        id: area.id,
        area: area.name,
        sqft: area.sqft,
        rValue: area.rValue,
        pricePerSqft: area.pricePerSqft,
        totalCost: area.sqft * area.pricePerSqft,
        isCustom: area.isCustom || false,
        selectedProductId: area.selectedProductId || null,
      }));

      const { totalCost } = calculateTotal();

      const response = await fetch('/api/quote/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: id,
          lineItems,
          totalCost,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate quote');
      }

      setQuote(data.quote);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate quote');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const validationErrors = getValidationErrors();
  const { totalCost, totalSqft } = calculateTotal();
  const enabledAreas = getEnabledAreas();
  const standardAreas = insulationAreas.filter(a => !a.isCustom);
  const customAreas = insulationAreas.filter(a => a.isCustom);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">{project?.name}</h1>
            <p className="text-muted-foreground">Configure and Generate Quote</p>
          </div>
          <Link href={`/projects/${id}/review`}>
            <Button variant="outline">Back to Review</Button>
          </Link>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left Column - Configuration */}
          <div className="lg:col-span-3 space-y-6">
            {/* Standard Insulation Areas */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Select Insulation Areas
                </CardTitle>
                <CardDescription>
                  Choose which areas to include and set R-values for each
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {standardAreas.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No areas available. Please ensure measurements are extracted first.
                  </p>
                ) : (
                  standardAreas.map((area) => (
                    <div
                      key={area.id}
                      className={`rounded-lg p-4 transition-all duration-200 ${
                        area.enabled
                          ? 'border-l-4 border-l-primary border border-zinc-200 dark:border-zinc-700 shadow-sm'
                          : 'bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <input
                          type="checkbox"
                          id={area.id}
                          checked={area.enabled}
                          onChange={() => toggleArea(area.id)}
                          className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="flex-1 space-y-3">
                          <div>
                            <Label htmlFor={area.id} className="text-base font-medium cursor-pointer">
                              {area.name}
                            </Label>
                            <p className="text-sm text-muted-foreground">{area.description}</p>
                          </div>

                          {area.enabled && (
                            <div className="space-y-3 pt-2">
                              {/* Product Card Picker */}
                              {getApplicableProducts(area.id).length > 0 && (
                                <div>
                                  <Label className="text-sm text-muted-foreground mb-2 block">
                                    Select Product
                                  </Label>
                                  <div className="grid grid-cols-2 gap-2">
                                    {getApplicableProducts(area.id).map((product) => {
                                      const isSelected = area.selectedProductId === product.id;
                                      return (
                                        <button
                                          key={product.id}
                                          onClick={() => selectProduct(area.id, product.id)}
                                          className={`relative text-left rounded-lg border-2 p-3 transition-all duration-150 ${
                                            isSelected
                                              ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-sm'
                                              : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                                          }`}
                                        >
                                          {isSelected && (
                                            <div className="absolute top-2 right-2">
                                              <Check className="h-4 w-4 text-primary" />
                                            </div>
                                          )}
                                          <div className="flex items-baseline gap-2">
                                            <span className="text-lg font-bold text-zinc-900 dark:text-white">
                                              R-{product.rValue}
                                            </span>
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                                              product.type === 'batt'
                                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                                : 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400'
                                            }`}>
                                              {product.type === 'batt' ? 'Batt' : 'Blown-In'}
                                            </span>
                                          </div>
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {product.thickness} — {product.description}
                                          </p>
                                          <p className="text-sm font-semibold mt-1.5 text-zinc-700 dark:text-zinc-300">
                                            ${product.pricePerSqft.toFixed(2)}/sf
                                          </p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* R-Value / SqFt / Price override inputs */}
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <Label htmlFor={`${area.id}-rvalue`} className="text-sm">
                                    R-Value
                                  </Label>
                                  <Input
                                    id={`${area.id}-rvalue`}
                                    type="number"
                                    min="0"
                                    step="1"
                                    placeholder="e.g., 38"
                                    value={area.rValue ?? ''}
                                    onChange={(e) => updateRValue(area.id, e.target.value)}
                                    className="mt-1"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor={`${area.id}-sqft`} className="text-sm">
                                    Square Feet
                                  </Label>
                                  <Input
                                    id={`${area.id}-sqft`}
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={area.sqft}
                                    onChange={(e) => updateSqft(area.id, e.target.value)}
                                    className="mt-1"
                                  />
                                </div>
                                <div>
                                  <Label htmlFor={`${area.id}-price`} className="text-sm">
                                    $/Sq Ft
                                  </Label>
                                  <Input
                                    id={`${area.id}-price`}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={area.pricePerSqft}
                                    onChange={(e) => updatePricePerSqft(area.id, e.target.value)}
                                    className="mt-1"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Custom Line Items */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Custom Line Items
                  </span>
                  <Button onClick={addCustomLineItem} size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Item
                  </Button>
                </CardTitle>
                <CardDescription>
                  Add additional items not extracted from the PDF
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {customAreas.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No custom items added. Click "Add Item" to add one.
                  </p>
                ) : (
                  customAreas.map((area) => (
                    <div
                      key={area.id}
                      className="border-l-4 border-l-emerald-500 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 shadow-sm"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`${area.id}-name`} className="text-sm font-medium">
                            Item Name
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeCustomLineItem(area.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Input
                          id={`${area.id}-name`}
                          type="text"
                          placeholder="e.g., Bonus Room Walls"
                          value={area.name}
                          onChange={(e) => updateName(area.id, e.target.value)}
                        />
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor={`${area.id}-rvalue`} className="text-sm">
                              R-Value
                            </Label>
                            <Input
                              id={`${area.id}-rvalue`}
                              type="number"
                              min="0"
                              step="1"
                              placeholder="e.g., 38"
                              value={area.rValue ?? ''}
                              onChange={(e) => updateRValue(area.id, e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${area.id}-sqft`} className="text-sm">
                              Square Feet
                            </Label>
                            <Input
                              id={`${area.id}-sqft`}
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              value={area.sqft || ''}
                              onChange={(e) => updateSqft(area.id, e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${area.id}-price`} className="text-sm">
                              $/Sq Ft
                            </Label>
                            <Input
                              id={`${area.id}-price`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={area.pricePerSqft}
                              onChange={(e) => updatePricePerSqft(area.id, e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Link to global pricing settings */}
            <div className="text-center">
              <Link href="/settings" className="text-sm text-muted-foreground hover:text-primary">
                Configure global pricing rates →
              </Link>
            </div>
          </div>

          {/* Right Column - Sticky Quote Preview */}
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-4">
              <Card>
                <CardHeader>
                  <CardTitle>Quote Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  {validationErrors.length > 0 && (
                    <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 rounded-md">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-yellow-900 dark:text-yellow-100 text-sm">
                            Please fix:
                          </p>
                          <ul className="text-xs text-yellow-800 dark:text-yellow-200 mt-1 space-y-1">
                            {validationErrors.slice(0, 3).map((error, index) => (
                              <li key={index}>• {error}</li>
                            ))}
                            {validationErrors.length > 3 && (
                              <li>• +{validationErrors.length - 3} more...</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {enabledAreas.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      Select areas to see preview
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b">
                            <tr className="text-left">
                              <th className="pb-2">Area</th>
                              <th className="pb-2 text-right">Sq Ft</th>
                              <th className="pb-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {enabledAreas.map((area, index) => (
                              <tr
                                key={area.id}
                                className={index % 2 === 0 ? 'bg-muted/50' : ''}
                              >
                                <td className="py-2">
                                  <div>
                                    <span className="font-medium">{area.name || 'Unnamed'}</span>
                                    {area.rValue && (
                                      <span className="text-xs text-muted-foreground ml-1">
                                        R-{area.rValue}
                                      </span>
                                    )}
                                    {area.selectedProductId && (
                                      <div className="text-[11px] text-muted-foreground">
                                        {INSULATION_CATALOG.find(p => p.id === area.selectedProductId)?.name}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 text-right">{formatSqft(area.sqft)}</td>
                                <td className="py-2 text-right font-medium">
                                  {formatCurrency(area.sqft * area.pricePerSqft)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t-2">
                            <tr>
                              <td className="pt-3 font-bold">Total</td>
                              <td className="pt-3 text-right text-muted-foreground">
                                {formatSqft(totalSqft)} sqft
                              </td>
                              <td className="pt-3 text-right font-bold text-lg">
                                {formatCurrency(totalCost)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      <div className="mt-6 space-y-3">
                        <Button
                          onClick={handleGenerateQuote}
                          disabled={isGenerating || validationErrors.length > 0}
                          className="w-full"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <FileText className="mr-2 h-4 w-4" />
                              {quote ? 'Regenerate Quote' : 'Generate Quote'}
                            </>
                          )}
                        </Button>

                        {quote?.pdf_url && (
                          <a href={quote.pdf_url} target="_blank" rel="noopener noreferrer" className="block">
                            <Button variant="outline" className="w-full">
                              <Download className="mr-2 h-4 w-4" />
                              Download PDF
                            </Button>
                          </a>
                        )}
                      </div>

                      {error && (
                        <div className="mt-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                          {error}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

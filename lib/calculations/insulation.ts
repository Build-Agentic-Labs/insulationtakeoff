export interface Room {
  id: string;
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
}

export interface Settings {
  r_values: {
    wall: number | null;
    attic: number | null;
    garage_wall: number | null;
    floor: number | null;
  };
  pricing: {
    wall_per_sqft: number;
    attic_per_sqft: number;
    garage_wall_per_sqft: number;
    floor_per_sqft: number;
  };
}

export interface LineItem {
  area: string;
  sqft: number;
  rValue: number | null;
  pricePerSqft: number;
  totalCost: number;
}

/**
 * Calculate wall area for a room (perimeter × height)
 */
export function calculateWallArea(perimeter: number, height: number): number {
  return perimeter * height;
}

/**
 * Calculate total living area wall insulation
 */
export function calculateLivingWallInsulation(
  rooms: Room[],
  settings: Settings
): LineItem | null {
  const livingRooms = rooms.filter((r) => r.type === 'living');

  if (livingRooms.length === 0) {
    return null;
  }

  let totalWallArea = 0;

  for (const room of livingRooms) {
    if (room.perimeter_ft && room.height_ft) {
      totalWallArea += calculateWallArea(room.perimeter_ft, room.height_ft);
    }
  }

  if (totalWallArea === 0) {
    return null;
  }

  return {
    area: 'Living Area Walls',
    sqft: Math.round(totalWallArea),
    rValue: settings.r_values.wall,
    pricePerSqft: settings.pricing.wall_per_sqft,
    totalCost: totalWallArea * settings.pricing.wall_per_sqft,
  };
}

/**
 * Calculate garage wall insulation
 */
export function calculateGarageWallInsulation(
  rooms: Room[],
  settings: Settings
): LineItem | null {
  const garageRooms = rooms.filter((r) => r.type === 'garage');

  if (garageRooms.length === 0) {
    return null;
  }

  let totalWallArea = 0;

  for (const room of garageRooms) {
    if (room.perimeter_ft && room.height_ft) {
      totalWallArea += calculateWallArea(room.perimeter_ft, room.height_ft);
    }
  }

  if (totalWallArea === 0) {
    return null;
  }

  return {
    area: 'Garage Walls',
    sqft: Math.round(totalWallArea),
    rValue: settings.r_values.garage_wall,
    pricePerSqft: settings.pricing.garage_wall_per_sqft,
    totalCost: totalWallArea * settings.pricing.garage_wall_per_sqft,
  };
}

/**
 * Calculate attic/ceiling insulation
 */
export function calculateAtticInsulation(
  rooms: Room[],
  settings: Settings
): LineItem | null {
  const atticRooms = rooms.filter((r) => r.type === 'attic');

  if (atticRooms.length === 0) {
    // If no attic room, use living area sqft as ceiling area
    const livingRooms = rooms.filter((r) => r.type === 'living');
    const totalLivingArea = livingRooms.reduce(
      (sum, r) => sum + (r.area_sqft || 0),
      0
    );

    if (totalLivingArea === 0) {
      return null;
    }

    return {
      area: 'Attic/Ceiling',
      sqft: Math.round(totalLivingArea),
      rValue: settings.r_values.attic,
      pricePerSqft: settings.pricing.attic_per_sqft,
      totalCost: totalLivingArea * settings.pricing.attic_per_sqft,
    };
  }

  const totalAtticArea = atticRooms.reduce(
    (sum, r) => sum + (r.area_sqft || 0),
    0
  );

  if (totalAtticArea === 0) {
    return null;
  }

  return {
    area: 'Attic/Ceiling',
    sqft: Math.round(totalAtticArea),
    rValue: settings.r_values.attic,
    pricePerSqft: settings.pricing.attic_per_sqft,
    totalCost: totalAtticArea * settings.pricing.attic_per_sqft,
  };
}

/**
 * Calculate crawlspace/floor insulation
 */
export function calculateFloorInsulation(
  rooms: Room[],
  settings: Settings
): LineItem | null {
  const crawlspaceRooms = rooms.filter((r) => r.type === 'crawlspace');

  if (crawlspaceRooms.length === 0) {
    return null;
  }

  const totalFloorArea = crawlspaceRooms.reduce(
    (sum, r) => sum + (r.area_sqft || 0),
    0
  );

  if (totalFloorArea === 0) {
    return null;
  }

  return {
    area: 'Crawlspace/Floor',
    sqft: Math.round(totalFloorArea),
    rValue: settings.r_values.floor,
    pricePerSqft: settings.pricing.floor_per_sqft,
    totalCost: totalFloorArea * settings.pricing.floor_per_sqft,
  };
}

/**
 * Calculate all insulation line items for a project
 */
export function calculateInsulationQuote(
  rooms: Room[],
  settings: Settings
): {
  lineItems: LineItem[];
  totalCost: number;
  totalSqft: number;
} {
  const lineItems: LineItem[] = [];

  const livingWalls = calculateLivingWallInsulation(rooms, settings);
  if (livingWalls) lineItems.push(livingWalls);

  const garageWalls = calculateGarageWallInsulation(rooms, settings);
  if (garageWalls) lineItems.push(garageWalls);

  const attic = calculateAtticInsulation(rooms, settings);
  if (attic) lineItems.push(attic);

  const floor = calculateFloorInsulation(rooms, settings);
  if (floor) lineItems.push(floor);

  const totalCost = lineItems.reduce((sum, item) => sum + item.totalCost, 0);
  const totalSqft = lineItems.reduce((sum, item) => sum + item.sqft, 0);

  return {
    lineItems,
    totalCost,
    totalSqft,
  };
}

/**
 * Validate that all required R-values are set
 */
export function validateRValues(settings: Settings, rooms: Room[]): string[] {
  const errors: string[] = [];
  const roomTypes = new Set(rooms.map((r) => r.type));

  if (roomTypes.has('living') && settings.r_values.wall === null) {
    errors.push('Wall R-value is required for living areas');
  }

  if ((roomTypes.has('attic') || roomTypes.has('living')) && settings.r_values.attic === null) {
    errors.push('Attic R-value is required');
  }

  if (roomTypes.has('garage') && settings.r_values.garage_wall === null) {
    errors.push('Garage wall R-value is required');
  }

  if (roomTypes.has('crawlspace') && settings.r_values.floor === null) {
    errors.push('Floor R-value is required for crawlspace areas');
  }

  return errors;
}

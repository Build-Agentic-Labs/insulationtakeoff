"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Edit2, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface Room {
  id: string;
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
  measurements: Array<{
    id: string;
    field: string;
    extracted_value: number | null;
    user_override: number | null;
    source_page: number | null;
    confidence: number | null;
  }>;
}

interface MeasurementCardProps {
  room: Room;
}

export function MeasurementCard({ room: initialRoom }: MeasurementCardProps) {
  const [room, setRoom] = useState(initialRoom);
  const [isEditing, setIsEditing] = useState(false);
  const [editedValues, setEditedValues] = useState<{
    area_sqft: number | null;
    perimeter_ft: number | null;
    height_ft: number | null;
  }>({
    area_sqft: room.area_sqft,
    perimeter_ft: room.perimeter_ft,
    height_ft: room.height_ft,
  });

  const typeColors = {
    living: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    garage: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    attic: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    crawlspace: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  };

  const handleSave = async () => {
    try {
      // Update room
      const { error } = await supabase
        .from('rooms')
        .update({
          area_sqft: editedValues.area_sqft,
          perimeter_ft: editedValues.perimeter_ft,
          height_ft: editedValues.height_ft,
        })
        .eq('id', room.id);

      if (error) throw error;

      // Update measurements with user overrides
      for (const measurement of room.measurements) {
        let overrideValue = null;

        if (measurement.field === 'area_sqft' && editedValues.area_sqft !== measurement.extracted_value) {
          overrideValue = editedValues.area_sqft;
        } else if (measurement.field === 'perimeter_ft' && editedValues.perimeter_ft !== measurement.extracted_value) {
          overrideValue = editedValues.perimeter_ft;
        } else if (measurement.field === 'height_ft' && editedValues.height_ft !== measurement.extracted_value) {
          overrideValue = editedValues.height_ft;
        }

        if (overrideValue !== null) {
          await supabase
            .from('measurements')
            .update({ user_override: overrideValue })
            .eq('id', measurement.id);
        }
      }

      setRoom({
        ...room,
        ...editedValues,
      });

      setIsEditing(false);
    } catch (error) {
      console.error('Error saving measurements:', error);
      alert('Failed to save changes. Please try again.');
    }
  };

  const handleCancel = () => {
    setEditedValues({
      area_sqft: room.area_sqft,
      perimeter_ft: room.perimeter_ft,
      height_ft: room.height_ft,
    });
    setIsEditing(false);
  };

  const getSourcePages = () => {
    const pages = room.measurements
      .filter((m) => m.source_page !== null)
      .map((m) => m.source_page);
    return [...new Set(pages)].sort();
  };

  const sourcePages = getSourcePages();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>{room.name}</CardTitle>
            <span className={`text-xs px-2 py-1 rounded-full ${typeColors[room.type]}`}>
              {room.type}
            </span>
          </div>
          {!isEditing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
              >
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>
          )}
        </div>
        {sourcePages.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Source: Page{sourcePages.length > 1 ? 's' : ''} {sourcePages.join(', ')}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {room.area_sqft !== null && (
          <div>
            <Label htmlFor={`area-${room.id}`}>Area (sq ft)</Label>
            {isEditing ? (
              <Input
                id={`area-${room.id}`}
                type="number"
                step="0.01"
                value={editedValues.area_sqft || ''}
                onChange={(e) =>
                  setEditedValues({
                    ...editedValues,
                    area_sqft: parseFloat(e.target.value) || null,
                  })
                }
              />
            ) : (
              <p className="text-lg font-semibold">
                {room.area_sqft.toLocaleString()} sq ft
              </p>
            )}
          </div>
        )}

        {room.perimeter_ft !== null && (
          <div>
            <Label htmlFor={`perimeter-${room.id}`}>Perimeter (ft)</Label>
            {isEditing ? (
              <Input
                id={`perimeter-${room.id}`}
                type="number"
                step="0.01"
                value={editedValues.perimeter_ft || ''}
                onChange={(e) =>
                  setEditedValues({
                    ...editedValues,
                    perimeter_ft: parseFloat(e.target.value) || null,
                  })
                }
              />
            ) : (
              <p className="text-lg font-semibold">
                {room.perimeter_ft.toLocaleString()} ft
              </p>
            )}
          </div>
        )}

        {room.height_ft !== null && (
          <div>
            <Label htmlFor={`height-${room.id}`}>Height (ft)</Label>
            {isEditing ? (
              <Input
                id={`height-${room.id}`}
                type="number"
                step="0.01"
                value={editedValues.height_ft || ''}
                onChange={(e) =>
                  setEditedValues({
                    ...editedValues,
                    height_ft: parseFloat(e.target.value) || null,
                  })
                }
              />
            ) : (
              <p className="text-lg font-semibold">
                {room.height_ft.toLocaleString()} ft
              </p>
            )}
          </div>
        )}

        {room.measurements.some((m) => m.confidence !== null) && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              AI Confidence:{' '}
              {Math.round(
                (room.measurements.reduce((sum, m) => sum + (m.confidence || 0), 0) /
                  room.measurements.filter((m) => m.confidence !== null).length) *
                  100
              )}
              %
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

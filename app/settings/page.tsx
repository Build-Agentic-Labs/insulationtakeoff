"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings as SettingsIcon, Save, Loader2 } from 'lucide-react';

interface Settings {
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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    r_values: {
      wall: null,
      attic: null,
      garage_wall: null,
      floor: null,
    },
    pricing: {
      wall_per_sqft: 1.5,
      attic_per_sqft: 2.0,
      garage_wall_per_sqft: 1.75,
      floor_per_sqft: 2.5,
    },
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data: rValuesData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'r_values')
        .single();

      const { data: pricingData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pricing')
        .single();

      if (rValuesData?.value) {
        setSettings((prev) => ({
          ...prev,
          r_values: rValuesData.value as any,
        }));
      }

      if (pricingData?.value) {
        setSettings((prev) => ({
          ...prev,
          pricing: pricingData.value as any,
        }));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setSuccessMessage(null);

    try {
      await supabase
        .from('settings')
        .update({ value: settings.r_values })
        .eq('key', 'r_values');

      await supabase
        .from('settings')
        .update({ value: settings.pricing })
        .eq('key', 'pricing');

      setSuccessMessage('Settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-8 w-8" />
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Configure R-values and pricing for insulation quotes
            </p>
          </div>
        </div>

        <Tabs defaultValue="r-values" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="r-values">R-Values</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
          </TabsList>

          <TabsContent value="r-values" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>R-Value Configuration</CardTitle>
                <CardDescription>
                  Set the R-values for different insulation areas. Leave blank to skip an area in quotes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="wall-rvalue">Wall R-Value</Label>
                  <Input
                    id="wall-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 15"
                    value={settings.r_values.wall || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          wall: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Common values: R-13, R-15, R-19, R-21
                  </p>
                </div>

                <div>
                  <Label htmlFor="attic-rvalue">Attic/Ceiling R-Value</Label>
                  <Input
                    id="attic-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 38"
                    value={settings.r_values.attic || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          attic: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Common values: R-30, R-38, R-49, R-60
                  </p>
                </div>

                <div>
                  <Label htmlFor="garage-rvalue">Garage Wall R-Value</Label>
                  <Input
                    id="garage-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 13"
                    value={settings.r_values.garage_wall || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          garage_wall: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Common values: R-11, R-13, R-15
                  </p>
                </div>

                <div>
                  <Label htmlFor="floor-rvalue">Floor/Crawlspace R-Value</Label>
                  <Input
                    id="floor-rvalue"
                    type="number"
                    step="1"
                    placeholder="e.g., 19"
                    value={settings.r_values.floor || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        r_values: {
                          ...settings.r_values,
                          floor: e.target.value ? parseInt(e.target.value) : null,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Common values: R-19, R-25, R-30
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pricing" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Pricing Configuration</CardTitle>
                <CardDescription>
                  Set the price per square foot for different insulation areas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="wall-price">Wall Price ($/sq ft)</Label>
                  <Input
                    id="wall-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 1.50"
                    value={settings.pricing.wall_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          wall_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="attic-price">Attic/Ceiling Price ($/sq ft)</Label>
                  <Input
                    id="attic-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.00"
                    value={settings.pricing.attic_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          attic_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="garage-price">Garage Wall Price ($/sq ft)</Label>
                  <Input
                    id="garage-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 1.75"
                    value={settings.pricing.garage_wall_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          garage_wall_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="floor-price">Floor/Crawlspace Price ($/sq ft)</Label>
                  <Input
                    id="floor-price"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.50"
                    value={settings.pricing.floor_per_sqft}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pricing: {
                          ...settings.pricing,
                          floor_per_sqft: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-4">
          <Button onClick={saveSettings} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>

          {successMessage && (
            <p className="text-sm text-green-600">{successMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}

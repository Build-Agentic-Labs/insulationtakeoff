"use client";

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PDFViewer } from '@/components/pdf/PDFViewer';
import {
  FileCheck,
  Plus,
  Loader2,
  Trash2,
  Home,
  Warehouse,
  ArrowUp,
  Building,
  Save,
  X,
  ChevronDown,
} from 'lucide-react';

interface Room {
  id: string;
  name: string;
  type: 'living' | 'garage' | 'attic' | 'crawlspace';
  area_sqft: number | null;
  perimeter_ft: number | null;
  height_ft: number | null;
}

interface Project {
  id: string;
  name: string;
  status: string;
  pdf_url: string | null;
}

const ROOM_TYPES = [
  { value: 'living', label: 'Living Space', icon: Home },
  { value: 'garage', label: 'Garage', icon: Warehouse },
  { value: 'attic', label: 'Attic', icon: ArrowUp },
  { value: 'crawlspace', label: 'Crawlspace', icon: Building },
];

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);

  // New room form
  const [newRoom, setNewRoom] = useState({
    name: '',
    type: 'living' as 'living' | 'garage' | 'attic' | 'crawlspace',
    area_sqft: '',
    perimeter_ft: '',
    height_ft: '',
  });

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      setProject(projectData);

      const { data: roomsData } = await supabase
        .from('rooms')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: true });

      setRooms(roomsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddRoom = async () => {
    if (!newRoom.name.trim()) return;

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          project_id: id,
          name: newRoom.name.trim(),
          type: newRoom.type,
          area_sqft: newRoom.area_sqft ? parseFloat(newRoom.area_sqft) : null,
          perimeter_ft: newRoom.perimeter_ft ? parseFloat(newRoom.perimeter_ft) : null,
          height_ft: newRoom.height_ft ? parseFloat(newRoom.height_ft) : null,
        })
        .select()
        .single();

      if (error) throw error;

      setRooms([...rooms, data]);
      setNewRoom({
        name: '',
        type: 'living',
        area_sqft: '',
        perimeter_ft: '',
        height_ft: '',
      });
      setShowAddRoom(false);
    } catch (error) {
      console.error('Error adding room:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateRoom = async (roomId: string, updates: Partial<Room>) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update(updates)
        .eq('id', roomId);

      if (error) throw error;

      setRooms(rooms.map(r => r.id === roomId ? { ...r, ...updates } : r));
      setEditingRoom(null);
    } catch (error) {
      console.error('Error updating room:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm('Are you sure you want to delete this room?')) return;

    try {
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('id', roomId);

      if (error) throw error;

      setRooms(rooms.filter(r => r.id !== roomId));
    } catch (error) {
      console.error('Error deleting room:', error);
    }
  };

  const getRoomIcon = (type: string) => {
    const roomType = ROOM_TYPES.find(t => t.value === type);
    const Icon = roomType?.icon || Home;
    return <Icon className="h-5 w-5" />;
  };

  const getRoomTypeLabel = (type: string) => {
    return ROOM_TYPES.find(t => t.value === type)?.label || type;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <p className="text-zinc-500">Project not found</p>
      </div>
    );
  }

  const hasPdf = !!project.pdf_url;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 bg-white dark:bg-zinc-900">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{project.name}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {project.status === 'manual'
                ? 'Add and manage room measurements'
                : 'Review and edit extracted measurements'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/projects/${project.id}`}>
              <Button variant="outline">Back to Project</Button>
            </Link>
            <Link href={`/projects/${project.id}/quote`}>
              <Button>
                <FileCheck className="mr-2 h-4 w-4" />
                Generate Quote
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <div className="container mx-auto h-full p-4">
          <div className={`grid gap-4 h-full ${hasPdf ? 'grid-cols-2' : 'grid-cols-1 max-w-3xl mx-auto'}`}>
            {/* PDF Viewer - only show if project has a PDF */}
            {hasPdf && (
              <Card className="overflow-hidden flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="text-lg">Source Document</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <PDFViewer url={project.pdf_url!} />
                </CardContent>
              </Card>
            )}

            {/* Rooms/Measurements */}
            <div className="overflow-auto space-y-4">
              {/* Add Room Button */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  Rooms & Measurements
                </h2>
                <Button onClick={() => setShowAddRoom(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Room
                </Button>
              </div>

              {/* Add Room Form */}
              {showAddRoom && (
                <Card className="border-l-4 border-l-primary">
                  <CardContent className="pt-4">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">Add New Room</h3>
                        <Button variant="ghost" size="sm" onClick={() => setShowAddRoom(false)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Room Name</Label>
                          <Input
                            placeholder="e.g., Master Bedroom"
                            value={newRoom.name}
                            onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Type</Label>
                          <select
                            value={newRoom.type}
                            onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value as any })}
                            className="mt-1 w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                          >
                            {ROOM_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label>Area (sq ft)</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={newRoom.area_sqft}
                            onChange={(e) => setNewRoom({ ...newRoom, area_sqft: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Perimeter (ft)</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={newRoom.perimeter_ft}
                            onChange={(e) => setNewRoom({ ...newRoom, perimeter_ft: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Height (ft)</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={newRoom.height_ft}
                            onChange={(e) => setNewRoom({ ...newRoom, height_ft: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setShowAddRoom(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleAddRoom} disabled={isSaving || !newRoom.name.trim()}>
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                          Add Room
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Empty State */}
              {rooms.length === 0 && !showAddRoom && (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Home className="h-12 w-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
                      No rooms yet
                    </h3>
                    <p className="text-zinc-500 dark:text-zinc-400 mb-6">
                      {project.status === 'manual'
                        ? 'Start by adding rooms and their measurements'
                        : 'No data extracted yet. Run extraction or add rooms manually'}
                    </p>
                    <Button onClick={() => setShowAddRoom(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Your First Room
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Room Cards */}
              {rooms.map((room) => (
                <Card key={room.id} className="border-zinc-200 dark:border-zinc-700">
                  <CardContent className="pt-4">
                    {editingRoom === room.id ? (
                      <RoomEditForm
                        room={room}
                        onSave={(updates) => handleUpdateRoom(room.id, updates)}
                        onCancel={() => setEditingRoom(null)}
                        isSaving={isSaving}
                      />
                    ) : (
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            {getRoomIcon(room.type)}
                          </div>
                          <div>
                            <h3 className="font-medium text-zinc-900 dark:text-white">
                              {room.name}
                            </h3>
                            <p className="text-sm text-zinc-500">
                              {getRoomTypeLabel(room.type)}
                            </p>
                            <div className="flex gap-4 mt-2 text-sm">
                              {room.area_sqft && (
                                <span className="text-zinc-600 dark:text-zinc-300">
                                  <strong>{room.area_sqft.toLocaleString()}</strong> sq ft
                                </span>
                              )}
                              {room.perimeter_ft && (
                                <span className="text-zinc-600 dark:text-zinc-300">
                                  <strong>{room.perimeter_ft}</strong> ft perimeter
                                </span>
                              )}
                              {room.height_ft && (
                                <span className="text-zinc-600 dark:text-zinc-300">
                                  <strong>{room.height_ft}</strong> ft height
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingRoom(room.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteRoom(room.id)}
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Separate component for editing a room
function RoomEditForm({
  room,
  onSave,
  onCancel,
  isSaving,
}: {
  room: Room;
  onSave: (updates: Partial<Room>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState({
    name: room.name,
    type: room.type,
    area_sqft: room.area_sqft?.toString() || '',
    perimeter_ft: room.perimeter_ft?.toString() || '',
    height_ft: room.height_ft?.toString() || '',
  });

  const handleSave = () => {
    onSave({
      name: form.name,
      type: form.type,
      area_sqft: form.area_sqft ? parseFloat(form.area_sqft) : null,
      perimeter_ft: form.perimeter_ft ? parseFloat(form.perimeter_ft) : null,
      height_ft: form.height_ft ? parseFloat(form.height_ft) : null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Room Name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Type</Label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as any })}
            className="mt-1 w-full px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          >
            {ROOM_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Area (sq ft)</Label>
          <Input
            type="number"
            value={form.area_sqft}
            onChange={(e) => setForm({ ...form, area_sqft: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Perimeter (ft)</Label>
          <Input
            type="number"
            value={form.perimeter_ft}
            onChange={(e) => setForm({ ...form, perimeter_ft: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Height (ft)</Label>
          <Input
            type="number"
            value={form.height_ft}
            onChange={(e) => setForm({ ...form, height_ft: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !form.name.trim()}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          name: string
          pdf_url: string
          status: 'uploaded' | 'extracting' | 'reviewing' | 'completed'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          pdf_url: string
          status?: 'uploaded' | 'extracting' | 'reviewing' | 'completed'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          pdf_url?: string
          status?: 'uploaded' | 'extracting' | 'reviewing' | 'completed'
          created_at?: string
          updated_at?: string
        }
      }
      rooms: {
        Row: {
          id: string
          project_id: string
          name: string
          type: 'living' | 'garage' | 'attic' | 'crawlspace'
          area_sqft: number | null
          perimeter_ft: number | null
          height_ft: number | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          type: 'living' | 'garage' | 'attic' | 'crawlspace'
          area_sqft?: number | null
          perimeter_ft?: number | null
          height_ft?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          type?: 'living' | 'garage' | 'attic' | 'crawlspace'
          area_sqft?: number | null
          perimeter_ft?: number | null
          height_ft?: number | null
          created_at?: string
        }
      }
      measurements: {
        Row: {
          id: string
          room_id: string
          field: string
          extracted_value: number | null
          user_override: number | null
          source_page: number | null
          bbox: Json | null
          confidence: number | null
          created_at: string
        }
        Insert: {
          id?: string
          room_id: string
          field: string
          extracted_value?: number | null
          user_override?: number | null
          source_page?: number | null
          bbox?: Json | null
          confidence?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          room_id?: string
          field?: string
          extracted_value?: number | null
          user_override?: number | null
          source_page?: number | null
          bbox?: Json | null
          confidence?: number | null
          created_at?: string
        }
      }
      quotes: {
        Row: {
          id: string
          project_id: string
          line_items: Json
          total_cost: number
          pdf_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          line_items: Json
          total_cost: number
          pdf_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          line_items?: Json
          total_cost?: number
          pdf_url?: string | null
          created_at?: string
        }
      }
      settings: {
        Row: {
          id: string
          key: string
          value: Json
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          value: Json
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          value?: Json
          updated_at?: string
        }
      }
    }
  }
}

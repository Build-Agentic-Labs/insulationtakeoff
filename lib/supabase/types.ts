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
          pdf_url: string | null
          status: 'uploaded' | 'extracting' | 'reviewing' | 'completed' | 'manual'
          client_id: string | null
          active_extraction_mode: 'ocr' | 'vision' | null
          plan_preset: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          pdf_url?: string | null
          status?: 'uploaded' | 'extracting' | 'reviewing' | 'completed' | 'manual'
          client_id?: string | null
          active_extraction_mode?: 'ocr' | 'vision' | null
          plan_preset?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          pdf_url?: string | null
          status?: 'uploaded' | 'extracting' | 'reviewing' | 'completed' | 'manual'
          client_id?: string | null
          active_extraction_mode?: 'ocr' | 'vision' | null
          plan_preset?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          }
        ]
      }
      clients: {
        Row: {
          id: string
          name: string
          email: string | null
          phone: string | null
          address: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          email?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          email?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          id: string
          project_id: string
          name: string
          file_url: string
          file_type: string | null
          file_size: number | null
          created_at: string
          takeoff_envelope: Json | null
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          file_url: string
          file_type?: string | null
          file_size?: number | null
          created_at?: string
          takeoff_envelope?: Json | null
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          file_url?: string
          file_type?: string | null
          file_size?: number | null
          created_at?: string
          takeoff_envelope?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
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
          wall_sf: number | null
          floor_sf: number | null
          ceiling_sf: number | null
          wall_composition: string | null
          stud_size: string | null
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
          wall_sf?: number | null
          floor_sf?: number | null
          ceiling_sf?: number | null
          wall_composition?: string | null
          stud_size?: string | null
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
          wall_sf?: number | null
          floor_sf?: number | null
          ceiling_sf?: number | null
          wall_composition?: string | null
          stud_size?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      openings: {
        Row: {
          id: string
          project_id: string
          type: 'door' | 'window'
          label: string
          width_ft: number | null
          height_ft: number | null
          area_sqft: number | null
          count: number
          confidence: number | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          type: 'door' | 'window'
          label?: string
          width_ft?: number | null
          height_ft?: number | null
          area_sqft?: number | null
          count?: number
          confidence?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          type?: 'door' | 'window'
          label?: string
          width_ft?: number | null
          height_ft?: number | null
          area_sqft?: number | null
          count?: number
          confidence?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "openings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "measurements_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: [
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      extraction_runs: {
        Row: {
          id: string
          project_id: string
          document_id: string
          mode: 'ocr' | 'vision' | 'hybrid'
          idempotency_key: string
          status: 'started' | 'complete' | 'review' | 'failed'
          attempt: number
          started_at: string
          finished_at: string | null
          error: string | null
          takeoff_envelope: Json | null
          metrics_json: Json | null
          request_json: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          document_id: string
          mode: 'ocr' | 'vision' | 'hybrid'
          idempotency_key: string
          status?: 'started' | 'complete' | 'review' | 'failed'
          attempt?: number
          started_at?: string
          finished_at?: string | null
          error?: string | null
          takeoff_envelope?: Json | null
          metrics_json?: Json | null
          request_json?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          document_id?: string
          mode?: 'ocr' | 'vision' | 'hybrid'
          idempotency_key?: string
          status?: 'started' | 'complete' | 'review' | 'failed'
          attempt?: number
          started_at?: string
          finished_at?: string | null
          error?: string | null
          takeoff_envelope?: Json | null
          metrics_json?: Json | null
          request_json?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          }
        ]
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
        Relationships: []
      }
      takeoff_sessions: {
        Row: {
          id: string
          project_id: string
          document_id: string
          status: 'in_progress' | 'completed' | 'abandoned'
          selected_pages: number[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          document_id: string
          status?: 'in_progress' | 'completed' | 'abandoned'
          selected_pages?: number[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          document_id?: string
          status?: 'in_progress' | 'completed' | 'abandoned'
          selected_pages?: number[]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_sessions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          }
        ]
      }
      takeoff_regions: {
        Row: {
          id: string
          session_id: string
          page_index: number
          label: string
          wall_type: 'exterior' | 'garage' | 'basement' | 'other'
          source: 'ai' | 'manual'
          status: 'pending' | 'analyzing' | 'confirmed' | 'rejected'
          bbox: Json
          wall_length_lf: number | null
          wall_height_ft: number | null
          gross_sf: number | null
          net_sf: number | null
          openings: Json
          raw_ocr_result: Json | null
          confirmed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          page_index: number
          label: string
          wall_type?: 'exterior' | 'garage' | 'basement' | 'other'
          source?: 'ai' | 'manual'
          status?: 'pending' | 'analyzing' | 'confirmed' | 'rejected'
          bbox: Json
          wall_length_lf?: number | null
          wall_height_ft?: number | null
          gross_sf?: number | null
          net_sf?: number | null
          openings?: Json
          raw_ocr_result?: Json | null
          confirmed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          page_index?: number
          label?: string
          wall_type?: 'exterior' | 'garage' | 'basement' | 'other'
          source?: 'ai' | 'manual'
          status?: 'pending' | 'analyzing' | 'confirmed' | 'rejected'
          bbox?: Json
          wall_length_lf?: number | null
          wall_height_ft?: number | null
          gross_sf?: number | null
          net_sf?: number | null
          openings?: Json
          raw_ocr_result?: Json | null
          confirmed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_regions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "takeoff_sessions"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
